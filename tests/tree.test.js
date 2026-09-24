'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const required = [
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'AGENTS.md',
  'package.json',
  'setup.js',
  'addon/WowGrok/WowGrok.toc',
  'addon/WowGrok/WowGrok.lua',
  'addon/WowGrok/Codec.lua',
  'addon/WowGrok/Context.lua',
  'addon/WowGrok/UI.lua',
  'addon/WowGrok/Slash.lua',
  'addon/WowGrok/Inbox.lua',
  'addon/WowGrok/Bindings.xml',
  'bridge/index.js',
  'bridge/protocol.js',
  'bridge/grok-backend.js',
  'bridge/capture.ps1',
  'bridge/install-slots.js',
  'bridge/config.example.json',
  'bridge/start.ps1',
  'bridge/start-window.cmd',
  'docs/ARCHITECTURE.md',
  'docs/INSTALL-WINDOWS.md',
  'docs/CONFIGURATION.md',
  'docs/WOW-GROK-PRIMER.md',
  'docs/TOS-AND-SAFETY.md',
];

test('the project tree matches the WowGrok layout', () => {
  for (const file of required) {
    assert.ok(fs.existsSync(path.join(root, file)), file);
  }
  const toc = fs.readFileSync(path.join(root, 'addon/WowGrok/WowGrok.toc'), 'utf8');
  assert.match(toc, /## Interface: 16001/);
  assert.match(toc, /WowGrokDB/);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.test.includes('node --test'), true);
  assert.equal(pkg.scripts.start, 'node bridge/index.js');
});
