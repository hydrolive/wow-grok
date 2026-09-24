'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const protocol = require('../bridge/protocol');

function bootLua() {
  const fengari = require('fengari');
  const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const files = [
    'tests/wow_stub.lua',
    'addon/WowGrok/Codec.lua',
    'addon/WowGrok/Context.lua',
    'addon/WowGrok/WowGrok.lua',
    'addon/WowGrok/UI.lua',
    'addon/WowGrok/Slash.lua',
    'addon/WowGrok/Inbox.lua',
  ];
  for (const file of files) {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const status = lauxlib.luaL_dostring(L, to_luastring(src));
    if (status !== lua.LUA_OK) {
      throw new Error(file + ': ' + to_jsstring(lua.lua_tostring(L, -1)));
    }
  }
  function exec(code) {
    const status = lauxlib.luaL_dostring(L, to_luastring(code));
    if (status !== lua.LUA_OK) throw new Error(to_jsstring(lua.lua_tostring(L, -1)));
  }
  function globalString(name) {
    lua.lua_getglobal(L, to_luastring(name));
    if (lua.lua_type(L, -1) === lua.LUA_TNIL) {
      lua.lua_pop(L, 1);
      return '';
    }
    const value = to_jsstring(lua.lua_tostring(L, -1));
    lua.lua_pop(L, 1);
    return value;
  }
  return { exec, globalString };
}

test('addon codec matches the companion and a session roundtrips', () => {
  const { exec, globalString } = bootLua();
  exec(`
    local cells = WowGrok_Codec.Encode(7, "hello")
    local parts = {}
    for i, v in ipairs(cells) do parts[i] = string.format("%d", v) end
    WowGrokTest.codec = table.concat(parts, ",")
    local tooLong = WowGrok_Codec.Encode(1, string.rep("x", 3201))
    WowGrokTest.tooLong = tooLong == nil and "yes" or "no"
    local linked = WowGrok_Context.ExpandLinks("see |Hitem:2140|h[Fine Longsword]|h please")
    WowGrokTest.linked = linked
    local shortCtx = WowGrok_Context.GameContext(800)
    local helloCtx = WowGrok_Context.GameContext(1200)
    WowGrokTest.ctx800 = tostring(#shortCtx)
    WowGrokTest.ctx1200 = tostring(#helloCtx)
    WowGrokTest.hasCharacter = shortCtx:find("Character:", 1, true) and "yes" or "no"
    WowGrokTest.hasClient = helloCtx:find("Client:", 1, true) and "yes" or "no"
    WowGrokTest.sounds["Interface\\\\AddOns\\\\WowGrok\\\\ctl\\\\valid.wav"] = true
    WowGrok.events:GetScript("OnEvent")(WowGrok.events, "PLAYER_LOGIN")
    local diag = WowGrok.Diag()
    WowGrokTest.diag = diag
    WowGrokTest.sounds["Interface\\\\AddOns\\\\WowGrok\\\\ack\\\\001.wav"] = true
    if WowGrok.pending then WowGrok.pending.sentAt = time() - 5 end
    WowGrok.TransportTick()
    WowGrok.Send("ping")
    local parts2 = {}
    for i, cell in ipairs(WowGrok.strip.cells) do
      if not cell.shown then break end
      parts2[#parts2 + 1] = tostring(cell.r or 0) .. "," .. tostring(cell.g or 0) .. "," .. tostring(cell.b or 0)
    end
    WowGrokTest.colors = table.concat(parts2, ";")
    WowGrokTest.slots["WowGrok_S002"] = "WowGrok_SlotData = { ts = 't', now = " .. time() .. ", cwd = 'C:\\\\\\\\work', replies = { { chat = '1', id = " .. WowGrok.Active().waitingId .. ", status = 'done', text = 'Echo: ping', cwd = '', session = 'sess' } } }"
    local slot = WowGrok.SlotFor(WowGrok.Active().waitingId)
    WowGrokTest.sounds["Interface\\\\AddOns\\\\WowGrok\\\\sig\\\\" .. string.format("%03d", slot) .. ".wav"] = true
    WowGrok.TransportTick()
    local reply = ""
    for _, msg in ipairs(WowGrok.Active().history) do
      if msg.role == "grok" then reply = msg.text end
    end
    WowGrokTest.reply = reply
    WowGrokTest.button = WowGrok.sendButton:GetText()
    WowGrok.SetMode("reload")
    WowGrok.Send("fallback")
    WowGrokTest.outbox = WowGrokDB.outbox and WowGrokDB.outbox.text or ""
    WowGrok.Slash("help")
    WowGrokTest.help = WowGrokTest.prints[#WowGrokTest.prints]
    local ui = "no"
    for _, line in ipairs(WowGrokTest.prints) do
      if line:find("WowGrok UI:", 1, true) then ui = line end
    end
    WowGrokTest.uiError = ui
  `);

  exec('CODEC = WowGrokTest.codec; TOOLONG = WowGrokTest.tooLong; LINKED = WowGrokTest.linked; C800 = WowGrokTest.ctx800; C1200 = WowGrokTest.ctx1200; HASCHAR = WowGrokTest.hasCharacter; HASCLIENT = WowGrokTest.hasClient; DIAG = WowGrokTest.diag; COLORS = WowGrokTest.colors; REPLY = WowGrokTest.reply; BUTTON = WowGrokTest.button; OUTBOX = WowGrokTest.outbox; HELP = WowGrokTest.help; UIERR = WowGrokTest.uiError');
  const read = (name) => globalString(name);

  const jsCells = protocol.encodeFrame(7, 'hello').cells.join(',');
  assert.equal(read('CODEC'), jsCells);
  assert.equal(read('TOOLONG'), 'yes');
  assert.match(read('LINKED'), /\[Fine Longsword\]/);
  assert.match(read('LINKED'), /Linked from the game/);
  assert.ok(Number(read('C800')) <= 800);
  assert.ok(Number(read('C1200')) <= 1200);
  assert.equal(read('HASCHAR'), 'yes');
  assert.equal(read('HASCLIENT'), 'yes');
  assert.match(read('DIAG'), /signals: on/);
  assert.equal(read('UIERR'), 'no');

  const colors = read('COLORS').split(';').filter(Boolean).map((part) => {
    const [r, g, b] = part.split(',').map(Number);
    return r * 4 + g * 2 + b;
  });
  const decoded = protocol.decodeCells(colors);
  assert.equal(decoded.error, undefined);
  assert.match(decoded.text, /ping/);
  assert.equal(read('REPLY'), 'Echo: ping');
  assert.equal(read('BUTTON'), 'Send');
  assert.match(protocol.fromHex(read('OUTBOX')), /fallback/);
  assert.match(read('HELP'), /\/wow-grok/);
});
