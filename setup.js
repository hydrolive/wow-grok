#!/usr/bin/env node
'use strict';

// node setup.js --project DIR [--wow CLIENT] [--account NAME]
// Copies the addon, writes bridge/config.json, and builds the slot pool.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const ADDON_SRC = path.join(ROOT, 'addon', 'WowGrok');
const BRIDGE = path.join(ROOT, 'bridge');
const EXAMPLE = path.join(BRIDGE, 'config.example.json');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next != null && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else args[key] = true;
  }
  return args;
}

function isClient(dir) {
  try {
    return fs.existsSync(path.join(dir, 'Interface'))
      && fs.readdirSync(dir).some((f) => /^Wow.*\.exe$/i.test(f));
  } catch {
    return false;
  }
}

function findClient(args) {
  if (args.wow) {
    if (isClient(args.wow)) return path.resolve(args.wow);
    throw new Error(`--wow "${args.wow}" does not look like a WoW client folder (needs Interface\\ and a Wow*.exe)`);
  }
  const roots = [
    process.env['ProgramFiles(x86)'],
    process.env.ProgramFiles,
    'D:\\',
    'E:\\',
    'D:\\Games',
    'E:\\Games',
    'C:\\Games',
  ].filter(Boolean);
  const flavors = ['_forever_', '_classic_beta_', '_classic_era_', '_classic_', '_retail_'];
  for (const root of roots) {
    const wow = path.join(root, 'World of Warcraft');
    for (const flavor of flavors) {
      const dir = path.join(wow, flavor);
      if (isClient(dir)) return dir;
    }
    if (isClient(wow)) return wow;
  }
  throw new Error('Could not find the WoW client. Pass --wow "C:\\\\path\\\\to\\\\World of Warcraft\\\\_forever_"');
}

function findAccount(client, args) {
  const base = path.join(client, 'WTF', 'Account');
  let names = [];
  try {
    names = fs.readdirSync(base).filter((n) => {
      if (n === 'SavedVariables') return false;
      return fs.statSync(path.join(base, n)).isDirectory();
    });
  } catch { /* not created until the first login */ }
  if (args.account) {
    if (!names.includes(args.account)) throw new Error(`Account "${args.account}" not found under ${base}`);
    return args.account;
  }
  if (!names.length) throw new Error(`No account folder under ${base}. Log into the game once, then run setup again.`);
  if (names.length > 1) {
    console.log(`Several accounts found (${names.join(', ')}); using "${names[0]}". Pass --account to choose another.`);
  }
  return names[0];
}

function copyAddon(client) {
  const dest = path.join(client, 'Interface', 'AddOns', 'WowGrok');
  fs.mkdirSync(dest, { recursive: true });
  let copied = 0;
  for (const file of fs.readdirSync(ADDON_SRC)) {
    const from = path.join(ADDON_SRC, file);
    if (!fs.statSync(from).isFile()) continue;
    const target = path.join(dest, file);
    if (file === 'Inbox.lua' && fs.existsSync(target)) continue;
    fs.copyFileSync(from, target);
    copied++;
  }
  return { dest, copied };
}

function writeConfig(client, account, args) {
  const configPath = args.config ? path.resolve(args.config) : path.join(BRIDGE, 'config.json');
  if (fs.existsSync(configPath) && !args.force) {
    console.log(`config   : ${configPath} already exists, keeping it`);
    return { configPath, cfg: JSON.parse(fs.readFileSync(configPath, 'utf8')), wrote: false };
  }
  const cfg = JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'));
  cfg.addonDir = path.join(client, 'Interface', 'AddOns');
  cfg.inboxFile = path.join(cfg.addonDir, 'WowGrok', 'Inbox.lua');
  cfg.savedVariablesFile = path.join(client, 'WTF', 'Account', account, 'SavedVariables', 'WowGrok.lua');
  cfg.defaultCwd = args.project ? path.resolve(args.project) : process.cwd();
  const exe = fs.readdirSync(client).find((f) => /^Wow.*\.exe$/i.test(f));
  if (exe) cfg.capture.processName = exe.replace(/\.exe$/i, '');
  if (args.slots) cfg.slots = Number(args.slots);
  if (args['act-max']) cfg.actMax = Number(args['act-max']);
  if (args['presence-max']) cfg.presenceMax = Number(args['presence-max']);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`config   : wrote ${configPath}`);
  return { configPath, cfg, wrote: true };
}

function run(argv = process.argv) {
  const args = parseArgs(argv);
  const client = findClient(args);
  console.log(`client   : ${client}`);
  const account = findAccount(client, args);
  console.log(`account  : ${account}`);
  const { dest, copied } = copyAddon(client);
  console.log(`addon    : ${copied} file(s) -> ${dest}`);
  const { configPath, cfg } = writeConfig(client, account, args);
  console.log(`project  : ${cfg.defaultCwd}`);
  console.log('slots    : building the reply-slot pool and signal files...');
  const child = spawnSync(process.execPath, [path.join(BRIDGE, 'install-slots.js'), '--config', configPath], {
    stdio: 'inherit',
  });
  if (child.status !== 0) throw new Error('install-slots.js failed');
  console.log(`
Done. Next:
  1. Fully quit and relaunch World of Warcraft so it discovers the new addon files.
  2. Enable WowGrok at the AddOns screen. Leave the WowGrok slot entries enabled.
  3. Start the companion:  npm start
     bridge\\start-window.cmd opens its own window and restarts after a crash.
  4. In game:  /wow-grok   or   /grok
`);
  return { client, account, configPath, cfg };
}

if (require.main === module) {
  try {
    run();
  } catch (err) {
    console.error('setup failed:', err.message);
    process.exit(1);
  }
}

module.exports = { parseArgs, isClient, findClient, findAccount, copyAddon, writeConfig, run };
