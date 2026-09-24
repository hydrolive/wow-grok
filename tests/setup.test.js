'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../setup');

test('setup copies the addon and builds a small slot pool', { timeout: 60000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wowgrok-setup-'));
  const client = path.join(root, 'Wow');
  fs.mkdirSync(path.join(client, 'Interface'), { recursive: true });
  fs.mkdirSync(path.join(client, 'WTF', 'Account', 'Player'), { recursive: true });
  fs.writeFileSync(path.join(client, 'WowB.exe'), '');
  const project = path.join(root, 'project');
  fs.mkdirSync(project);
  const config = path.join(root, 'config.json');
  const result = run([
    'node', 'setup.js',
    '--wow', client,
    '--project', project,
    '--account', 'Player',
    '--config', config,
    '--slots', '2',
    '--act-max', '1',
    '--presence-max', '2',
  ]);
  assert.equal(result.cfg.defaultCwd, project);
  assert.equal(result.cfg.capture.processName, 'WowB');
  assert.equal(result.cfg.slots, 2);
  assert.ok(fs.existsSync(path.join(client, 'Interface', 'AddOns', 'WowGrok', 'WowGrok.lua')));
  assert.match(
    fs.readFileSync(path.join(client, 'Interface', 'AddOns', 'WowGrok_S002', 'WowGrok_S002.toc'), 'utf8'),
    /LoadOnDemand: 1/,
  );
  fs.rmSync(root, { recursive: true, force: true });
});
