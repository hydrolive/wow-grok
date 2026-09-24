-- Slash commands and the game-chat reply hook.

local G = WowGrok

local function trim(s)
  return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

function G.ConsumeReply(editBox)
  if not G.replyTo then return false end
  local text = editBox:GetText() or ""
  if text == "" then return false end
  if text:sub(1, 1) == "/" and not text:match("^/[rR](%s|$)") then
    G.replyTo = nil
    return false
  end
  text = text:gsub("^/[rR]%s*", "")
  editBox:SetText("")
  if text ~= "" then G.Send(text) end
  return true
end

function G.HandleLink(link)
  if type(link) ~= "string" then return end
  local kind, chatId = link:match("wowgrok:(%w+):([^|]+)")
  if not kind or not chatId then return end
  G.SwitchChat(chatId)
  if G.ShowMain then G.ShowMain() end
end

function G.InstallChatHooks()
  local windows = NUM_CHAT_WINDOWS or 0
  for i = 1, windows do
    local editBox = _G["ChatFrame" .. i .. "EditBox"]
    if editBox and not editBox.__WowGrokHook then
      editBox.__WowGrokHook = true
      local original = editBox:GetScript("OnEnterPressed")
      editBox:SetScript("OnEnterPressed", function(self, ...)
        if G.ConsumeReply(self) then return end
        if original then return original(self, ...) end
      end)
      editBox:HookScript("OnEscapePressed", function() G.replyTo = nil end)
      editBox:HookScript("OnTabPressed", function() G.replyTo = nil end)
      local headerName = (editBox.GetName and editBox:GetName() or "") .. "Header"
      editBox:HookScript("OnEditFocusGained", function(self)
        if not G.replyTo then return end
        local header = _G[headerName]
        if header and header.SetText then
          header:SetText("To Grok [" .. (G.replyTo.name or "chat") .. "]:")
        end
      end)
    end
  end
  if ChatFrameUtil and ChatFrameUtil.InsertLink then
    hooksecurefunc(ChatFrameUtil, "InsertLink", function(a, b)
      G.InsertLink(type(a) == "string" and a or b)
    end)
  elseif type(ChatEdit_InsertLink) == "function" then
    hooksecurefunc("ChatEdit_InsertLink", function(link) G.InsertLink(link) end)
  end
  if type(SetItemRef) == "function" then
    hooksecurefunc("SetItemRef", function(link) G.HandleLink(link) end)
  end
end

local commands = {
  new = function(arg) G.NewChat(arg) end,
  chat = function(arg) G.SwitchChat(arg) end,
  cd = function(arg) G.SetCwd(arg) end,
  reset = function() G.ResetSession() end,
  context = function(arg) G.ShowContext(arg) end,
  rename = function(arg) G.Rename(arg) end,
  delete = function() G.AskDelete() end,
  clear = function() G.Clear() end,
  echo = function(arg) G.SetEcho(arg) end,
  longchat = function(arg) G.SetLongchat(arg) end,
  bind = function(arg) G.Bind(arg) end,
  cancel = function() G.Cancel() end,
  resend = function() G.Resend() end,
  reload = function() G.Reload() end,
  mode = function(arg) G.SetMode(arg) end,
  diag = function() G.Diag() end,
  slots = function() G.Slots() end,
  copy = function() G.CopyLast() end,
  about = function() G.About() end,
  help = function() G.Help() end,
}

function G.Slash(message)
  if not G.ready then
    print("WowGrok is still loading.")
    return
  end
  local text = trim(message)
  if text == "" then
    G.Toggle()
    return
  end
  local cmd, rest = text:match("^(%S+)%s*(.*)$")
  cmd = cmd and cmd:lower() or ""
  local handler = commands[cmd]
  if handler then
    handler(rest or "")
    return
  end
  G.Send(text)
end

SLASH_WOWGROK1 = "/wow-grok"
SLASH_WOWGROK2 = "/grok"
SlashCmdList = SlashCmdList or {}
SlashCmdList.WOWGROK = function(message) G.Slash(message or "") end

SLASH_WOWGROKAI1 = "/ai"
SlashCmdList.WOWGROKAI = function(message)
  if not G.ready then return end
  G.Send(message or "")
end
