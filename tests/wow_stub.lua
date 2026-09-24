-- Minimal WoW client for tests/addon.test.js. Unknown frame methods no-op.

WowGrokTest = { sounds = {}, slots = {}, prints = {}, binding = "", reloaded = false }

local widgetIndex
local function widget(kind, name, parent)
  local w = {
    kind = kind or "Frame",
    name = name,
    parent = parent,
    scripts = {},
    text = "",
    shown = true,
    width = 100,
    height = 100,
    r = 0, g = 0, b = 0, a = 1,
  }
  setmetatable(w, { __index = widgetIndex })
  if name and name ~= "" then _G[name] = w end
  return w
end

widgetIndex = function(self, key)
  if key == "CreateFontString" or key == "CreateTexture" or key == "CreateLine" then
    return function() return widget(key, nil, self) end
  end
  if key == "SetScript" then
    return function(frame, event, fn) frame.scripts[event] = fn end
  end
  if key == "GetScript" then
    return function(frame, event) return frame.scripts[event] end
  end
  if key == "HookScript" then
    return function(frame, event, fn)
      local prev = frame.scripts[event]
      frame.scripts[event] = function(...)
        if prev then prev(...) end
        return fn(...)
      end
    end
  end
  if key == "SetText" then
    return function(frame, value) frame.text = value == nil and "" or tostring(value) end
  end
  if key == "GetText" then
    return function(frame) return frame.text or "" end
  end
  if key == "Insert" then
    return function(frame, value) frame.text = (frame.text or "") .. tostring(value or "") end
  end
  if key == "SetColorTexture" or key == "SetTextColor" then
    return function(frame, r, g, b, a)
      frame.r, frame.g, frame.b, frame.a = r or 0, g or 0, b or 0, a or 1
      frame.shown = true
    end
  end
  if key == "Show" then return function(frame) frame.shown = true end end
  if key == "Hide" then return function(frame) frame.shown = false end end
  if key == "IsShown" or key == "IsVisible" then
    return function(frame) return frame.shown ~= false end
  end
  if key == "HasFocus" then return function(frame) return frame.focused == true end end
  if key == "SetFocus" then return function(frame) frame.focused = true end end
  if key == "ClearFocus" then return function(frame) frame.focused = false end end
  if key == "GetParent" then return function(frame) return frame.parent end end
  if key == "SetParent" then return function(frame, parent) frame.parent = parent end end
  if key == "GetName" then return function(frame) return frame.name end end
  if key == "SetSize" then
    return function(frame, w, h) frame.width, frame.height = w, h end
  end
  if key == "SetWidth" then return function(frame, w) frame.width = w end end
  if key == "SetHeight" then return function(frame, h) frame.height = h end end
  if key == "GetWidth" then return function(frame) return frame.width or 0 end end
  if key == "GetHeight" then return function(frame) return frame.height or 0 end end
  if key == "GetStringWidth" then
    return function(frame) return #(frame.text or "") * 6 end
  end
  if key == "GetStringHeight" then return function() return 14 end end
  if key == "SetVerticalScroll" then
    return function(frame, v) frame.vscroll = v end
  end
  if key == "GetVerticalScroll" then
    return function(frame) return frame.vscroll or 0 end
  end
  if key == "NumLines" then return function(frame) return frame.nlines or 0 end end
  if key == "SetChecked" then return function(frame, v) frame.checked = v end end
  if key == "GetChecked" then return function(frame) return frame.checked end end
  return function() end
end

function CreateFrame(kind, name, parent)
  return widget(kind, name, parent)
end

UIParent = CreateFrame("Frame", "UIParent")
UISpecialFrames = {}
NUM_CHAT_WINDOWS = 1
ChatFrame1EditBox = CreateFrame("EditBox", "ChatFrame1EditBox")
SlashCmdList = {}

function hooksecurefunc(a, b, c)
  if type(a) == "string" then
    local name, fn = a, b
    local orig = _G[name]
    _G[name] = function(...)
      if orig then orig(...) end
      return fn(...)
    end
  else
    local obj, name, fn = a, b, c
    local orig = obj[name]
    obj[name] = function(...)
      if orig then orig(...) end
      return fn(...)
    end
  end
end

function SetItemRef() end

function print(...)
  local parts = {}
  for i = 1, select("#", ...) do parts[i] = tostring(select(i, ...)) end
  WowGrokTest.prints[#WowGrokTest.prints + 1] = table.concat(parts, " ")
end

function PlaySoundFile(path)
  return WowGrokTest.sounds[path] == true
end

function PlaySound() return true end
function FlashClientIcon() end
function ReloadUI() WowGrokTest.reloaded = true end
function SetBinding(key, command) WowGrokTest.binding = tostring(key) .. "=" .. tostring(command) end
function GetCurrentBindingSet() return 1 end
function SaveBindings() WowGrokTest.savedBindings = true end
function IsShiftKeyDown() return false end
function GetPhysicalScreenSize() return 1920, 1080 end
function GetBuildInfo() return "1.60.1", "69913", "Sep 23 2026", 16001 end
function GetRealmName() return "Realm" end
function GetGuildInfo() return "Pathfinders" end
function GetZoneText() return "Duskwood" end
function GetSubZoneText() return "Darkshire" end
function GetMoney() return 123456 end
function UnitName(unit)
  if unit == "player" then return "Tester", "Realm" end
  if unit == "target" then return "Hogger" end
  if unit == "party1" then return "Alice" end
end
function UnitLevel(unit)
  if unit == "player" then return 42 end
  if unit == "target" then return 11 end
  return 1
end
function UnitRace() return "Night Elf", "NightElf" end
function UnitClass() return "Hunter", "HUNTER" end
function UnitFactionGroup() return "Alliance" end
function UnitExists(unit) return unit == "player" or unit == "target" or unit == "party1" end
function UnitClassification() return "elite" end
function UnitCreatureType() return "Humanoid" end
function IsInGroup() return true end
function IsInRaid() return false end
function GetNumGroupMembers() return 2 end
function GetProfessions() return 1, 2 end
function GetProfessionInfo(index)
  if index == 1 then return "Mining", nil, 150, 300 end
  if index == 2 then return "Skinning", nil, 75, 300 end
end
function GetNumQuestLogEntries() return 2 end
function GetQuestLogTitle(index)
  if index == 1 then return "The Legend of Stalvan", nil, nil, false, nil, nil, nil, 12 end
  return "Wolves at Our Heels", nil, nil, false, nil, nil, nil, 13
end
function GetInventoryItemLink(_, slot)
  if slot == 16 then return "|Hitem:2140|h[Fine Longsword]|h" end
end

C_Map = {
  GetBestMapForUnit = function() return 1 end,
  GetPlayerMapPosition = function() return { x = 0.432, y = 0.671 } end,
}

C_Container = {
  GetContainerNumSlots = function(bag) return bag == 0 and 16 or 0 end,
  GetContainerItemInfo = function(bag, slot)
    if bag ~= 0 or slot > 16 then return nil end
    return { hyperlink = "|Hitem:1|h[" .. string.rep("A", 80) .. "]|h", stackCount = slot }
  end,
}

function LoadAddOn(name)
  local src = WowGrokTest.slots[name]
  if not src then return false, "missing" end
  local loader = loadstring or load
  local fn, err = loader(src, name)
  if not fn then return false, err end
  fn()
  return true
end

C_AddOns = { LoadAddOn = LoadAddOn }

time = os.time
date = os.date
tinsert = table.insert
