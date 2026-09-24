-- Transport, chats, and commands. UI.lua paints; Slash.lua dispatches.

WowGrok = WowGrok or {}
local G = WowGrok

G.VERSION = "0.1.0"
G.SLOTS = 200
G.ACT_MAX = 60
G.PRESENCE_MAX = 2000
G.CELL = 4
G.CELLS_PER_ROW = 200
G.MAX_ROWS = 48
G.MAX_PAYLOAD = 3200
G.POLL_AT = { 5, 10, 16, 24, 34, 46, 60, 80, 100, 130, 160, 200, 240, 300 }

BINDING_HEADER_WOWGROK = "WowGrok"
BINDING_NAME_WOWGROK_TOGGLE = "Toggle WowGrok"

local SEP_F = string.char(31)
local SEP_R = string.char(30)

local function trim(s)
  return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

local function say(text)
  print(tostring(text))
end

function G.SignalPath(kind, n, k)
  if kind == "sig" or kind == "ack" then
    return string.format("Interface\\AddOns\\WowGrok\\%s\\%03d.wav", kind, n)
  elseif kind == "act" then
    return string.format("Interface\\AddOns\\WowGrok\\act\\%03d\\%02d.wav", n, k)
  elseif kind == "presence" then
    return string.format("Interface\\AddOns\\WowGrok\\presence\\%04d.wav", n)
  end
  return "Interface\\AddOns\\WowGrok\\ctl\\" .. tostring(n) .. ".wav"
end

function G.SlotFor(id)
  return ((tonumber(id) or 1) - 1) % G.SLOTS + 1
end

local function plays(path)
  if not PlaySoundFile then return false end
  local ok, res = pcall(PlaySoundFile, path, "Master")
  if not ok then return false end
  return not not res
end

function G.Active()
  local db = WowGrokDB
  if not db or not db.chats then return nil end
  for _, chat in ipairs(db.chats) do
    if tostring(chat.id) == tostring(db.active) then return chat end
  end
  return db.chats[1]
end

function G.AllocId()
  local id = WowGrokDB.nextId or 1
  WowGrokDB.nextId = id + 1
  return id
end

function G.AllocChatId()
  local n = 0
  for _, chat in ipairs(WowGrokDB.chats) do
    n = math.max(n, tonumber(chat.id) or 0)
  end
  return tostring(n + 1)
end

local function flagString(rec)
  local flags = {}
  if rec.newSession then flags[#flags + 1] = "n" end
  if rec.hello then flags[#flags + 1] = "h" end
  if rec.forget then flags[#flags + 1] = "d" end
  if rec.ctx ~= nil then flags[#flags + 1] = "c" end
  if rec.retry and rec.retry > 0 then flags[#flags + 1] = "r=" .. tostring(rec.retry) end
  if rec.allow and #rec.allow > 0 then flags[#flags + 1] = "allow=" .. table.concat(rec.allow, ",") end
  return table.concat(flags, ";")
end

local function cleanField(s, limit)
  s = tostring(s or ""):gsub(SEP_F, " "):gsub(SEP_R, " ")
  if limit and #s > limit then s = s:sub(1, limit) end
  return s
end

function G.Record(rec)
  local fields = {
    cleanField(WowGrokDB.session, 64),
    cleanField(rec.chat, 64),
    tostring(rec.id or 0),
    cleanField(rec.cwd, 260),
    flagString(rec),
    cleanField(rec.name, 64),
  }
  if rec.ctx ~= nil then fields[#fields + 1] = cleanField(rec.ctx, 1200) end
  fields[#fields + 1] = (rec.text or ""):gsub(SEP_R, " ")
  return table.concat(fields, SEP_F)
end

function G.Payload(records)
  local parts = {}
  for _, rec in ipairs(records) do parts[#parts + 1] = G.Record(rec) end
  return table.concat(parts, SEP_R)
end

local function toHex(s)
  local t = {}
  s = s or ""
  for i = 1, #s do t[#t + 1] = string.format("%02x", s:byte(i)) end
  return table.concat(t)
end

function G.WriteOutbox(rec)
  WowGrokDB.outbox = {
    id = rec.id,
    session = WowGrokDB.session,
    chat = tostring(rec.chat or ""),
    name = toHex(rec.name or ""),
    cwd = toHex(rec.cwd or ""),
    text = toHex(rec.text or ""),
    flags = flagString(rec),
    newSession = rec.newSession and true or false,
  }
  if rec.ctx ~= nil then WowGrokDB.outbox.ctx = toHex(rec.ctx) end
end

function G.Changed()
  if G.Refresh then
    local ok, err = pcall(G.Refresh)
    if not ok then say("WowGrok UI: " .. tostring(err)) end
  end
end

-- This client has no math.randomseed. Mix the clock into 16 hex digits instead.
local function sessionToken()
  local clock = tostring(time() or 0)
  if GetTime then
    local ok, now = pcall(GetTime)
    if ok and type(now) == "number" then clock = clock .. tostring(now) end
  end
  local acc = 0
  for i = 1, #clock do
    acc = (acc * 33 + clock:byte(i)) % 2147483647
  end
  local s = {}
  for i = 1, 16 do
    acc = (acc * 33 + i) % 2147483647
    s[i] = string.format("%x", acc % 16)
  end
  return table.concat(s)
end

function G.InitDB()
  if type(WowGrokDB) ~= "table" then WowGrokDB = {} end
  local db = WowGrokDB
  if not db.session or db.session == "" then
    db.session = sessionToken()
  end
  db.nextId = db.nextId or 1
  if db.contextOn == nil then db.contextOn = true end
  db.echo = db.echo or "full"
  if db.longchat == nil then db.longchat = false end
  db.mode = db.mode or "auto"
  db.forget = db.forget or {}
  db.ackedCtx = db.ackedCtx or ""
  if type(db.chats) ~= "table" or #db.chats == 0 then
    db.chats = {
      { id = "1", name = "Chat 1", cwd = "", history = {}, unread = 0, draft = "", autoName = true },
    }
  end
  if not db.active then db.active = db.chats[1].id end
  for _, chat in ipairs(db.chats) do
    chat.history = chat.history or {}
    chat.id = tostring(chat.id)
  end
end

function G.FindPresence()
  local lo, hi = 0, G.PRESENCE_MAX
  while lo < hi do
    local mid = math.floor((lo + hi + 1) / 2)
    if plays(G.SignalPath("presence", mid)) then lo = mid else hi = mid - 1 end
  end
  return lo
end

function G.TestSignals()
  local empty = plays(G.SignalPath("ctl", "empty"))
  local valid = plays(G.SignalPath("ctl", "valid"))
  G.signalsOk = (not empty) and valid
  G.presenceSeen = 0
  if G.signalsOk then
    G.presenceSeen = G.FindPresence()
    if G.presenceSeen > 0 then G.presenceAt = time() end
  end
end

function G.LinkState()
  if not G.ready then return "down" end
  local heard = math.max(G.presenceAt or 0, G.slotHeardAt or 0)
  if heard == 0 then return "down" end
  local age = time() - heard
  if G.signalsOk then
    if age < 90 then return "up" end
    if age < 300 then return "stale" end
    return "down"
  end
  if age < 12 * 60 then return "up" end
  if age < 22 * 60 then return "stale" end
  return "down"
end

function G.ApplyPixelScale(frame)
  if not frame or not frame.SetScale then return end
  local physH = 1080
  if GetPhysicalScreenSize then
    local ok, _, h = pcall(GetPhysicalScreenSize)
    if ok and type(h) == "number" and h > 0 then physH = h end
  end
  local ps = 1
  local parent = frame.GetParent and frame:GetParent() or nil
  if parent and parent.GetEffectiveScale then
    local ok, s = pcall(function() return parent:GetEffectiveScale() end)
    if ok and type(s) == "number" and s > 0 then ps = s end
  end
  frame:SetScale((768 / physH) / ps)
end

function G.EnsureCells(n)
  local strip = G.strip
  if not strip then return end
  strip.cells = strip.cells or {}
  for i = #strip.cells + 1, n do
    local cell = strip:CreateTexture(nil, "ARTWORK")
    cell:SetSize(G.CELL, G.CELL)
    strip.cells[i] = cell
  end
end

function G.HideStrip()
  if G.strip then G.strip:Hide() end
end

function G.ShowPending()
  local pending = G.pending
  local strip = G.strip
  if not pending or not strip then return false end
  local payload = G.Payload(pending.records)
  local cells, err = WowGrok_Codec.Encode(pending.id, payload)
  if not cells then
    say("WowGrok: " .. tostring(err))
    return false
  end
  G.EnsureCells(#cells)
  local cols = G.CELLS_PER_ROW
  local rows = math.max(1, math.ceil(#cells / cols))
  strip:SetSize(cols * G.CELL, math.min(rows, G.MAX_ROWS) * G.CELL)
  for i = 1, #cells do
    local col = (i - 1) % cols
    local row = math.floor((i - 1) / cols)
    local cell = strip.cells[i]
    if cell.ClearAllPoints then cell:ClearAllPoints() end
    cell:SetPoint("TOPLEFT", strip, "TOPLEFT", col * G.CELL, -row * G.CELL)
    local r, g, b = WowGrok_Codec.CellColor(cells[i])
    cell:SetColorTexture(r, g, b, 1)
    cell:Show()
  end
  for i = #cells + 1, #strip.cells do
    if strip.cells[i].Hide then strip.cells[i]:Hide() end
  end
  strip:Show()
  pending.shownAt = time()
  local ack = G.SignalPath("ack", G.SlotFor(pending.id))
  pending.ackBlind = G.signalsOk and plays(ack) or false
  local sig = G.SignalPath("sig", G.SlotFor(pending.id))
  pending.sigBlind = G.signalsOk and plays(sig) or false
  local chat = G.Active()
  if chat and chat.waitingId == pending.id then chat.sigBlind = pending.sigBlind end
  return true
end

function G.ArmReload(reason)
  G.reloadAt = time() + 1
  G.reloadReason = reason or "Reload the UI to continue."
  say("WowGrok: " .. G.reloadReason .. " Press any key to reload.")
  G.Changed()
end

function G.BeginPending(records)
  local header = records[#records]
  G.pending = {
    records = records,
    id = header.id,
    ctx = header.ctx,
    sentAt = time(),
    shownAt = time(),
    tries = 0,
    pollIdx = 1,
  }
  if WowGrokDB.mode == "reload" then
    G.WriteOutbox(header)
    G.HideStrip()
    G.ArmReload("Reload mode delivers this on the next keypress.")
    return
  end
  if not G.ShowPending() then
    G.WriteOutbox(header)
    G.ArmReload("The pixel strip could not be drawn.")
  end
end

function G.EnqueueHello()
  local records = {}
  for chatId, on in pairs(WowGrokDB.forget) do
    if on then
      records[#records + 1] = {
        id = G.AllocId(), chat = tostring(chatId), name = tostring(chatId),
        cwd = "", text = "", forget = true,
      }
    end
  end
  local chat = G.Active()
  local hello = {
    id = G.AllocId(), chat = chat.id, name = chat.name, cwd = chat.cwd or "",
    text = "", hello = true,
  }
  if WowGrokDB.contextOn then hello.ctx = WowGrok_Context.GameContext(1200)
  else hello.ctx = "" end
  records[#records + 1] = hello
  G.BeginPending(records)
end

function G.OnAck()
  local pending = G.pending
  if not pending or pending.acked then return end
  pending.acked = true
  G.HideStrip()
  if pending.ctx ~= nil then WowGrokDB.ackedCtx = pending.ctx end
  for _, rec in ipairs(pending.records) do
    if rec.forget then WowGrokDB.forget[rec.chat] = nil end
  end
  local needsReply = false
  for _, rec in ipairs(pending.records) do
    if rec.text and rec.text ~= "" and not rec.hello and not rec.forget then needsReply = true end
  end
  if not needsReply then G.pending = nil end
  G.LoadNextSlot()
  G.Changed()
end

function G.LoadNextSlot()
  if WowGrokDB.mode == "reload" then return false end
  G.slotCursor = (G.slotCursor or 0) + 1
  G.slotsUsed = (G.slotsUsed or 0) + 1
  if G.slotCursor > G.SLOTS then
    G.slotsEmpty = true
    return false
  end
  local name = string.format("WowGrok_S%03d", G.slotCursor)
  local ok, reason
  if C_AddOns and C_AddOns.LoadAddOn then
    ok, reason = C_AddOns.LoadAddOn(name)
  elseif LoadAddOn then
    ok, reason = LoadAddOn(name)
  else
    ok, reason = false, "no loader"
  end
  if not ok then return false, reason end
  if type(WowGrok_SlotData) == "table" then G.Ingest(WowGrok_SlotData) end
  return true
end

local function findChat(id)
  for _, chat in ipairs(WowGrokDB.chats) do
    if tostring(chat.id) == tostring(id) then return chat end
  end
end

local function echoLimit()
  local mode = WowGrokDB.echo
  if mode == "off" or mode == 0 then return 0 end
  if mode == "short" then return 200 end
  if type(mode) == "number" then return mode end
  return 4000
end

local function echoReply(chat, text)
  local limit = echoLimit()
  if limit <= 0 then return end
  local body = text or ""
  if #body > limit then body = body:sub(1, limit) .. "..." end
  G.replyTo = { id = chat.id, name = chat.name }
  local first = true
  local any = false
  for line in (body .. "\n"):gmatch("([^\n]*)\n") do
    if line ~= "" then
      any = true
      local links = ""
      if first then
        links = " |cff7ec8ff|Hwowgrok:reply:" .. chat.id .. "|h[reply]|h|r"
          .. " |cff7ec8ff|Hwowgrok:open:" .. chat.id .. "|h[open]|h|r"
        first = false
      end
      say("|cff7ec8ff[Grok · " .. (chat.name or "chat") .. "]|r " .. line .. links)
    end
  end
  if not any then
    say("|cff7ec8ff[Grok · " .. (chat.name or "chat") .. "]|r")
  end
end

local function alreadyApplied(chat, id)
  for _, msg in ipairs(chat.history) do
    if msg.role ~= "you" and tonumber(msg.id) == tonumber(id) then return true end
  end
  return false
end

function G.ApplyReply(reply)
  if type(reply) ~= "table" then return end
  local chat = findChat(reply.chat)
  if not chat then return end
  local id = tonumber(reply.id) or 0
  local status = tostring(reply.status or "")
  if reply.cwd and reply.cwd ~= "" then chat.resolvedCwd = reply.cwd end
  if reply.session and reply.session ~= "" then chat.grokSession = reply.session end
  if status == "working" and id == chat.waitingId then
    chat.working = true
    chat.workingText = reply.text or ""
    return
  end
  if status ~= "done" and status ~= "error" then return end
  if alreadyApplied(chat, id) then return end
  local denied = {}
  if type(reply.denied) == "table" then
    for _, rule in ipairs(reply.denied) do
      if rule and rule ~= "" then denied[#denied + 1] = tostring(rule) end
    end
  end
  chat.denied = #denied > 0 and denied or nil
  chat.history[#chat.history + 1] = {
    role = status == "error" and "system" or "grok",
    id = id,
    t = time(),
    text = reply.text or "",
  }
  chat.lastApplied = math.max(chat.lastApplied or 0, id)
  if chat.waitingId == id then
    chat.working = false
    chat.waitingId = nil
  end
  if G.pending and G.pending.id == id then
    G.pending.acked = true
    G.HideStrip()
    G.pending = nil
  end
  if tostring(WowGrokDB.active) ~= tostring(chat.id) or not (G.main and G.main:IsShown()) then
    chat.unread = (chat.unread or 0) + 1
  end
  pcall(PlaySound, 3081, "Master")
  pcall(FlashClientIcon)
  echoReply(chat, reply.text or "")
end

function G.MaybeRestore(data)
  local bundle = data and data.restore
  if type(bundle) ~= "table" or bundle.token ~= WowGrokDB.session or WowGrokDB.restored then return end
  for _, chat in ipairs(WowGrokDB.chats) do
    if chat.history and #chat.history > 0 then return end
  end
  local imported = {}
  local maxMsg = WowGrokDB.nextId or 1
  for _, src in ipairs(bundle.chats or {}) do
    local history = {}
    for _, msg in ipairs(src.messages or {}) do
      history[#history + 1] = {
        role = msg.role == "you" and "you" or (msg.role == "system" and "system" or "grok"),
        id = tonumber(msg.id) or 0,
        t = tonumber(msg.t) or 0,
        text = msg.text or "",
      }
      if (tonumber(msg.id) or 0) + 1 > maxMsg then maxMsg = tonumber(msg.id) + 1 end
    end
    imported[#imported + 1] = {
      id = tostring(src.id or (#imported + 1)),
      name = src.name or "Chat",
      cwd = src.cwd or "",
      history = history,
      unread = 0,
      draft = "",
      autoName = false,
    }
  end
  if #imported == 0 then return end
  WowGrokDB.chats = imported
  WowGrokDB.active = imported[1].id
  WowGrokDB.nextId = math.max(WowGrokDB.nextId or 1, maxMsg)
  WowGrokDB.restored = true
  say("WowGrok restored " .. #imported .. " chat(s) from the companion.")
end

function G.Ingest(data)
  if type(data) ~= "table" then return end
  G.MaybeRestore(data)
  if type(data.now) == "number" and math.abs(time() - data.now) < 180 then
    G.slotHeardAt = time()
  end
  if type(data.cwd) == "string" and data.cwd ~= "" then G.bridgeCwd = data.cwd end
  for _, reply in ipairs(data.replies or {}) do G.ApplyReply(reply) end
  G.Changed()
end

function G.PollActions()
  local chat = G.Active()
  if not G.signalsOk or not chat or not chat.waitingId then return end
  local slot = G.SlotFor(chat.waitingId)
  local n = chat.actionCount or 0
  while n < G.ACT_MAX and plays(G.SignalPath("act", slot, n + 1)) do
    n = n + 1
    chat.actionAt = time()
  end
  chat.actionCount = n
end

function G.ProbePresence()
  if not G.signalsOk then return end
  local n = (G.presenceSeen or 0) + 1
  if n > G.PRESENCE_MAX then return end
  if plays(G.SignalPath("presence", n)) then
    G.presenceSeen = n
    G.presenceAt = time()
  end
end

function G.PollSlots()
  if WowGrokDB.mode == "reload" then return end
  local chat = G.Active()
  local pending = G.pending
  local waiting = chat and chat.working
  if not waiting and (not pending or pending.acked) then
    if not G.signalsOk and not pending and G.ready then
      if time() - (G.lastIdlePoll or 0) >= 600 then
        G.lastIdlePoll = time()
        G.LoadNextSlot()
      end
    end
    return
  end
  local anchor = pending or chat
  local elapsed = time() - (anchor.sentAt or anchor.waitingSince or time())
  local idx = anchor.pollIdx or 1
  local due
  if idx <= #G.POLL_AT then due = G.POLL_AT[idx]
  else due = G.POLL_AT[#G.POLL_AT] + (idx - #G.POLL_AT) * 60 end
  if elapsed >= due then
    anchor.pollIdx = idx + 1
    G.LoadNextSlot()
  end
end

function G.TransportTick()
  local pending = G.pending
  if pending and not pending.acked and WowGrokDB.mode ~= "reload" then
    local slot = G.SlotFor(pending.id)
    if G.signalsOk and not pending.ackBlind and plays(G.SignalPath("ack", slot)) then
      G.OnAck()
    end
    pending = G.pending
    if pending and not pending.acked and time() - (pending.shownAt or time()) >= 40 then
      pending.tries = (pending.tries or 0) + 1
      if pending.tries > 3 then
        local last = pending.records[#pending.records]
        G.WriteOutbox(last)
        G.HideStrip()
        G.ArmReload("The companion did not acknowledge the message.")
        pending.shownAt = time() + 3600
      else
        for _, rec in ipairs(pending.records) do rec.retry = pending.tries end
        G.ShowPending()
      end
    end
  end
  local chat = G.Active()
  if chat and chat.working and G.signalsOk and not chat.sigSeen and not chat.sigBlind then
    if plays(G.SignalPath("sig", G.SlotFor(chat.waitingId))) then
      chat.sigSeen = true
      G.LoadNextSlot()
    end
  end
  if G.reloadAt and time() >= G.reloadAt and G.reloadGrab then
    G.reloadGrab:Show()
    G.reloadAt = nil
  end
  G.PollSlots()
  G.PollActions()
  G.ProbePresence()
end

function G.Send(text)
  if not G.ready then return end
  local raw = trim(text)
  if raw == "" then return end
  local chat = G.Active()
  if not chat then return end
  local expanded = WowGrok_Context.ExpandLinks(raw)
  if chat.autoName and tostring(chat.name):match("^Chat ") then
    local title = raw:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("|H.-|h", ""):gsub("%s+", " ")
    title = trim(title):sub(1, 32)
    if title ~= "" then
      chat.name = title
      chat.autoName = false
    end
  end
  local rec = {
    id = G.AllocId(),
    chat = chat.id,
    name = chat.name,
    cwd = chat.cwd or "",
    text = expanded,
    newSession = chat.wantNew and true or nil,
    allow = chat.pendingAllow,
  }
  chat.wantNew = nil
  chat.pendingAllow = nil
  chat.lastUser = raw
  chat.history[#chat.history + 1] = { role = "you", id = rec.id, t = time(), text = raw }
  chat.waitingId = rec.id
  chat.waitingSince = time()
  chat.working = true
  chat.workingText = ""
  chat.actionCount = 0
  chat.sigSeen = false
  chat.sigBlind = false
  chat.denied = nil
  if WowGrokDB.contextOn then
    local ctx = WowGrok_Context.GameContext(800)
    if ctx ~= (WowGrokDB.ackedCtx or "") then rec.ctx = ctx end
  end
  local records = {}
  if G.pending and not G.pending.acked then
    for _, old in ipairs(G.pending.records) do
      if old.hello or old.forget then records[#records + 1] = old end
    end
  end
  records[#records + 1] = rec
  if WowGrokEditBox and WowGrokEditBox.SetText then WowGrokEditBox:SetText("") end
  chat.draft = ""
  G.BeginPending(records)
  G.Changed()
end

function G.Connect()
  if G.pending and not G.pending.acked then
    if WowGrokDB.mode ~= "reload" then G.ShowPending() end
    return
  end
  G.EnqueueHello()
  G.Changed()
end

function G.AllowRetry()
  local chat = G.Active()
  if not chat or not chat.denied or #chat.denied == 0 then return end
  local rules = chat.denied
  local text = chat.lastUser or ""
  chat.pendingAllow = rules
  chat.denied = nil
  if text == "" then return end
  G.Send(text)
end

function G.Cancel()
  local chat = G.Active()
  if chat then
    chat.working = false
    chat.waitingId = nil
  end
  G.pending = nil
  G.HideStrip()
  say("Stopped waiting on this chat.")
  G.Changed()
end

function G.Resend()
  if not G.pending then
    say("Nothing to resend.")
    return
  end
  G.pending.tries = (G.pending.tries or 0) + 1
  for _, rec in ipairs(G.pending.records) do rec.retry = G.pending.tries end
  G.pending.acked = false
  G.pending.ackBlind = false
  G.ShowPending()
  say("Showing the strip again.")
end

function G.NewChat(name)
  name = trim(name)
  local id = G.AllocChatId()
  local chat = {
    id = id,
    name = name ~= "" and name or ("Chat " .. id),
    cwd = "",
    history = {},
    unread = 0,
    draft = "",
    autoName = name == "",
  }
  WowGrokDB.chats[#WowGrokDB.chats + 1] = chat
  WowGrokDB.active = id
  say("Chat " .. chat.name)
  G.Changed()
end

function G.SwitchChat(query)
  query = trim(query)
  for _, chat in ipairs(WowGrokDB.chats) do
    if tostring(chat.id) == query or chat.name:lower() == query:lower() then
      local current = G.Active()
      if current and WowGrokEditBox and WowGrokEditBox.GetText then
        current.draft = WowGrokEditBox:GetText() or ""
      end
      WowGrokDB.active = chat.id
      chat.unread = 0
      if WowGrokEditBox and WowGrokEditBox.SetText then WowGrokEditBox:SetText(chat.draft or "") end
      G.Changed()
      return
    end
  end
  say("No chat matches \"" .. query .. "\".")
end

function G.SetCwd(folder)
  local chat = G.Active()
  local nextCwd = trim(folder)
  if nextCwd ~= (chat.cwd or "") then
    chat.cwd = nextCwd
    chat.wantNew = true
  end
  if nextCwd == "" then say("This chat uses the companion's default folder.")
  else say("Folder: " .. nextCwd .. " (a fresh Grok session starts with the next message).") end
  G.Changed()
end

function G.ResetSession()
  local chat = G.Active()
  chat.wantNew = true
  say("The next message starts a fresh Grok session. The transcript stays.")
end

function G.ShowContext(mode)
  mode = trim(mode):lower()
  if mode == "" then
    say(WowGrok_Context.GameContext(1200))
    say("Context is " .. (WowGrokDB.contextOn and "on" or "off") .. ".")
    return
  end
  if mode ~= "on" and mode ~= "off" then
    say("Usage: /wow-grok context [on|off]")
    return
  end
  WowGrokDB.contextOn = mode == "on"
  if mode == "off" then
    local chat = G.Active()
    G.BeginPending({
      {
        id = G.AllocId(), chat = chat.id, name = chat.name, cwd = "",
        text = "", hello = true, ctx = "",
      },
    })
  end
  say("Context is " .. mode .. ".")
  G.Changed()
end

function G.Rename(name)
  name = trim(name)
  if name == "" then
    if G.Popup then
      G.Popup({
        title = "Rename chat",
        edit = G.Active().name,
        onOk = function(value) G.Rename(value) end,
      })
    end
    return
  end
  local chat = G.Active()
  chat.name = name:sub(1, 48)
  chat.autoName = false
  G.Changed()
end

function G.Delete(id)
  id = tostring(id or (G.Active() and G.Active().id))
  local keep = {}
  local removed
  for _, chat in ipairs(WowGrokDB.chats) do
    if tostring(chat.id) == id then removed = chat else keep[#keep + 1] = chat end
  end
  if not removed then return end
  WowGrokDB.forget[id] = true
  if #keep == 0 then
    removed.history = {}
    removed.name = "Chat 1"
    removed.cwd = ""
    removed.draft = ""
    removed.unread = 0
    removed.autoName = true
    removed.wantNew = true
    WowGrokDB.chats = { removed }
    WowGrokDB.active = removed.id
  else
    WowGrokDB.chats = keep
    if tostring(WowGrokDB.active) == id then WowGrokDB.active = keep[1].id end
  end
  G.EnqueueHello()
  say("Chat deleted. The companion drops its Grok session on the next hello.")
  G.Changed()
end

function G.AskDelete(id)
  id = tostring(id or G.Active().id)
  if G.Popup then
    G.Popup({
      title = "Delete chat",
      text = "Delete this chat?",
      onOk = function() G.Delete(id) end,
    })
  else
    G.Delete(id)
  end
end

function G.Clear()
  local chat = G.Active()
  chat.history = {}
  chat.denied = nil
  chat.working = false
  say("Transcript cleared. The Grok session is unchanged.")
  G.Changed()
end

function G.SetEcho(value)
  value = trim(value):lower()
  if value == "off" then WowGrokDB.echo = "off"
  elseif value == "short" then WowGrokDB.echo = "short"
  elseif value == "full" or value == "" then WowGrokDB.echo = "full"
  elseif tonumber(value) then WowGrokDB.echo = tonumber(value)
  else
    say("Usage: /wow-grok echo full|short|off|<chars>")
    return
  end
  say("Chat echo: " .. tostring(WowGrokDB.echo))
end

function G.ApplyLongchat()
  local maxLetters = WowGrokDB.longchat and 4000 or 255
  local n = NUM_CHAT_WINDOWS or 0
  for i = 1, n do
    local box = _G["ChatFrame" .. i .. "EditBox"]
    if box and box.SetMaxLetters then pcall(box.SetMaxLetters, box, maxLetters) end
  end
  if WowGrokEditBox and WowGrokEditBox.SetMaxLetters then
    pcall(WowGrokEditBox.SetMaxLetters, WowGrokEditBox, 4000)
  end
end

function G.SetLongchat(value)
  value = trim(value):lower()
  if value == "on" then WowGrokDB.longchat = true
  elseif value == "off" then WowGrokDB.longchat = false
  else
    say("Usage: /wow-grok longchat on|off")
    return
  end
  G.ApplyLongchat()
  say("Long chat box: " .. (WowGrokDB.longchat and "on" or "off"))
end

function G.Bind(key)
  key = trim(key)
  if key == "" then
    say("Usage: /wow-grok bind <key>")
    return
  end
  if SetBinding then
    SetBinding(key, "WOWGROK_TOGGLE")
    local set = (GetCurrentBindingSet and GetCurrentBindingSet()) or 1
    if SaveBindings then SaveBindings(set) end
  end
  WowGrokDB.bind = key
  say("Bound " .. key .. " to WowGrok.")
end

function G.Reload()
  if ReloadUI then ReloadUI() else say("ReloadUI is not available.") end
end

function G.SetMode(mode)
  mode = trim(mode):lower()
  if mode == "" then
    say("Transport mode: " .. tostring(WowGrokDB.mode))
    return
  end
  if mode ~= "auto" and mode ~= "reload" then
    say("Usage: /wow-grok mode auto|reload")
    return
  end
  WowGrokDB.mode = mode
  say("Transport mode: " .. mode)
end

function G.Diag()
  local lines = {
    "WowGrok " .. G.VERSION,
    "signals: " .. (G.signalsOk and "on" or "off"),
    "link: " .. G.LinkState(),
    "mode: " .. tostring(WowGrokDB.mode),
    "session: " .. tostring(WowGrokDB.session),
    "presence: " .. tostring(G.presenceSeen or 0),
    "slots used: " .. tostring(G.slotsUsed or 0) .. " / " .. G.SLOTS,
    "pending: " .. (G.pending and ("#" .. tostring(G.pending.id)) or "none"),
    "context: " .. (WowGrokDB.contextOn and "on" or "off"),
  }
  if G.reloadReason then lines[#lines + 1] = "reload: " .. G.reloadReason end
  local text = table.concat(lines, "\n")
  say(text)
  return text
end

function G.Slots()
  local used = G.slotsUsed or 0
  local text = string.format("Reply slots: %d used, %d left this UI session.", used, math.max(0, G.SLOTS - used))
  if G.slotsEmpty then text = text .. " Pool empty; /wow-grok reload frees it." end
  say(text)
  return text
end

function G.About()
  say("WowGrok " .. G.VERSION .. " — in-game window onto a local Grok companion.")
  say("Inspired by wow-claude (chelinho139) and the file-loading notes in wow-forever-codex.")
  say("Not affiliated with Blizzard Entertainment or xAI. It does not bot, read memory, or generate input.")
end

function G.Help()
  local lines = {
    "/wow-grok  or  /grok — toggle the window. With other text, send it.",
    "/ai <text> — send from the chat box. /r replies to Grok when Grok spoke last.",
    "/wow-grok new [name] — new chat, new Grok session",
    "/wow-grok chat <n|name> — switch chats",
    "/wow-grok cd [folder] — folder for this chat (~ and relative paths work)",
    "/wow-grok reset — fresh Grok session, keep the transcript",
    "/wow-grok context [on|off] — show or toggle character context",
    "/wow-grok rename [name] — rename this chat",
    "/wow-grok delete — delete this chat",
    "/wow-grok clear — clear the transcript",
    "/wow-grok echo full|short|off|<chars> — game-chat echo",
    "/wow-grok longchat on|off — let the game chat box take 4000 characters",
    "/wow-grok bind <key> — hotkey checks for a reply, or toggles the window",
    "/wow-grok cancel — stop waiting",
    "/wow-grok resend — show the strip again",
    "/wow-grok reload — reload the UI and free the slot pool",
    "/wow-grok mode auto|reload — pixel/slots, or a reload per step",
    "/wow-grok diag — transport diagnostics",
    "/wow-grok slots — slot pool",
    "/wow-grok copy — copy the last reply",
    "/wow-grok about — credits",
    "/wow-grok help — this list",
  }
  say(table.concat(lines, "\n"))
end

function G.CopyLast()
  local chat = G.Active()
  if not chat then return end
  for i = #chat.history, 1, -1 do
    local msg = chat.history[i]
    if msg.role == "grok" or msg.role == "system" then
      if G.ShowCopy then G.ShowCopy(msg.text or "") else say(msg.text or "") end
      return
    end
  end
  say("No reply to copy yet.")
end

function G.WorkingLine(chat)
  if not chat or not chat.working then return nil end
  local elapsed = math.max(0, time() - (chat.waitingSince or time()))
  local line
  if (chat.actionCount or 0) > 0 then
    local ago = math.max(0, time() - (chat.actionAt or time()))
    line = string.format("Working... %ds · %d actions, last %ds ago", elapsed, chat.actionCount, ago)
  else
    line = string.format("Working... %ds", elapsed)
  end
  if chat.workingText and chat.workingText ~= "" then line = line .. "\n" .. chat.workingText end
  return line
end

function G.Boot()
  G.InitDB()
  G.TestSignals()
  G.lastIdlePoll = time()
  G.slotsUsed = 0
  G.slotCursor = 0
  if G.InstallChatHooks then G.InstallChatHooks() end
  G.ApplyLongchat()
  if type(WowGrok_SlotData) == "table" then G.Ingest(WowGrok_SlotData) end
  G.ready = true
  G.EnqueueHello()
  G.Changed()
end

function G.OnUpdate(_, dt)
  G.acc = (G.acc or 0) + (dt or 0)
  G.TransportTick()
  if G.acc >= 0.5 then
    G.acc = 0
    if G.Active and G.Active() and G.Active().working then G.Changed() end
  end
end

function WowGrok_Binding()
  if not G.ready then return end
  local chat = G.Active()
  if chat and chat.working then
    G.LoadNextSlot()
    return
  end
  if G.Toggle then G.Toggle() end
end

local events = CreateFrame("Frame", "WowGrokEventFrame")
G.events = events
events:SetScript("OnEvent", function(_, event)
  if event == "PLAYER_LOGIN" or event == "PLAYER_ENTERING_WORLD" then
    if not G.ready then G.Boot() end
  end
end)
events:SetScript("OnUpdate", function(self, dt)
  if G.ready then G.OnUpdate(self, dt) end
end)
events:RegisterEvent("PLAYER_LOGIN")
events:RegisterEvent("PLAYER_ENTERING_WORLD")
