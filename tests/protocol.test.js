'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const protocol = require('../bridge/protocol');

test('fletcher16 matches a hand-computed pair', () => {
  const [s1, s2] = protocol.fletcher16([1, 2], 0, 1);
  assert.deepEqual([s1, s2], [3, 4]);
});

test('frame roundtrip keeps unicode, separators, and the id', () => {
  const payload = protocol.encodePayload([
    {
      session: 'abc',
      chat: '1',
      id: 12,
      cwd: 'realms',
      name: 'Chat 1',
      ctx: 'Character: Tester',
      text: 'hello café 刀',
      retry: 2,
    },
  ]);
  const frame = protocol.encodeFrame(12, payload);
  assert.equal(frame.error, undefined);
  assert.equal(frame.bytes[0], 0xc7);
  assert.equal(frame.bytes[1], 0x1a);
  const decoded = protocol.decodeCells(frame.cells);
  assert.equal(decoded.error, undefined);
  assert.equal(decoded.id, 12);
  assert.equal(decoded.text, payload);
  const jobs = protocol.parsePayload(decoded.id, decoded.text);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].text, 'hello café 刀');
  assert.equal(jobs[0].ctx, 'Character: Tester');
  assert.equal(jobs[0].hasContext, true);
  assert.equal(jobs[0].retry, 2);
  assert.equal(jobs[0].chat, '1');
});

test('checksum and magic failures are rejected', () => {
  const frame = protocol.encodeFrame(4, 'ping');
  const broken = frame.cells.slice();
  broken[10] = (broken[10] + 1) % 8;
  const decoded = protocol.decodeCells(broken);
  assert.ok(['checksum', 'magic', 'truncated', 'length'].includes(decoded.error));
  assert.equal(protocol.decodeBytes([1, 2, 3, 4]).error, 'magic');
});

test('flags carry a fresh session, hello, forget, and allow rules', () => {
  const flags = protocol.parseFlags('n;h;d;c;allow=Shell(npm:*),WebSearch;r=3');
  assert.equal(flags.newSession, true);
  assert.equal(flags.hello, true);
  assert.equal(flags.forget, true);
  assert.equal(flags.hasContext, true);
  assert.equal(flags.retry, 3);
  assert.deepEqual(flags.allow, ['Shell(npm:*)', 'WebSearch']);
});

test('outbox hex fields become one job', () => {
  const src = `
WowGrokDB = {
["outbox"] = {
["id"] = 9,
["session"] = "abc",
["chat"] = "2",
["name"] = "${protocol.toHex('Quest')}",
["cwd"] = "${protocol.toHex('C:\\\\work')}",
["text"] = "${protocol.toHex('hi')}",
["flags"] = "n;c",
["ctx"] = "${protocol.toHex('Character: A')}",
["newSession"] = true,
},
}
`;
  const job = protocol.parseOutbox(src);
  assert.equal(job.id, 9);
  assert.equal(job.text, 'hi');
  assert.equal(job.name, 'Quest');
  assert.equal(job.ctx, 'Character: A');
  assert.equal(job.newSession, true);
  assert.equal(job.via, 'reload');
  assert.equal(protocol.parseOutbox('no outbox'), null);
});

test('folders resolve against the default and ~', () => {
  const base = 'C:\\work';
  assert.equal(protocol.resolveCwd('', base), protocol.resolveCwd(base, base));
  assert.equal(protocol.resolveCwd('realms', base).toLowerCase(), 'c:\\work\\realms');
  assert.ok(protocol.sameFolder('C:\\Work', 'c:\\work'));
});

test('dedup is per addon session token', () => {
  const state = { handled: {}, lastId: 0, seen: {} };
  const job = { session: 'aaa', id: 3 };
  assert.equal(protocol.alreadyHandled(state, job), false);
  protocol.markHandled(state, job, 10);
  assert.equal(protocol.alreadyHandled(state, job), true);
  assert.equal(protocol.alreadyHandled(state, { session: 'bbb', id: 3 }), false);
});

test('rules and grok argv stay headless and do not auto-approve', () => {
  const rules = protocol.rulesText('Character: Tester', 'Write addons carefully.');
  assert.match(rules, /Character: Tester/);
  assert.match(rules, /Write addons carefully/);
  assert.match(rules, /Do not automate gameplay/);
  assert.equal(protocol.rulesText('', ''), '');
  const { argv, viaFile } = protocol.buildGrokArgv({
    prompt: 'hello',
    cwd: 'C:\\work',
    sessionId: '11111111-1111-4111-8111-111111111111',
    rules,
    permissionMode: 'default',
    allow: ['WebSearch'],
    alwaysApprove: false,
  });
  assert.equal(viaFile, false);
  assert.ok(argv.includes('-p'));
  assert.ok(argv.includes('hello'));
  assert.ok(argv.includes('--output-format'));
  assert.ok(argv.includes('streaming-json'));
  assert.ok(argv.includes('--rules'));
  assert.ok(argv.includes('-s'));
  assert.ok(!argv.includes('-r'));
  assert.ok(!argv.includes('--always-approve'));
  assert.ok(!argv.includes('stdio'));
  const resumed = protocol.buildGrokArgv({
    prompt: 'next',
    cwd: 'C:\\work',
    sessionId: '11111111-1111-4111-8111-111111111111',
    resumeId: '11111111-1111-4111-8111-111111111111',
    newSession: false,
    alwaysApprove: true,
  });
  assert.ok(resumed.argv.includes('-r'));
  assert.ok(!resumed.argv.includes('-s'));
  assert.ok(resumed.argv.includes('--always-approve'));
});

test('api body uses instructions and previous_response_id', () => {
  const body = protocol.buildApiBody({
    model: 'grok-4.7',
    prompt: 'hi',
    rules: 'primer',
    previousId: 'resp_1',
  });
  assert.equal(body.model, 'grok-4.7');
  assert.equal(body.input, 'hi');
  assert.equal(body.instructions, 'primer');
  assert.equal(body.previous_response_id, 'resp_1');
  assert.equal(protocol.textFromResponse({ output_text: 'ok' }), 'ok');
});

test('streaming-json reduction keeps text, actions, and denials', () => {
  const lines = [
    '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Hello "}}}}',
    '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"tool_call","toolCallId":"1","title":"read WowGrok.lua","kind":"read","status":"in_progress","rawInput":{"path":"addon/WowGrok/WowGrok.lua"}}}}',
    '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"tool_call_update","toolCallId":"1","status":"failed","rawOutput":{"reason":"permission denied"},"kind":"execute","rawInput":{"command":"npm test"}}}}',
    '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"from Grok"}}}}',
  ];
  const reduced = protocol.reduceStream(lines);
  assert.equal(reduced.text, 'Hello from Grok');
  assert.match(reduced.actions[0], /WowGrok\.lua/);
  assert.ok(reduced.denied.includes('Shell(npm:*)'));
});

test('slot lua roundtrips through a lua vm', () => {
  const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require('fengari');
  const src = protocol.luaTable('WowGrok_SlotData', [
    {
      chat: '1',
      id: 4,
      status: 'done',
      text: 'a"b\\c\nhi',
      cwd: 'C:\\wow',
      session: 'sess',
      denied: ['WebSearch'],
    },
  ], { now: 1_700_000_000_000, cwd: 'D:\\proj', restore: { token: 'abc', chats: [] } });
  assert.match(src, /WowGrok_SlotData/);
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const status = lauxlib.luaL_dostring(L, to_luastring(src + '\n__out = WowGrok_SlotData.replies[1].text .. "|" .. WowGrok_SlotData.replies[1].denied[1] .. "|" .. WowGrok_SlotData.cwd\n'));
  if (status !== lua.LUA_OK) throw new Error(to_jsstring(lua.lua_tostring(L, -1)));
  lua.lua_getglobal(L, to_luastring('__out'));
  const out = to_jsstring(lua.lua_tostring(L, -1));
  assert.equal(out, 'a"b\\c\nhi|WebSearch|D:\\proj');
});
