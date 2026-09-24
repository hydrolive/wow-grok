'use strict';

// Echo, Grok CLI, and xAI API backends. Echo is the default for tests.
// ACP (`grok agent stdio`) is intentionally not a backend in v1.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildApiBody,
  buildGrokArgv,
  parseStreamLine,
  reduceStream,
  textFromResponse,
  uuid,
} = require('./protocol');

function textFromSession(cwd, sessionId) {
  if (!cwd || !sessionId) return '';
  const file = path.join(os.homedir(), '.grok', 'sessions', encodeURIComponent(path.resolve(cwd)), sessionId, 'updates.jsonl');
  try {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    let text = '';
    for (const line of lines) {
      const ev = parseStreamLine(line);
      const kind = ev && ev.update && ev.update.sessionUpdate;
      if (kind === 'user_message_chunk') text = '';
      else if (kind === 'agent_message_chunk' || kind === 'agent_message') {
        const chunk = ev.update.content && ev.update.content.text;
        if (chunk) text += chunk;
      }
    }
    return text;
  } catch {
    return '';
  }
}

function createBackend(name, opts = {}) {
  const kind = name || 'cli';
  if (kind === 'echo') return new EchoBackend(opts);
  if (kind === 'api') return new ApiBackend(opts);
  if (kind === 'cli') return new CliBackend(opts);
  throw new Error(`Unknown WowGrok backend "${kind}". Use echo, cli, or api.`);
}

class EchoBackend {
  constructor(opts = {}) {
    this.opts = opts;
  }

  async run(req) {
    if (req.onProgress) req.onProgress({ line: 'echo: accepted' });
    const prompt = String(req.prompt || '');
    const sessionId = req.resumeId || req.sessionId || uuid();
    const deny = /\[\[deny:([^\]]+)\]\]/.exec(prompt);
    if (deny && !(req.allow || []).includes(deny[1])) {
      return {
        text: `Approval required for ${deny[1]}.`,
        sessionId,
        denied: [deny[1]],
      };
    }
    if (prompt.includes('[[error]]')) {
      return { text: '', sessionId, error: 'echo error' };
    }
    return { text: `Echo: ${prompt}`, sessionId, denied: [] };
  }
}

class CliBackend {
  constructor(opts = {}) {
    this.opts = opts;
  }

  plan(req) {
    const built = buildGrokArgv({
      grokPath: this.opts.grokPath || 'grok',
      prompt: req.prompt,
      promptFile: req.promptFile,
      cwd: req.cwd,
      sessionId: req.sessionId,
      resumeId: req.resumeId,
      newSession: req.newSession || !req.resumeId,
      rules: req.rules,
      permissionMode: req.permissionMode,
      model: req.model,
      allow: req.allow,
      alwaysApprove: req.alwaysApprove === true,
    });
    return built;
  }

  async run(req) {
    const promptFile = path.join(os.tmpdir(), `wowgrok-prompt-${process.pid}-${Date.now()}.txt`);
    const planned = this.plan({ ...req, promptFile });
    if (planned.viaFile) fs.writeFileSync(promptFile, planned.prompt, 'utf8');
    const argv = planned.argv;
    const bin = argv[0];
    const args = argv.slice(1);
    const timeoutMs = req.timeoutMs || this.opts.timeoutMs || 1800000;
    const lines = [];
    let stderr = '';
    try {
      const code = await new Promise((resolve, reject) => {
        const child = spawn(bin, args, {
          cwd: req.cwd || process.cwd(),
          windowsHide: true,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let buf = '';
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error('grok timed out'));
        }, timeoutMs);
        child.stdout.on('data', (chunk) => {
          buf += chunk.toString('utf8');
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            lines.push(line);
            const partial = reduceStream(lines);
            if (req.onProgress && partial.actions.length) {
              req.onProgress({ line: partial.actions[partial.actions.length - 1], actions: partial.actions });
            }
          }
        });
        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString('utf8');
          if (stderr.length > 8000) stderr = stderr.slice(-8000);
        });
        child.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        child.on('exit', (code) => {
          clearTimeout(timer);
          if (buf.trim()) lines.push(buf.trim());
          resolve(code);
        });
      });
      const reduced = reduceStream(lines);
      let fromSession = false;
      if (!reduced.text) {
        const recovered = textFromSession(req.cwd, req.resumeId || req.sessionId);
        if (recovered) {
          reduced.text = recovered;
          fromSession = true;
        }
      }
      const meta = { exitCode: code, stdoutLines: lines.length, stderr: stderr.trim().slice(0, 500), fromSession };
      if (reduced.error) return { ...reduced, ...meta, sessionId: reduced.sessionId || req.sessionId };
      if (code !== 0 && !reduced.text) {
        return {
          text: '',
          sessionId: req.sessionId,
          denied: reduced.denied,
          error: (stderr || `grok exited ${code}`).trim().slice(0, 2000),
          ...meta,
        };
      }
      return {
        text: reduced.text,
        sessionId: reduced.sessionId || req.resumeId || req.sessionId,
        denied: reduced.denied,
        ...meta,
      };
    } finally {
      if (planned.viaFile) fs.rmSync(promptFile, { force: true });
    }
  }
}

class ApiBackend {
  constructor(opts = {}) {
    this.opts = opts;
  }

  plan(req) {
    return buildApiBody({
      model: req.model || this.opts.model || 'grok-4.7',
      prompt: req.prompt,
      rules: req.rules,
      previousId: req.newSession ? '' : req.resumeId,
    });
  }

  async run(req) {
    const key = process.env.XAI_API_KEY;
    if (!key) {
      return { text: '', sessionId: '', error: 'XAI_API_KEY is not set' };
    }
    const base = (this.opts.apiBase || 'https://api.x.ai/v1').replace(/\/$/, '');
    const body = this.plan(req);
    const response = await fetch(`${base}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = (data && data.error && (data.error.message || data.error)) || response.statusText;
      return { text: '', sessionId: '', error: `xAI API ${response.status}: ${message}` };
    }
    return {
      text: textFromResponse(data),
      sessionId: data.id || req.resumeId || '',
      denied: [],
    };
  }
}

module.exports = {
  createBackend,
  EchoBackend,
  CliBackend,
  ApiBackend,
};
