'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { installSlots } = require('../bridge/install-slots');

test('install-slots writes load-on-demand addons and the signal pair', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wowgrok-slots-'));
  const addonDir = path.join(root, 'AddOns');
  fs.mkdirSync(path.join(addonDir, 'WowGrok'), { recursive: true });
  fs.writeFileSync(path.join(addonDir, 'WowGrok', 'WowGrok.toc'), '## Interface: 16001\n');
  const result = installSlots({
    addonDir,
    slots: 2,
    actMax: 2,
    presenceMax: 3,
    tocInterface: '16001',
  });
  assert.equal(result.slots, 2);
  const toc = fs.readFileSync(path.join(addonDir, 'WowGrok_S001', 'WowGrok_S001.toc'), 'utf8');
  assert.match(toc, /## Interface: 16001/);
  assert.match(toc, /## LoadOnDemand: 1/);
  assert.match(toc, /## Dependencies: WowGrok/);
  assert.equal(fs.readFileSync(path.join(addonDir, 'WowGrok_S001', 'Inbox.lua'), 'utf8'), 'WowGrok_SlotData = nil\n');
  assert.equal(fs.statSync(path.join(addonDir, 'WowGrok', 'sig', '001.wav')).size, 0);
  assert.equal(fs.statSync(path.join(addonDir, 'WowGrok', 'ctl', 'empty.wav')).size, 0);
  assert.equal(fs.readFileSync(path.join(addonDir, 'WowGrok', 'ctl', 'valid.wav')).subarray(0, 4).toString(), 'RIFF');
  assert.ok(fs.existsSync(path.join(addonDir, 'WowGrok', 'act', '002', '02.wav')));
  assert.ok(fs.existsSync(path.join(addonDir, 'WowGrok', 'presence', '0003.wav')));
  const again = installSlots({ addonDir, slots: 2, actMax: 2, presenceMax: 3 });
  assert.ok(again.kept > 0);
  fs.rmSync(root, { recursive: true, force: true });
});
