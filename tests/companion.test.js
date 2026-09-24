'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCompanion } = require('../bridge/index');

async function companion() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wowgrok-companion-'));
  const addonDir = path.join(home, 'AddOns');
  fs.mkdirSync(path.join(addonDir, 'WowGrok'), { recursive: true });
  const comp = createCompanion({
    home,
    addonDir,
    backend: 'echo',
    noLock: true,
    quiet: true,
    defaultCwd: home,
    config: {
      slots: 8,
      actMax: 2,
      presenceMax: 4,
      presenceLookahead: 2,
      backend: 'echo',
      gameContext: true,
      primerText: 'PRIMER',
      alwaysApprove: false,
      permissionMode: 'default',
      allowedTools: [],
      maxParallel: 2,
      defaultCwd: home,
    },
  });
  return { home, addonDir, comp };
}

test('echo backend publishes a reply, an ack, and a restore bundle', async () => {
  const { home, addonDir, comp } = await companion();
  try {
    comp.submit({
      session: 'token-a',
      chat: '1',
      id: 1,
      cwd: '',
      name: 'Chat 1',
      hello: true,
      hasContext: true,
      ctx: 'Character: Tester',
      text: '',
    });
    assert.equal(comp.state.context, 'Character: Tester');
    comp.submit({ session: 'token-a', chat: '1', id: 2, cwd: 'realms', name: 'Chat 1', text: 'hi' });
    await comp.drain();
    const inbox = fs.readFileSync(path.join(addonDir, 'WowGrok', 'Inbox.lua'), 'utf8');
    assert.match(inbox, /WowGrok_SlotData/);
    assert.match(inbox, /Echo: hi/);
    assert.match(inbox, /restore = /);
    assert.match(inbox, /token-a/);
    assert.ok(fs.statSync(path.join(addonDir, 'WowGrok', 'ack', '002.wav')).size > 40);
    assert.ok(fs.statSync(path.join(addonDir, 'WowGrok', 'sig', '002.wav')).size > 40);
    const slot = fs.readFileSync(path.join(addonDir, 'WowGrok_S001', 'Inbox.lua'), 'utf8');
    assert.equal(slot, inbox);
    comp.submit({ session: 'token-a', chat: '1', id: 2, text: 'hi again' });
    await comp.drain();
    const again = fs.readFileSync(path.join(addonDir, 'WowGrok', 'Inbox.lua'), 'utf8');
    assert.match(again, /Echo: hi/);
    assert.doesNotMatch(again, /hi again/);
  } finally {
    await comp.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('allow rules satisfy an echo denial on retry', async () => {
  const { home, comp, addonDir } = await companion();
  try {
    comp.submit({ session: 'token-b', chat: '4', id: 4, name: 'Gear', text: 'look [[deny:WebSearch]]' });
    await comp.drain();
    let inbox = fs.readFileSync(path.join(addonDir, 'WowGrok', 'Inbox.lua'), 'utf8');
    assert.match(inbox, /denied = \{ "WebSearch" \}/);
    comp.submit({
      session: 'token-b',
      chat: '4',
      id: 5,
      name: 'Gear',
      text: 'look [[deny:WebSearch]]',
      allow: ['WebSearch'],
    });
    await comp.drain();
    inbox = fs.readFileSync(path.join(addonDir, 'WowGrok', 'Inbox.lua'), 'utf8');
    assert.match(inbox, /Echo: look/);
    assert.doesNotMatch(inbox, /denied = /);
    assert.ok(comp.config.allowedTools.includes('WebSearch'));
    assert.equal(comp.beat(), 1);
    assert.ok(fs.statSync(path.join(addonDir, 'WowGrok', 'presence', '0001.wav')).size > 40);
    assert.equal(fs.statSync(path.join(addonDir, 'WowGrok', 'presence', '0002.wav')).size, 0);
  } finally {
    await comp.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('saved variables outbox is accepted once', async () => {
  const { home, comp, addonDir } = await companion();
  try {
    const protocol = require('../bridge/protocol');
    const src = `WowGrokDB = {\n["outbox"] = {\n["id"] = 6,\n["session"] = "token-c",\n["chat"] = "1",\n["name"] = "${protocol.toHex('Chat 1')}",\n["cwd"] = "",\n["text"] = "${protocol.toHex('from reload')}",\n["flags"] = "",\n},\n}\n`;
    comp.pollOutbox(src);
    comp.pollOutbox(src);
    await comp.drain();
    const inbox = fs.readFileSync(path.join(addonDir, 'WowGrok', 'Inbox.lua'), 'utf8');
    assert.match(inbox, /Echo: from reload/);
  } finally {
    await comp.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
