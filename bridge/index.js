#!/usr/bin/env node
'use strict';

// WowGrok companion. Reads the pixel strip, runs a Grok backend, publishes
// slot files and signal wavs. One instance per machine.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { createBackend } = require('./grok-backend');
const protocol = require('./protocol');

const ROOT = path.join(__dirname, '..');

function parseCli(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next != null && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else out[key] = true;
  }
  return out;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function chooseCwd(config, cli) {
  if (cli.project) return path.resolve(String(cli.project));
  const here = process.cwd();
  const atRepo = path.resolve(here).toLowerCase() === path.resolve(ROOT).toLowerCase();
  if (!atRepo) return here;
  if (config.defaultCwd) return path.resolve(config.defaultCwd);
  return here;
}

function loadPrimer(config) {
  if (config.primerText != null) return String(config.primerText);
  if (!config.primerFile) return '';
  const file = path.isAbsolute(config.primerFile) ? config.primerFile : path.join(ROOT, config.primerFile);
  try {
    const text = fs.readFileSync(file, 'utf8');
    return text.length > 2800 ? text.slice(0, 2800) : text;
  } catch {
    return '';
  }
}

function createCompanion(options = {}) {
  const cli = options.cli || {};
  const config = { ...(options.config || {}) };
  const home = options.home || __dirname;
  const addonDir = options.addonDir || config.addonDir;
  const backendName = options.backend || process.env.WOWGROK_BACKEND || config.backend || 'cli';
  const backend = options.backendImpl || createBackend(backendName, {
    grokPath: config.grokPath || 'grok',
    model: config.apiModel || config.model,
    apiBase: config.apiBase,
    timeoutMs: config.timeoutMs,
  });
  const stateFile = options.stateFile || path.join(home, 'state.json');
  const transcriptFile = options.transcriptFile || path.join(home, 'transcripts.json');
  const logFile = options.logFile || path.join(home, 'companion.log');
  const lockFile = path.join(home, 'companion.lock');
  fs.mkdirSync(home, { recursive: true });

  const state = readJson(stateFile, {});
  state.handled = state.handled || {};
  state.seen = state.seen || {};
  state.sessions = state.sessions || {};
  state.results = state.results || {};
  state.context = state.context || '';
  state.presence = state.presence || 0;
  const transcripts = readJson(transcriptFile, { tokens: {}, chats: {} });
  transcripts.tokens = transcripts.tokens || {};
  transcripts.chats = transcripts.chats || {};

  const comp = {
    config,
    state,
    transcripts,
    backendName,
    defaultCwd: options.defaultCwd || config.defaultCwd || process.cwd(),
    closing: false,
    queue: [],
    running: 0,
    runningChats: new Set(),
    idleWaiters: [],
    lastOutboxKey: '',
    capture: null,
  };

  function log(line) {
    const msg = `[wow-grok] ${line}`;
    if (!options.quiet) console.log(msg);
    try {
      fs.appendFileSync(logFile, new Date().toISOString() + ' ' + line + '\n');
    } catch { /* logging must not break a publish */ }
  }
  comp.log = log;

  function takeLock() {
    if (options.noLock) return;
    if (fs.existsSync(lockFile)) {
      const pid = Number(fs.readFileSync(lockFile, 'utf8'));
      if (pid && pid !== process.pid && alive(pid)) {
        const err = new Error('Another WowGrok companion is already running (pid ' + pid + ').');
        err.code = 'LOCKED';
        throw err;
      }
    }
    fs.writeFileSync(lockFile, String(process.pid));
    comp.ownsLock = true;
  }

  function save() {
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    fs.writeFileSync(transcriptFile, JSON.stringify(transcripts));
  }
  comp.save = save;

  function signalPath(kind, id, k) {
    const root = path.join(addonDir, 'WowGrok');
    const slot = protocol.slotNumber(id, config.slots || 200);
    if (kind === 'sig' || kind === 'ack') return path.join(root, kind, protocol.pad3(slot) + '.wav');
    if (kind === 'act') return path.join(root, 'act', protocol.pad3(slot), String(k).padStart(2, '0') + '.wav');
    if (kind === 'presence') return path.join(root, 'presence', protocol.pad4(id) + '.wav');
    return path.join(root, 'ctl', kind + '.wav');
  }

  function writeFile(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, data);
    try {
      fs.renameSync(tmp, file);
    } catch {
      fs.rmSync(file, { force: true });
      fs.renameSync(tmp, file);
    }
  }

  comp.raise = function raise(kind, id, k) {
    if (!addonDir) return;
    writeFile(signalPath(kind, id, k), protocol.silentWav());
  };

  function restoreBundle() {
    if (!state.restoreLeft || !state.restoreToken) return null;
    const chats = [];
    for (const [id, chat] of Object.entries(transcripts.chats)) {
      if (chats.length >= 16) break;
      const messages = (chat.messages || []).slice(-40).map((m) => ({
        role: m.role,
        id: m.id,
        t: m.t,
        text: String(m.text || '').slice(0, 2000),
      }));
      chats.push({ id, name: chat.name || '', cwd: chat.cwd || '', messages });
    }
    if (!chats.length) return null;
    return { token: state.restoreToken, chats };
  }

  comp.publish = function publish() {
    if (!addonDir) return;
    const records = Object.values(state.results);
    const lua = protocol.luaTable('WowGrok_SlotData', records, {
      now: options.now || Date.now(),
      cwd: comp.defaultCwd,
      presence: state.presence || 0,
      restore: restoreBundle(),
    });
    const slots = Number(config.slots || 200);
    for (let i = 1; i <= slots; i++) {
      writeFile(path.join(addonDir, 'WowGrok_S' + protocol.pad3(i), 'Inbox.lua'), lua);
    }
    const inbox = config.inboxFile || path.join(addonDir, 'WowGrok', 'Inbox.lua');
    writeFile(inbox, lua);
    comp.lastLua = lua;
  };

  function noteSession(token) {
    if (!token) return;
    if (!transcripts.tokens[token]) {
      state.restoreLeft = 3;
      state.restoreToken = token;
    }
    transcripts.tokens[token] = Date.now();
  }

  function transcriptChat(job) {
    const id = job.chat || 'default';
    const chat = (transcripts.chats[id] = transcripts.chats[id] || { name: '', cwd: '', messages: [] });
    if (job.name) chat.name = job.name;
    if (job.cwd) chat.cwd = job.cwd;
    return chat;
  }

  function pushMessage(job, role, text, id) {
    const chat = transcriptChat(job);
    chat.messages.push({
      role,
      id: id || job.id || 0,
      t: Math.floor(Date.now() / 1000),
      text: String(text || '').slice(0, 4000),
    });
    if (chat.messages.length > 200) chat.messages.splice(0, chat.messages.length - 200);
  }

  function forgetChat(chatId) {
    if (!chatId) return;
    delete transcripts.chats[chatId];
    delete state.sessions[chatId];
    delete state.results[chatId];
  }

  function checkIdle() {
    if (comp.running === 0 && comp.queue.length === 0) {
      const waiters = comp.idleWaiters.splice(0);
      for (const fn of waiters) fn();
    }
  }

  function setResult(job, fields) {
    const chat = job.chat || 'default';
    state.results[chat] = {
      chat,
      id: job.id,
      status: fields.status,
      text: fields.text || '',
      cwd: fields.cwd || '',
      session: fields.session || '',
      denied: fields.denied || [],
    };
  }

  async function startJob(job) {
    const key = job.chat || 'default';
    comp.running++;
    comp.runningChats.add(key);
    const resolved = protocol.resolveCwd(job.cwd, comp.defaultCwd);
    const prev = state.sessions[key];
    const fresh = job.newSession || !prev || !protocol.sameFolder(prev.cwd, resolved);
    const sessionId = fresh ? protocol.uuid() : prev.id;
    const resumeId = fresh ? '' : prev.id;
    const rules = config.gameContext === false
      ? protocol.rulesText('', loadPrimer(config))
      : protocol.rulesText(state.context, loadPrimer(config));
    const allow = [...(config.allowedTools || []), ...(job.allow || [])];
    let progress = [];
    let lastWrite = 0;
    try {
      pushMessage(job, 'you', job.text, job.id);
      setResult(job, { status: 'working', text: 'Working...', cwd: resolved, session: sessionId });
      comp.publish();
      const result = await backend.run({
        prompt: job.text,
        cwd: resolved,
        sessionId,
        resumeId,
        newSession: fresh,
        rules,
        allow,
        model: config.model || '',
        alwaysApprove: config.alwaysApprove === true,
        permissionMode: config.permissionMode || 'default',
        timeoutMs: config.timeoutMs || 1800000,
        onProgress(info) {
          if (info && info.line) progress.push(info.line);
          if (progress.length > 8) progress = progress.slice(-8);
          const now = Date.now();
          if (now - lastWrite > (config.progressWriteMs || 3000)) {
            lastWrite = now;
            setResult(job, { status: 'working', text: progress.join('\n'), cwd: resolved, session: sessionId });
            comp.publish();
            if (progress.length) comp.raise('act', job.id, Math.min(progress.length, config.actMax || 60));
          }
        },
      });
      const session = result.sessionId || sessionId;
      if (!result.error) state.sessions[key] = { id: session, cwd: resolved };
      const status = result.error ? 'error' : 'done';
      const text = result.error ? result.error : (result.text || '');
      setResult(job, {
        status,
        text,
        cwd: resolved,
        session,
        denied: result.denied || [],
      });
      pushMessage(job, 'grok', text, job.id);
      comp.raise('sig', job.id);
      log(`${status} chat ${key} #${job.id}`);
    } catch (err) {
      setResult(job, { status: 'error', text: err.message, cwd: resolved, session: sessionId });
      comp.raise('sig', job.id);
      log(`error chat ${key} #${job.id}: ${err.message}`);
    } finally {
      comp.running--;
      comp.runningChats.delete(key);
      comp.publish();
      save();
      pump();
      checkIdle();
    }
  }

  function pump() {
    const max = Number(config.maxParallel || 3);
    for (let i = 0; i < comp.queue.length && comp.running < max; i++) {
      const job = comp.queue[i];
      const key = job.chat || 'default';
      if (comp.runningChats.has(key)) continue;
      comp.queue.splice(i, 1);
      i--;
      startJob(job);
    }
    checkIdle();
  }

  function enqueue(job) {
    comp.queue.push(job);
    pump();
  }

  function rememberAllow(rules) {
    const have = new Set(config.allowedTools || []);
    for (const rule of rules) have.add(rule);
    config.allowedTools = [...have];
    if (options.configPath) {
      const disk = readJson(options.configPath, {});
      disk.allowedTools = config.allowedTools;
      fs.writeFileSync(options.configPath, JSON.stringify(disk, null, 2) + '\n');
    }
  }

  comp.acceptJobs = function acceptJobs(jobs, headerId) {
    if (!jobs || !jobs.length) return;
    let fresh = false;
    for (const job of jobs) {
      if (!job || !job.id) continue;
      noteSession(job.session || '');
      if (protocol.alreadyHandled(state, job)) {
        comp.raise('ack', job.id);
        continue;
      }
      protocol.markHandled(state, job);
      fresh = true;
      comp.raise('ack', job.id);
      if (job.hasContext && config.gameContext !== false) state.context = job.ctx || '';
      if (job.allow && job.allow.length) rememberAllow(job.allow);
      if (job.name) transcriptChat(job);
      if (job.forget) {
        forgetChat(job.chat);
        continue;
      }
      if (job.hello || !String(job.text || '').trim()) continue;
      log(`message chat ${job.chat || 'default'} #${job.id} via ${job.via || 'submit'}`);
      enqueue(job);
    }
    if (headerId) comp.raise('ack', headerId);
    comp.publish();
    if (fresh && state.restoreLeft) state.restoreLeft -= 1;
    save();
  };

  comp.submit = function submit(job) {
    comp.acceptJobs([{ ...job, via: job.via || 'submit' }], job.id);
  };

  comp.drain = function drain() {
    if (comp.running === 0 && comp.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => comp.idleWaiters.push(resolve));
  };

  comp.beat = function beat() {
    if (!addonDir) return 0;
    const max = Number(config.presenceMax || 2000);
    const lookahead = Number(config.presenceLookahead || 50);
    state.presence = Math.min(max, (state.presence || 0) + 1);
    comp.raise('presence', state.presence);
    for (let i = 1; i <= lookahead; i++) {
      const n = state.presence + i;
      if (n > max) break;
      writeFile(signalPath('presence', n), Buffer.alloc(0));
    }
    save();
    comp.publish();
    return state.presence;
  };

  comp.pollOutbox = function pollOutbox(src) {
    let text = src;
    if (text == null && config.savedVariablesFile && fs.existsSync(config.savedVariablesFile)) {
      try { text = fs.readFileSync(config.savedVariablesFile, 'utf8'); } catch { return; }
    }
    if (text == null) return;
    const job = protocol.parseOutbox(text);
    if (!job || !job.id) return;
    const key = `${job.session}:${job.id}`;
    if (key === comp.lastOutboxKey) return;
    comp.lastOutboxKey = key;
    comp.acceptJobs([job], job.id);
  };

  comp.onCaptureLine = function onCaptureLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.info) return log(String(msg.info));
    if (msg.warn) return log(String(msg.warn));
    if (msg.error || msg.text == null || msg.id == null) return;
    const jobs = protocol.parsePayload(msg.id, msg.text);
    if (!jobs.length) return;
    comp.acceptJobs(jobs, msg.id);
  };

  comp.startCapture = function startCapture() {
    if (config.capture && config.capture.enabled === false) return;
    const script = path.join(__dirname, 'capture.ps1');
    const cap = config.capture || {};
    const args = [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-Cell', String(cap.cellPx || 4),
      '-Cells', String(cap.cellsPerRow || 200),
      '-MaxRows', String(cap.maxRows || 48),
      '-IntervalMs', String(cap.intervalMs || 250),
      '-ProcessName', String(cap.processName || 'Wow'),
    ];
    const child = spawn('powershell.exe', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    comp.capture = child;
    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => comp.onCaptureLine(line));
    child.stderr.on('data', (buf) => {
      const text = buf.toString('utf8').trim();
      if (text) log('capture: ' + text.slice(0, 400));
    });
    child.on('exit', (code) => {
      comp.capture = null;
      if (comp.closing) return;
      log('capture exited ' + code + '; restarting in 3s');
      comp.captureTimer = setTimeout(() => comp.startCapture(), 3000);
    });
  };

  comp.close = async function close() {
    comp.closing = true;
    if (comp.captureTimer) clearTimeout(comp.captureTimer);
    if (comp.presenceTimer) clearInterval(comp.presenceTimer);
    if (comp.outboxTimer) clearInterval(comp.outboxTimer);
    if (comp.capture) {
      try { comp.capture.kill(); } catch { /* already gone */ }
    }
    save();
    if (comp.ownsLock) fs.rmSync(lockFile, { force: true });
  };

  takeLock();
  protocol.pruneStale(state, transcripts);
  log(`companion up backend=${backendName} cwd=${comp.defaultCwd}`);
  return comp;
}

async function main() {
  const cli = parseCli(process.argv);
  const configPath = cli.config
    ? path.resolve(cli.config)
    : path.join(__dirname, 'config.json');
  const example = path.join(__dirname, 'config.example.json');
  const config = readJson(fs.existsSync(configPath) ? configPath : example, {});
  if (cli.backend) config.backend = cli.backend;
  if (cli['addon-dir']) config.addonDir = path.resolve(cli['addon-dir']);
  const comp = createCompanion({
    cli,
    config,
    configPath: fs.existsSync(configPath) ? configPath : null,
    defaultCwd: chooseCwd(config, cli),
    backend: cli.backend,
    addonDir: config.addonDir,
  });
  if (cli.inject) {
    const raw = String(cli.inject).startsWith('@')
      ? fs.readFileSync(String(cli.inject).slice(1), 'utf8')
      : String(cli.inject);
    const payload = JSON.parse(raw);
    if (payload.text != null && payload.session != null && payload.id != null && payload.chat != null) {
      comp.submit(payload);
    } else if (payload.text != null && payload.id != null) {
      comp.onCaptureLine(JSON.stringify(payload));
    } else comp.submit(payload);
  }
  if (cli.once) {
    await comp.drain();
    await comp.close();
    return;
  }
  comp.startCapture();
  comp.presenceTimer = setInterval(() => comp.beat(), config.presenceIntervalMs || 30000);
  comp.beat();
  comp.outboxTimer = setInterval(() => comp.pollOutbox(), config.pollMs || 750);
  const stop = async () => {
    await comp.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (require.main === module) {
  main().catch((err) => {
    if (err.code === 'LOCKED') {
      console.error(err.message);
      process.exit(2);
    }
    console.error(err);
    process.exit(1);
  });
}

module.exports = { createCompanion, main, chooseCwd, parseCli };
