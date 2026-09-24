'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackend, CliBackend } = require('../bridge/grok-backend');

test('echo repeats the prompt and can require approval', async () => {
  const echo = createBackend('echo');
  const ok = await echo.run({ prompt: 'hi', sessionId: '11111111-1111-4111-8111-111111111111' });
  assert.equal(ok.text, 'Echo: hi');
  assert.deepEqual(ok.denied, []);
  const denied = await echo.run({ prompt: 'go [[deny:WebSearch]]', sessionId: '11111111-1111-4111-8111-111111111111' });
  assert.deepEqual(denied.denied, ['WebSearch']);
  const allowed = await echo.run({
    prompt: 'go [[deny:WebSearch]]',
    allow: ['WebSearch'],
    sessionId: '11111111-1111-4111-8111-111111111111',
  });
  assert.equal(allowed.text, 'Echo: go [[deny:WebSearch]]');
  assert.deepEqual(allowed.denied, []);
});

test('cli argv is the headless grok command and not ACP', () => {
  const cli = new CliBackend({ grokPath: 'grok' });
  const plan = cli.plan({
    prompt: 'explain this',
    cwd: 'C:\\work',
    sessionId: '11111111-1111-4111-8111-111111111111',
    rules: 'primer',
    permissionMode: 'default',
    alwaysApprove: false,
  });
  assert.deepEqual(plan.argv.slice(0, 4), ['grok', '--no-auto-update', '--no-alt-screen', '-p']);
  assert.ok(plan.argv.includes('--output-format'));
  assert.ok(plan.argv.includes('streaming-json'));
  assert.ok(!plan.argv.includes('--always-approve'));
  assert.ok(plan.argv.includes('auto'));
  assert.ok(!plan.argv.includes('agent'));
  const long = cli.plan({
    prompt: 'y'.repeat(8000),
    cwd: 'C:\\work',
    sessionId: '11111111-1111-4111-8111-111111111111',
    rules: 'primer',
  });
  assert.equal(long.viaFile, true);
  assert.ok(long.argv.includes('--prompt-file'));
  assert.ok(!long.argv.includes('-p'));
});

test('api backend reports a missing key without calling the network', async () => {
  const previous = process.env.XAI_API_KEY;
  delete process.env.XAI_API_KEY;
  try {
    const api = createBackend('api');
    const result = await api.run({ prompt: 'hi', rules: 'primer' });
    assert.match(result.error, /XAI_API_KEY/);
    const body = api.plan({ prompt: 'hi', rules: 'primer', resumeId: 'resp_9' });
    assert.equal(body.previous_response_id, 'resp_9');
    assert.equal(body.instructions, 'primer');
  } finally {
    if (previous != null) process.env.XAI_API_KEY = previous;
  }
});

test('unknown backend names are rejected', () => {
  assert.throws(() => createBackend('acp'), /echo, cli, or api/);
});
