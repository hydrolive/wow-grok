'use strict';

// Pure WowGrok wire format: pixel frames, slot Lua, folders, dedup, Grok argv.
// No I/O and no process state, so tests can call it directly.

const crypto = require('crypto');
const os = require('os');
const path = require('path');

const MAGIC1 = 0xc7;
const MAGIC2 = 0x1a;
const BITS = 3;
const MAX_PAYLOAD = 3200;
const CELLS_PER_ROW = 200;
const MAX_ROWS = 48;
const MONTH_MS = 30 * 24 * 3600 * 1000;

function pad3(n) {
  return String(n).padStart(3, '0');
}

function pad4(n) {
  return String(n).padStart(4, '0');
}

function slotNumber(id, slots = 200) {
  const n = Number(id) || 1;
  const size = slots || 200;
  return ((n - 1) % size) + 1;
}

function fletcher16(bytes, from, to) {
  let s1 = 0;
  let s2 = 0;
  for (let i = from; i <= to; i++) {
    s1 = (s1 + bytes[i]) % 255;
    s2 = (s2 + s1) % 255;
  }
  return [s1, s2];
}

function bytesToCells(bytes) {
  const cells = [];
  let acc = 0;
  let nbits = 0;
  for (let i = 0; i < bytes.length; i++) {
    acc = acc * 256 + bytes[i];
    nbits += 8;
    while (nbits >= BITS) {
      const shift = nbits - BITS;
      const div = 2 ** shift;
      cells.push(Math.floor(acc / div) % 8);
      nbits = shift;
      acc = acc % div;
    }
  }
  if (nbits > 0) cells.push((acc * 2 ** (BITS - nbits)) % 8);
  return cells;
}

function cellColor(v) {
  return { r: Math.floor(v / 4) % 2, g: Math.floor(v / 2) % 2, b: v % 2 };
}

// Frame: magic, id, length, payload, Fletcher-16 over id..payload.
function encodeFrame(id, payload) {
  const body = Buffer.from(String(payload ?? ''), 'utf8');
  if (body.length > MAX_PAYLOAD) {
    return { error: 'length', bytes: null, cells: null };
  }
  const bytes = [
    MAGIC1,
    MAGIC2,
    Math.floor(id / 256) % 256,
    id % 256,
    Math.floor(body.length / 256) % 256,
    body.length % 256,
  ];
  for (const b of body) bytes.push(b);
  const [s1, s2] = fletcher16(bytes, 2, 5 + body.length);
  bytes.push(s1, s2);
  return { id: id % 65536, bytes, cells: bytesToCells(bytes) };
}

function cellsToBytes(cells, maxCells) {
  const bytes = [];
  let acc = 0;
  let nbits = 0;
  let needed = 6;
  const limit = maxCells || CELLS_PER_ROW * MAX_ROWS;
  const maxBytes = Math.floor((limit * BITS) / 8);
  for (let i = 0; i < cells.length && i < limit; i++) {
    acc = acc * 8 + (cells[i] & 7);
    nbits += 3;
    while (nbits >= 8 && bytes.length < needed) {
      const shift = nbits - 8;
      const div = 2 ** shift;
      bytes.push(Math.floor(acc / div) % 256);
      nbits = shift;
      acc = acc % div;
      if (bytes.length === 2 && (bytes[0] !== MAGIC1 || bytes[1] !== MAGIC2)) {
        return { error: 'magic' };
      }
      if (bytes.length === 6) {
        const len = bytes[4] * 256 + bytes[5];
        needed = 8 + len;
        if (needed > maxBytes || len < 0) return { error: 'length' };
      }
    }
    if (bytes.length >= needed) break;
  }
  if (bytes.length < needed) return { error: bytes.length >= 2 ? 'truncated' : 'magic' };
  return finishFrame(bytes);
}

function finishFrame(bytes) {
  if (bytes.length < 8 || bytes[0] !== MAGIC1 || bytes[1] !== MAGIC2) return { error: 'magic' };
  const id = bytes[2] * 256 + bytes[3];
  const len = bytes[4] * 256 + bytes[5];
  if (bytes.length < 8 + len) return { error: 'truncated' };
  const [s1, s2] = fletcher16(bytes, 2, 5 + len);
  if (bytes[6 + len] !== s1 || bytes[7 + len] !== s2) return { error: 'checksum' };
  const payload = Buffer.from(bytes.slice(6, 6 + len)).toString('utf8');
  return { id, text: payload };
}

function decodeCells(cells, maxCells) {
  return cellsToBytes(cells, maxCells);
}

function decodeBytes(bytes) {
  return finishFrame(Array.from(bytes));
}

function parseFlags(flags) {
  const out = {
    newSession: false,
    hello: false,
    forget: false,
    hasContext: false,
    allow: [],
    retry: 0,
  };
  for (const tok of String(flags || '').split(';')) {
    if (!tok) continue;
    if (tok === 'n') out.newSession = true;
    else if (tok === 'h') out.hello = true;
    else if (tok === 'd') out.forget = true;
    else if (tok === 'c') out.hasContext = true;
    else if (tok.startsWith('allow=')) {
      out.allow.push(...tok.slice(6).split(',').map((s) => s.trim()).filter(Boolean));
    } else if (tok.startsWith('r=')) out.retry = Number(tok.slice(2)) || 0;
  }
  return out;
}

function encodeRecord(rec) {
  const flags = [];
  if (rec.newSession) flags.push('n');
  if (rec.hello) flags.push('h');
  if (rec.forget) flags.push('d');
  if (rec.ctx != null) flags.push('c');
  if (rec.retry) flags.push('r=' + rec.retry);
  if (rec.allow && rec.allow.length) flags.push('allow=' + rec.allow.join(','));
  const fields = [
    rec.session || '',
    rec.chat || '',
    String(rec.id || 0),
    rec.cwd || '',
    flags.join(';'),
    rec.name || '',
  ];
  if (rec.ctx != null) fields.push(rec.ctx);
  fields.push(rec.text || '');
  return fields.join('\x1f');
}

function encodePayload(records) {
  return records.map(encodeRecord).join('\x1e');
}

function parsePayload(headerId, payload) {
  const jobs = [];
  for (const rec of String(payload ?? '').split('\x1e')) {
    if (!rec) continue;
    const p = rec.split('\x1f');
    if (p.length >= 7 && /^\d+$/.test(p[2])) {
      const flags = parseFlags(p[4]);
      const withCtx = flags.hasContext && p.length >= 8;
      const job = {
        session: p[0],
        chat: p[1],
        id: Number(p[2]),
        cwd: p[3],
        name: p[5],
        text: p.slice(withCtx ? 7 : 6).join('\x1f'),
        headerId: headerId,
        via: 'pixel',
        ...flags,
      };
      if (withCtx) job.ctx = p[6];
      jobs.push(job);
    }
  }
  return jobs;
}

function toHex(text) {
  return Buffer.from(String(text ?? ''), 'utf8').toString('hex');
}

function fromHex(hex) {
  if (!hex) return '';
  return Buffer.from(hex, 'hex').toString('utf8');
}

function grabString(block, key) {
  const bracket = block.match(new RegExp(`\\["${key}"\\]\\s*=\\s*"([^"]*)"`));
  if (bracket) return bracket[1];
  const plain = block.match(new RegExp(`(?:^|[\\s,{])${key}\\s*=\\s*"([^"]*)"`));
  return plain ? plain[1] : undefined;
}

function grabNumber(block, key) {
  const m = block.match(new RegExp(`(?:\\["${key}"\\]|${key})\\s*=\\s*(\\d+)`));
  return m ? Number(m[1]) : 0;
}

function sliceTable(src, key) {
  const text = String(src || '');
  const start = text.search(new RegExp(`\\["${key}"\\]\\s*=\\s*\\{|\\b${key}\\s*=\\s*\\{`));
  if (start < 0) return null;
  const brace = text.indexOf('{', start);
  if (brace < 0) return null;
  let depth = 0;
  for (let i = brace; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(brace + 1, i);
    }
  }
  return null;
}

// SavedVariables fallback written on /reload. Returns one job, or null.
function parseOutbox(src) {
  const b = sliceTable(src, 'outbox');
  if (b == null) return null;
  const id = grabNumber(b, 'id');
  if (!id) return null;
  const flags = parseFlags(grabString(b, 'flags') || '');
  if (/\["newSession"\]\s*=\s*true|\bnewSession\s*=\s*true/.test(b)) flags.newSession = true;
  const job = {
    id,
    session: grabString(b, 'session') || '',
    chat: grabString(b, 'chat') || '',
    name: fromHex(grabString(b, 'name') || ''),
    cwd: fromHex(grabString(b, 'cwd') || ''),
    text: fromHex(grabString(b, 'text') || ''),
    headerId: id,
    via: 'reload',
    ...flags,
  };
  const ctx = grabString(b, 'ctx');
  if (ctx != null && flags.hasContext) job.ctx = fromHex(ctx);
  return job;
}

function resolveCwd(raw, base) {
  let p = String(raw || '').trim();
  if (!p) return path.resolve(base || process.cwd());
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) {
    p = path.join(os.homedir(), p.slice(1));
  }
  return path.resolve(base || process.cwd(), p);
}

function sameFolder(a, b) {
  return path.resolve(a || '').toLowerCase() === path.resolve(b || '').toLowerCase();
}

function alreadyHandled(state, job) {
  const key = job.session || '';
  const bucket = state.handled && state.handled[key];
  if (!bucket) return key === '' && job.id <= (state.lastId || 0);
  return !!bucket[job.id];
}

function markHandled(state, job, now = Date.now()) {
  const key = job.session || '';
  state.handled = state.handled || {};
  const bucket = (state.handled[key] = state.handled[key] || {});
  bucket[job.id] = 1;
  const ids = Object.keys(bucket);
  if (ids.length > 1000) {
    for (const old of ids.slice(0, ids.length - 1000)) delete bucket[old];
  }
  state.lastId = Math.max(state.lastId || 0, job.id);
  state.seen = state.seen || {};
  state.seen[key] = now;
}

function pruneStale(state, transcripts, now = Date.now(), maxAgeMs = MONTH_MS) {
  let removed = 0;
  state.seen = state.seen || {};
  state.handled = state.handled || {};
  for (const key of Object.keys(state.handled)) {
    if (key === '') continue;
    if (!state.seen[key]) {
      state.seen[key] = now;
      continue;
    }
    if (now - state.seen[key] > maxAgeMs) {
      delete state.handled[key];
      delete state.seen[key];
      removed++;
    }
  }
  for (const key of Object.keys(state.seen)) {
    if (!state.handled[key] && now - state.seen[key] > maxAgeMs) delete state.seen[key];
  }
  const tokens = (transcripts && transcripts.tokens) || {};
  for (const tok of Object.keys(tokens)) {
    if (now - tokens[tok] > maxAgeMs) {
      delete tokens[tok];
      removed++;
    }
  }
  return removed;
}

function rulesText(ctx, primer) {
  const context = String(ctx || '').trim();
  const ref = String(primer || '').trim();
  if (!context && !ref) return '';
  const lines = [
    'The player is talking to you from inside World of Warcraft through the WowGrok addon. They type in an in-game window and your reply is shown there as plain text, so keep replies compact and formatting simple.',
    '',
    'Shift-clicked items, spells, quests, and talents appear as [Name] in the message. Tooltip text, when the game returned it, is under a "Linked from the game" heading.',
  ];
  if (context) {
    lines.push(
      '',
      'In-game situation reported by the addon:',
      context,
      '',
      'Use that situation for questions about the character, zone, quests, gear, professions, or macros. Ignore it when the task is unrelated.',
    );
  }
  if (ref) {
    lines.push('', 'Reference for addons and macros on this client:', ref);
  }
  lines.push(
    '',
    'Do not automate gameplay, read process memory, or generate input. Answer, explain, and write code the player can read.',
  );
  return lines.join('\n');
}

function buildGrokArgv(opts) {
  const argv = [opts.grokPath || 'grok', '--no-auto-update', '--no-alt-screen'];
  const prompt = String(opts.prompt ?? '');
  const rules = String(opts.rules || '');
  const cwd = String(opts.cwd || '');
  const viaFile = prompt.length + rules.length + cwd.length > 7400;
  if (viaFile) argv.push('--prompt-file', opts.promptFile || 'PROMPT_FILE');
  else argv.push('-p', prompt);
  if (cwd) argv.push('--cwd', cwd);
  if (opts.resumeId && !opts.newSession) argv.push('-r', opts.resumeId);
  else if (opts.sessionId) argv.push('-s', opts.sessionId);
  argv.push('--output-format', 'streaming-json');
  if (rules) argv.push('--rules', rules);
  if (opts.permissionMode) argv.push('--permission-mode', opts.permissionMode);
  if (opts.model) argv.push('-m', opts.model);
  for (const rule of opts.allow || []) {
    if (rule) argv.push('--allow', rule);
  }
  if (opts.alwaysApprove) argv.push('--always-approve');
  return { argv, viaFile, prompt };
}

function buildApiBody({ model, prompt, rules, previousId }) {
  const body = {
    model: model || 'grok-4.7',
    input: String(prompt ?? ''),
  };
  if (rules) body.instructions = rules;
  if (previousId) body.previous_response_id = previousId;
  return body;
}

function textFromResponse(data) {
  if (!data || typeof data !== 'object') return '';
  if (typeof data.output_text === 'string' && data.output_text) return data.output_text;
  const chunks = [];
  for (const item of data.output || []) {
    if (!item) continue;
    if (typeof item === 'string') chunks.push(item);
    if (item.type === 'message') {
      for (const part of item.content || []) {
        if (part && (part.type === 'output_text' || part.type === 'text') && part.text) chunks.push(part.text);
      }
    }
    if (item.text && (item.type === 'output_text' || item.type === 'text')) chunks.push(item.text);
  }
  return chunks.join('');
}

function asUpdate(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.method === 'session/update' && obj.params && obj.params.update) return obj.params.update;
  if (obj.sessionUpdate) return obj;
  if (obj.update && obj.update.sessionUpdate) return obj.update;
  if (obj.type === 'session_update' && obj.update) return obj.update;
  return null;
}

function parseStreamLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed || trimmed[0] !== '{') return null;
  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const update = asUpdate(obj);
  if (update) return { kind: 'update', update };
  if (obj.type === 'result' || obj.permission_denials || obj.result) {
    return { kind: 'result', result: obj };
  }
  return null;
}

function describeAction(update) {
  const input = update.rawInput || update.input || {};
  const name = update.title || update.kind || update.toolName || update.name || 'tool';
  if (input.command) return ('$ ' + String(input.command).split('\n')[0]).slice(0, 110);
  const file = input.path || input.file_path || input.target_file || input.file;
  if (file) return `${name} ${path.basename(String(file))}`.slice(0, 110);
  if (input.pattern) return `search ${input.pattern}`.slice(0, 110);
  if (input.query) return `search ${input.query}`.slice(0, 110);
  if (input.url) return `fetch ${input.url}`.slice(0, 110);
  return String(name).slice(0, 110);
}

function ruleForDenial(update) {
  const input = update.rawInput || update.input || update.tool_input || {};
  if (input.command) {
    const word = String(input.command).trim().split(/\s+/)[0] || '';
    if (word && /^[\w.+-]+$/.test(word)) return `Shell(${word}:*)`;
  }
  const tool = update.tool_name || update.toolName || update.name || update.kind || update.title || 'tool';
  return String(tool).trim().replace(/\s+/g, '_') || 'tool';
}

function isDenial(update) {
  if (!update) return false;
  if (update.permissionDenied === true) return true;
  const status = String(update.status || '').toLowerCase();
  if (status === 'denied') return true;
  const blob = JSON.stringify(update.rawOutput || update.content || update.error || update.reason || '').toLowerCase();
  if ((status === 'failed' || status === 'error') && /permission|denied|not allowed|approval/.test(blob)) return true;
  return false;
}

function reduceStream(lines) {
  let text = '';
  const actions = [];
  const denied = [];
  let sessionId = '';
  let error = '';
  const seenRules = new Set();
  const pushDenial = (rule) => {
    if (rule && !seenRules.has(rule)) {
      seenRules.add(rule);
      denied.push(rule);
    }
  };
  for (const line of lines) {
    const ev = typeof line === 'string' ? parseStreamLine(line) : line;
    if (!ev) continue;
    if (ev.kind === 'result') {
      const result = ev.result || {};
      if (typeof result.result === 'string' && result.result) text = result.result;
      if (result.session_id) sessionId = result.session_id;
      if (result.error) error = String(result.error.message || result.error);
      for (const d of result.permission_denials || []) pushDenial(ruleForDenial(d));
      continue;
    }
    const update = ev.update || {};
    const kind = update.sessionUpdate || '';
    if (kind === 'agent_message_chunk' || kind === 'agent_message') {
      const chunk = update.content && update.content.text;
      if (chunk) text += chunk;
    } else if (kind === 'tool_call' || kind === 'tool_call_update') {
      if (kind === 'tool_call' || update.title || update.rawInput) actions.push(describeAction(update));
      if (isDenial(update)) pushDenial(ruleForDenial(update));
    }
    if (update.sessionId && !sessionId) sessionId = update.sessionId;
  }
  return { text, actions, denied, sessionId, error };
}

function luaString(s) {
  const escaped = String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, (ch) => '\\' + String(ch.charCodeAt(0)).padStart(3, '0'));
  return `"${escaped}"`;
}

function luaTable(globalName, records, opts = {}) {
  const now = opts.now || Date.now();
  const lines = [
    '-- Written by the WowGrok companion. Do not edit by hand.',
    `${globalName} = {`,
    `\tts = ${luaString(new Date(now).toISOString())},`,
    `\tnow = ${Math.floor(now / 1000)},`,
    `\tcwd = ${luaString(opts.cwd || '')},`,
    '\treplies = {',
  ];
  for (const r of records || []) {
    lines.push('\t\t{');
    lines.push(`\t\t\tchat = ${luaString(r.chat || '')},`);
    lines.push(`\t\t\tid = ${Number(r.id) || 0},`);
    lines.push(`\t\t\tstatus = ${luaString(r.status || '')},`);
    lines.push(`\t\t\ttext = ${luaString(r.text || '')},`);
    lines.push(`\t\t\tcwd = ${luaString(r.cwd || '')},`);
    lines.push(`\t\t\tsession = ${luaString(r.session || '')},`);
    if (Array.isArray(r.denied) && r.denied.length) {
      lines.push(`\t\t\tdenied = { ${r.denied.map(luaString).join(', ')} },`);
    }
    lines.push('\t\t},');
  }
  lines.push('\t},');
  const restore = opts.restore;
  if (restore && restore.chats) {
    lines.push('\trestore = {', `\t\ttoken = ${luaString(restore.token || '')},`, '\t\tchats = {');
    for (const c of restore.chats) {
      lines.push('\t\t\t{');
      lines.push(`\t\t\t\tid = ${luaString(c.id || '')},`);
      lines.push(`\t\t\t\tname = ${luaString(c.name || '')},`);
      lines.push(`\t\t\t\tcwd = ${luaString(c.cwd || '')},`);
      lines.push('\t\t\t\tmessages = {');
      for (const m of c.messages || []) {
        lines.push(
          `\t\t\t\t\t{ role = ${luaString(m.role || '')}, id = ${Number(m.id) || 0}, t = ${Number(m.t) || 0}, text = ${luaString(m.text || '')} },`,
        );
      }
      lines.push('\t\t\t\t},', '\t\t\t},');
    }
    lines.push('\t\t},', '\t},');
  }
  lines.push('}', '');
  return lines.join('\n');
}

function silentWav() {
  const rate = 8000;
  const samples = 80;
  const b = Buffer.alloc(44 + samples);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + samples, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write('data', 36);
  b.writeUInt32LE(samples, 40);
  b.fill(128, 44);
  return b;
}

function uuid() {
  return crypto.randomUUID();
}

module.exports = {
  MAGIC1,
  MAGIC2,
  BITS,
  MAX_PAYLOAD,
  CELLS_PER_ROW,
  MAX_ROWS,
  MONTH_MS,
  pad3,
  pad4,
  slotNumber,
  fletcher16,
  bytesToCells,
  cellColor,
  encodeFrame,
  decodeCells,
  decodeBytes,
  parseFlags,
  encodeRecord,
  encodePayload,
  parsePayload,
  toHex,
  fromHex,
  parseOutbox,
  resolveCwd,
  sameFolder,
  alreadyHandled,
  markHandled,
  pruneStale,
  rulesText,
  buildGrokArgv,
  buildApiBody,
  textFromResponse,
  parseStreamLine,
  describeAction,
  reduceStream,
  luaString,
  luaTable,
  silentWav,
  uuid,
};
