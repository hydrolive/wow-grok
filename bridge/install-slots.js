#!/usr/bin/env node
'use strict';

// Creates WowGrok_S001..S200 and the signal wavs. WoW indexes addon files at
// launch, so this runs once and then the client is restarted. Re-runs keep
// slot Inbox.lua files the companion may already have published.

const fs = require('fs');
const path = require('path');
const { pad3, pad4, silentWav } = require('./protocol');

function cliValue(name) {
  const i = process.argv.indexOf('--' + name);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return null;
}

function loadConfig() {
  const explicit = cliValue('config');
  const fallback = path.join(__dirname, 'config.json');
  const file = explicit || (fs.existsSync(fallback) ? fallback : null);
  if (!file) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function installSlots(options) {
  const cfg = options.config || {};
  const addons = options.addonDir || cfg.addonDir;
  if (!addons) throw new Error('addonDir is required (bridge/config.json or --addon-dir)');
  const slots = Number(options.slots || cfg.slots || 200);
  const actMax = Number(options.actMax || cfg.actMax || 60);
  const presenceMax = Number(options.presenceMax || cfg.presenceMax || 2000);
  const iface = String(options.tocInterface || cfg.tocInterface || '16001');
  const addon = path.join(addons, 'WowGrok');
  if (!options.allowMissing && !fs.existsSync(path.join(addon, 'WowGrok.toc'))) {
    throw new Error('WowGrok addon not found under ' + addons + '. Run setup.js first.');
  }
  fs.mkdirSync(addon, { recursive: true });

  let made = 0;
  let kept = 0;
  function ensure(file, content, overwrite) {
    if (fs.existsSync(file) && !overwrite) {
      kept++;
      return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    made++;
  }

  for (let i = 1; i <= slots; i++) {
    const name = 'WowGrok_S' + pad3(i);
    const dir = path.join(addons, name);
    ensure(path.join(dir, name + '.toc'), [
      '## Interface: ' + iface,
      '## Title: WowGrok slot ' + pad3(i),
      '## Notes: Reply slot for WowGrok. Load-on-demand; leave it enabled.',
      '## LoadOnDemand: 1',
      '## Dependencies: WowGrok',
      '',
      'Inbox.lua',
      '',
    ].join('\n'), true);
    ensure(path.join(dir, 'Inbox.lua'), 'WowGrok_SlotData = nil\n', false);
    ensure(path.join(addon, 'sig', pad3(i) + '.wav'), Buffer.alloc(0));
    ensure(path.join(addon, 'ack', pad3(i) + '.wav'), Buffer.alloc(0));
    for (let k = 1; k <= actMax; k++) {
      ensure(path.join(addon, 'act', pad3(i), String(k).padStart(2, '0') + '.wav'), Buffer.alloc(0));
    }
  }
  for (let k = 1; k <= presenceMax; k++) {
    ensure(path.join(addon, 'presence', pad4(k) + '.wav'), Buffer.alloc(0));
  }
  ensure(path.join(addon, 'ctl', 'empty.wav'), Buffer.alloc(0), true);
  ensure(path.join(addon, 'ctl', 'valid.wav'), silentWav(), true);
  return { slots, made, kept, addon };
}

if (require.main === module) {
  try {
    const cfg = loadConfig();
    const result = installSlots({
      config: cfg,
      addonDir: cliValue('addon-dir'),
      slots: cliValue('slots'),
      actMax: cliValue('act-max'),
      presenceMax: cliValue('presence-max'),
      tocInterface: cliValue('interface'),
    });
    console.log(`slots: ${result.slots}  files created: ${result.made}  already present: ${result.kept}`);
    if (result.made > 0) console.log('Fully quit and relaunch WoW so it sees new addon files.');
  } catch (err) {
    console.error('install-slots failed:', err.message);
    process.exit(1);
  }
}

module.exports = { installSlots };
