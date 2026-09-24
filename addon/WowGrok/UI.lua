-- Vanilla frames: dark panel, chat list, bubbles, composer, status light, mini bar.

local G = WowGrok

local function font(fs, size, r, g, b)
  if not fs then return end
  pcall(function() fs:SetFont("Fonts\\FRIZQT__.TTF", size or 12, "") end)
  if fs.SetTextColor then fs:SetTextColor(r or 0.92, g or 0.91, b or 0.86, 1) end
  if fs.SetJustifyH then fs:SetJustifyH("LEFT") end
  if fs.SetWordWrap then fs:SetWordWrap(true) end
end

local function paint(frame, r, g, b, a)
  local edge = frame:CreateTexture(nil, "BACKGROUND")
  edge:SetPoint("TOPLEFT", frame, "TOPLEFT", -1, 1)
  edge:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", 1, -1)
  edge:SetColorTexture(0.28, 0.30, 0.36, 1)
  local fill = frame:CreateTexture(nil, "BORDER")
  fill:SetAllPoints(frame)
  fill:SetColorTexture(r, g, b, a or 0.96)
  frame._fill = fill
  return fill
end

local function button(parent, text, w, h)
  local b = CreateFrame("Button", nil, parent)
  b:SetSize(w or 88, h or 22)
  paint(b, 0.16, 0.17, 0.21, 1)
  local label = b:CreateFontString(nil, "OVERLAY")
  font(label, 12, 0.93, 0.93, 0.9)
  label:SetPoint("CENTER")
  label:SetText(text or "")
  b.label = label
  b.SetText = function(self, value)
    self.label:SetText(value or "")
    self.text = value or ""
  end
  b.GetText = function(self) return self.text or self.label:GetText() or "" end
  b:SetText(text or "")
  return b
end

local main = CreateFrame("Frame", "WowGrokFrame", UIParent)
main:SetSize(680, 480)
main:SetPoint("CENTER")
main:SetFrameStrata("DIALOG")
main:SetMovable(true)
main:EnableMouse(true)
main:SetClampedToScreen(true)
paint(main, 0.06, 0.06, 0.08, 0.96)
G.main = main
UISpecialFrames = UISpecialFrames or {}
table.insert(UISpecialFrames, "WowGrokFrame")

local titleBar = CreateFrame("Frame", nil, main)
titleBar:SetPoint("TOPLEFT", 0, 0)
titleBar:SetPoint("TOPRIGHT", 0, 0)
titleBar:SetHeight(32)
titleBar:EnableMouse(true)
titleBar:RegisterForDrag("LeftButton")
titleBar:SetScript("OnDragStart", function() main:StartMoving() end)
titleBar:SetScript("OnDragStop", function() main:StopMovingOrSizing() end)

local title = titleBar:CreateFontString(nil, "OVERLAY")
font(title, 14, 0.78, 0.86, 0.95)
title:SetPoint("LEFT", 12, 0)
title:SetText("WowGrok")

local light = titleBar:CreateTexture(nil, "OVERLAY")
light:SetSize(12, 12)
light:SetPoint("LEFT", title, "RIGHT", 10, 0)
light:SetColorTexture(0.85, 0.28, 0.24, 1)
G.light = light

local statusText = titleBar:CreateFontString(nil, "OVERLAY")
font(statusText, 11, 0.62, 0.64, 0.68)
statusText:SetPoint("LEFT", light, "RIGHT", 6, 0)
G.statusText = statusText

local cwdText = titleBar:CreateFontString(nil, "OVERLAY")
font(cwdText, 11, 0.55, 0.58, 0.62)
cwdText:SetPoint("RIGHT", titleBar, "RIGHT", -36, 0)
G.cwdText = cwdText

local minBtn = button(titleBar, "–", 22, 18)
minBtn:SetPoint("TOPRIGHT", -6, -6)

local listScroll = CreateFrame("ScrollFrame", nil, main)
listScroll:SetPoint("TOPLEFT", 8, -36)
listScroll:SetSize(160, 360)
local list = CreateFrame("Frame", nil, listScroll)
list:SetSize(160, 360)
listScroll:SetScrollChild(list)
G.list = list
G.listScroll = listScroll

local logScroll = CreateFrame("ScrollFrame", "WowGrokLog", main)
logScroll:SetPoint("TOPLEFT", 176, -36)
logScroll:SetPoint("BOTTOMRIGHT", -10, 78)
local log = CreateFrame("Frame", nil, logScroll)
log:SetSize(480, 360)
logScroll:SetScrollChild(log)
G.log = log
G.logScroll = logScroll

logScroll:EnableMouseWheel(true)
logScroll:SetScript("OnMouseWheel", function(self, delta)
  local cur = self:GetVerticalScroll() or 0
  local maxScroll = math.max(0, (log:GetHeight() or 0) - (self:GetHeight() or 0))
  local nextPos = math.min(maxScroll, math.max(0, cur - (delta or 0) * 36))
  self:SetVerticalScroll(nextPos)
end)

local allow = button(main, "Allow & retry", 220, 22)
allow:SetPoint("BOTTOMLEFT", 176, 52)
allow:Hide()
G.allowButton = allow
allow:SetScript("OnClick", function() G.AllowRetry() end)

local edit = CreateFrame("EditBox", "WowGrokEditBox", main)
edit:SetPoint("BOTTOMLEFT", 176, 12)
edit:SetPoint("BOTTOMRIGHT", -108, 12)
edit:SetHeight(36)
edit:SetAutoFocus(false)
edit:SetMultiLine(true)
edit:SetMaxLetters(4000)
edit:SetTextInsets(8, 8, 6, 6)
font(edit, 13, 0.95, 0.94, 0.9)
paint(edit, 0.1, 0.1, 0.12, 1)
edit:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
edit:SetScript("OnEnterPressed", function(self)
  if IsShiftKeyDown and IsShiftKeyDown() then
    self:Insert("\n")
    return
  end
  G.SubmitBox()
end)
edit:SetScript("OnTextChanged", function(self)
  local chat = G.Active and G.Active()
  if chat and G._editLive then chat.draft = self:GetText() or "" end
end)
G._editLive = true

local send = button(main, "Connect", 90, 36)
send:SetPoint("BOTTOMRIGHT", -10, 12)
G.sendButton = send
send:RegisterForClicks("AnyUp")
send:SetScript("OnClick", function() G.SubmitBox() end)

function G.SubmitBox()
  local text = edit:GetText() or ""
  if G.LinkState() == "down" then
    local chat = G.Active()
    if chat then chat.draft = text end
    G.Connect()
    return
  end
  G.Send(text)
end

local mini = CreateFrame("Frame", "WowGrokMini", UIParent)
mini:SetSize(230, 36)
mini:SetPoint("BOTTOMRIGHT", -48, 96)
mini:SetFrameStrata("MEDIUM")
mini:EnableMouse(true)
mini:SetMovable(true)
mini:RegisterForDrag("LeftButton")
mini:SetScript("OnDragStart", function(self) self:StartMoving() end)
mini:SetScript("OnDragStop", function(self) self:StopMovingOrSizing() end)
paint(mini, 0.07, 0.07, 0.09, 0.95)
mini:Hide()
G.mini = mini
local miniLight = mini:CreateTexture(nil, "OVERLAY")
miniLight:SetSize(10, 10)
miniLight:SetPoint("LEFT", 10, 0)
miniLight:SetColorTexture(0.85, 0.28, 0.24, 1)
G.miniLight = miniLight
local miniLabel = mini:CreateFontString(nil, "OVERLAY")
font(miniLabel, 12, 0.9, 0.9, 0.88)
miniLabel:SetPoint("LEFT", 26, 0)
miniLabel:SetText("WowGrok")
G.miniLabel = miniLabel
mini:SetScript("OnMouseUp", function() G.ShowMain() end)

local copy = CreateFrame("Frame", "WowGrokCopy", UIParent)
copy:SetSize(460, 260)
copy:SetPoint("CENTER")
copy:SetFrameStrata("TOOLTIP")
paint(copy, 0.07, 0.07, 0.09, 0.98)
copy:Hide()
local copyBox = CreateFrame("EditBox", nil, copy)
copyBox:SetPoint("TOPLEFT", 10, -28)
copyBox:SetPoint("BOTTOMRIGHT", -10, 10)
copyBox:SetMultiLine(true)
copyBox:SetAutoFocus(true)
font(copyBox, 12)
G.copyBox = copyBox
local copyClose = button(copy, "Close", 50, 18)
copyClose:SetPoint("TOPRIGHT", -6, -4)
copyClose:SetScript("OnClick", function() copy:Hide() end)
function G.ShowCopy(text)
  copyBox:SetText(text or "")
  if copyBox.HighlightText then copyBox:HighlightText() end
  copy:Show()
  if copyBox.SetFocus then copyBox:SetFocus() end
end

local popup = CreateFrame("Frame", "WowGrokPopup", UIParent)
popup:SetSize(360, 140)
popup:SetPoint("CENTER")
popup:SetFrameStrata("TOOLTIP")
paint(popup, 0.08, 0.08, 0.1, 0.98)
popup:Hide()
local popupTitle = popup:CreateFontString(nil, "OVERLAY")
font(popupTitle, 13, 0.9, 0.9, 0.88)
popupTitle:SetPoint("TOPLEFT", 12, -12)
local popupText = popup:CreateFontString(nil, "OVERLAY")
font(popupText, 12, 0.75, 0.75, 0.72)
popupText:SetPoint("TOPLEFT", 12, -36)
popupText:SetWidth(330)
local popupEdit = CreateFrame("EditBox", nil, popup)
popupEdit:SetPoint("TOPLEFT", 12, -58)
popupEdit:SetSize(330, 24)
font(popupEdit, 13)
paint(popupEdit, 0.12, 0.12, 0.14, 1)
local popupOk = button(popup, "OK", 70, 22)
popupOk:SetPoint("BOTTOMRIGHT", -12, 12)
local popupCancel = button(popup, "Cancel", 70, 22)
popupCancel:SetPoint("RIGHT", popupOk, "LEFT", -8, 0)
popupCancel:SetScript("OnClick", function() popup:Hide() end)
G.popup = popup

function G.Popup(opts)
  opts = opts or {}
  popupTitle:SetText(opts.title or "WowGrok")
  popupText:SetText(opts.text or "")
  popup._onOk = opts.onOk
  if opts.edit ~= nil then
    popupEdit:Show()
    popupEdit:SetText(opts.edit or "")
    if popupEdit.SetFocus then popupEdit:SetFocus() end
  else
    popupEdit:Hide()
  end
  popup:Show()
end
popupOk:SetScript("OnClick", function()
  local fn = popup._onOk
  local value = popupEdit:GetText() or ""
  popup:Hide()
  if fn then fn(value) end
end)

local menu = CreateFrame("Frame", "WowGrokChatMenu", UIParent)
menu:SetSize(140, 96)
menu:SetFrameStrata("TOOLTIP")
paint(menu, 0.1, 0.1, 0.12, 0.98)
menu:Hide()
G.menu = menu
local menuChat
local function menuButton(label, y, fn)
  local b = button(menu, label, 124, 22)
  b:SetPoint("TOP", 0, y)
  b:SetScript("OnClick", function()
    menu:Hide()
    fn()
  end)
end
menuButton("Rename", -8, function()
  if menuChat then G.SwitchChat(menuChat) end
  G.Rename("")
end)
menuButton("Folder", -34, function()
  if menuChat then G.SwitchChat(menuChat) end
  local chat = G.Active()
  G.Popup({
    title = "Folder",
    edit = chat and chat.cwd or "",
    onOk = function(value) G.SetCwd(value) end,
  })
end)
menuButton("Delete", -60, function()
  if menuChat then G.AskDelete(menuChat) end
end)

function G.ChatMenu(id)
  menuChat = tostring(id)
  if menu:IsShown() and menu.chatId == menuChat then
    menu:Hide()
    return
  end
  menu.chatId = menuChat
  menu:ClearAllPoints()
  menu:SetPoint("CENTER", main, "LEFT", 80, 0)
  menu:Show()
end

local rows = {}
local bubbles = {}

local function takeRow(i)
  local row = rows[i]
  if row then return row end
  row = CreateFrame("Button", nil, list)
  row:SetSize(152, 28)
  paint(row, 0.12, 0.12, 0.15, 1)
  local label = row:CreateFontString(nil, "OVERLAY")
  font(label, 12, 0.9, 0.9, 0.86)
  label:SetPoint("LEFT", 6, 0)
  label:SetWidth(110)
  row.label = label
  row:RegisterForClicks("AnyUp")
  row:SetScript("OnClick", function(self, button)
    if button == "RightButton" then G.ChatMenu(self.chatId)
    else
      menu:Hide()
      G.SwitchChat(self.chatId)
    end
  end)
  local del = button(row, "x", 16, 16)
  del:SetPoint("RIGHT", -2, 0)
  del:SetScript("OnClick", function() G.AskDelete(row.chatId) end)
  rows[i] = row
  return row
end

local function takeBubble(i)
  local bubble = bubbles[i]
  if bubble then return bubble end
  bubble = CreateFrame("Frame", nil, log)
  bubble:SetWidth(470)
  local bar = bubble:CreateTexture(nil, "ARTWORK")
  bar:SetWidth(3)
  bar:SetPoint("TOPLEFT", 0, 0)
  bar:SetPoint("BOTTOMLEFT", 0, 0)
  bubble.bar = bar
  local who = bubble:CreateFontString(nil, "OVERLAY")
  font(who, 11, 0.7, 0.74, 0.8)
  who:SetPoint("TOPLEFT", 10, -1)
  bubble.who = who
  local body = bubble:CreateFontString(nil, "OVERLAY")
  font(body, 13, 0.93, 0.92, 0.88)
  body:SetPoint("TOPLEFT", 10, -16)
  body:SetWidth(450)
  bubble.body = body
  bubble:EnableMouse(true)
  bubble:SetScript("OnMouseUp", function(self)
    if G.ShowCopy then G.ShowCopy(self.fullText or "") end
  end)
  bubbles[i] = bubble
  return bubble
end

local function colorFor(state)
  if state == "up" then return 0.32, 0.82, 0.42 end
  if state == "stale" then return 0.90, 0.74, 0.28 end
  return 0.86, 0.30, 0.26
end

local function placeMessages(chat)
  for _, bubble in ipairs(bubbles) do bubble:Hide() end
  local items = {}
  for _, msg in ipairs(chat.history or {}) do items[#items + 1] = msg end
  local working = G.WorkingLine(chat)
  if working then
    items[#items + 1] = { role = "grok", text = working, t = chat.waitingSince or time(), pending = true }
  end
  local y = -4
  local width = 470
  for i, msg in ipairs(items) do
    local bubble = takeBubble(i)
    local role = msg.role or "grok"
    local who = role == "you" and "You" or (role == "system" and "WowGrok" or "Grok")
    local stamp = ""
    if msg.t and date then stamp = "  " .. date("%H:%M", msg.t) end
    bubble.who:SetText(who .. stamp .. (msg.pending and "  ..." or ""))
    local body = msg.text or ""
    if #body > 8000 then body = body:sub(1, 8000) .. "..." end
    bubble.body:SetWidth(width - 16)
    bubble.body:SetText(body)
    local h = 14
    if bubble.body.GetStringHeight then h = bubble.body:GetStringHeight() or 14 end
    if h < 14 then h = 14 end
    bubble:SetHeight(h + 22)
    if bubble.ClearAllPoints then bubble:ClearAllPoints() end
    bubble:SetPoint("TOPLEFT", log, "TOPLEFT", 4, y)
    bubble.fullText = msg.text or ""
    local r, g, b = 0.45, 0.78, 0.95
    if role == "you" then r, g, b = 0.86, 0.72, 0.32
    elseif role == "system" then r, g, b = 0.75, 0.42, 0.38 end
    bubble.bar:SetColorTexture(r, g, b, 1)
    bubble:Show()
    y = y - (h + 28)
  end
  log:SetHeight(math.max(360, -y + 8))
end

function G.Refresh()
  if not WowGrokDB then return end
  local chat = G.Active()
  if not chat then return end
  local state = G.LinkState()
  local lr, lg, lb = colorFor(state)
  light:SetColorTexture(lr, lg, lb, 1)
  miniLight:SetColorTexture(lr, lg, lb, 1)
  local detail = state == "up" and "connected" or (state == "stale" and "quiet" or "no companion")
  statusText:SetText(detail)
  local folder = chat.cwd
  if not folder or folder == "" then folder = G.bridgeCwd or "default folder" end
  cwdText:SetText(folder)
  local unread = 0
  for i, rowChat in ipairs(WowGrokDB.chats) do
    local row = takeRow(i)
    row.chatId = rowChat.id
    local badge = (rowChat.unread or 0) > 0 and (" (" .. rowChat.unread .. ")") or ""
    local mark = tostring(rowChat.id) == tostring(WowGrokDB.active) and "> " or ""
    row.label:SetText(mark .. (rowChat.name or "Chat") .. badge)
    if row.ClearAllPoints then row:ClearAllPoints() end
    row:SetPoint("TOPLEFT", 0, -((i - 1) * 30))
    row:Show()
    unread = unread + (rowChat.unread or 0)
    if row._fill and row._fill.SetColorTexture then
      if tostring(rowChat.id) == tostring(WowGrokDB.active) then row._fill:SetColorTexture(0.18, 0.2, 0.26, 1)
      else row._fill:SetColorTexture(0.12, 0.12, 0.15, 1) end
    end
  end
  for i = #WowGrokDB.chats + 1, #rows do rows[i]:Hide() end
  list:SetHeight(math.max(360, #WowGrokDB.chats * 30))
  placeMessages(chat)
  if state == "down" then send:SetText("Connect")
  else send:SetText("Send") end
  if chat.denied and #chat.denied > 0 and not chat.working then
    local label = "Allow " .. table.concat(chat.denied, ", ") .. " & retry"
    if #label > 72 then label = "Allow " .. #chat.denied .. " & retry" end
    allow:SetText(label)
    allow:Show()
  else
    allow:Hide()
  end
  local badge = ""
  if chat.working then badge = "working" end
  if unread > 0 then badge = (badge ~= "" and (badge .. " · ") or "") .. unread .. " new" end
  miniLabel:SetText(badge ~= "" and ("WowGrok  " .. badge) or "WowGrok")
end

function G.ShowMain()
  if menu then menu:Hide() end
  mini:Hide()
  main:Show()
  local chat = G.Active()
  if chat then chat.unread = 0 end
  G.Refresh()
end

function G.Toggle()
  if main:IsShown() then main:Hide() else G.ShowMain() end
end

minBtn:SetScript("OnClick", function() main:Hide() end)
main:SetScript("OnHide", function()
  if UIParent and UIParent.IsShown and not UIParent:IsShown() then
    mini:Hide()
    return
  end
  mini:Show()
end)

local strip = CreateFrame("Frame", "WowGrokStrip", UIParent)
strip:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 0, 0)
strip:SetSize(4, 4)
strip:SetFrameStrata("TOOLTIP")
strip:SetFrameLevel(1000)
strip.cells = {}
strip:Hide()
G.strip = strip
G.ApplyPixelScale(strip)

local grab = CreateFrame("Frame", "WowGrokReloadGrab", UIParent)
grab:SetAllPoints(UIParent)
grab:SetFrameStrata("TOOLTIP")
grab:EnableKeyboard(true)
grab:EnableMouse(false)
if grab.SetPropagateKeyboardInput then grab:SetPropagateKeyboardInput(true) end
grab:Hide()
local skipKey = { LSHIFT = true, RSHIFT = true, LCTRL = true, RCTRL = true, LALT = true, RALT = true }
grab:SetScript("OnKeyDown", function(self, key)
  if skipKey[key] then
    if self.SetPropagateKeyboardInput then self:SetPropagateKeyboardInput(true) end
    return
  end
  self:Hide()
  if ReloadUI then ReloadUI() end
end)
G.reloadGrab = grab

function G.InputHasFocus()
  return edit:HasFocus()
end

function G.InsertLink(link)
  if not link or link == "" or not edit:HasFocus() then return end
  edit:Insert(link)
end
