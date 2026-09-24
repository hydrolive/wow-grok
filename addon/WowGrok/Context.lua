-- Game context and shift-click tooltip expansion. Every client call is wrapped.

WowGrok_Context = {}
local X = WowGrok_Context

local function trim(s)
  return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

local function try(fn)
  local ok, a, b, c, d, e = pcall(fn)
  if not ok then return nil end
  return a, b, c, d, e
end

local function add(parts, key, text)
  text = trim(text)
  if text ~= "" then parts[#parts + 1] = { key = key, text = text } end
end

local function clientLine()
  local version, build, _, toc = try(function() return GetBuildInfo() end)
  if not version and not toc then return nil end
  return string.format("Client: %s build %s interface %s", tostring(version or "?"), tostring(build or "?"), tostring(toc or "?"))
end

local function characterLine()
  local name, realm = try(function() return UnitName("player") end)
  realm = realm or try(GetRealmName)
  local level = try(function() return UnitLevel("player") end)
  local race = try(function() return UnitRace("player") end)
  local class = try(function() return UnitClass("player") end)
  local faction = try(function() return UnitFactionGroup("player") end)
  local guild = try(function() return GetGuildInfo("player") end)
  if not name then return nil end
  local line = string.format(
    "Character: %s - %s, level %s %s %s (%s)",
    tostring(name), tostring(realm or "?"), tostring(level or "?"),
    tostring(race or ""), tostring(class or ""), tostring(faction or "?")
  )
  if guild and guild ~= "" then line = line .. ", <" .. guild .. ">" end
  return line
end

local function coords()
  local x, y = try(function()
    if C_Map and C_Map.GetBestMapForUnit and C_Map.GetPlayerMapPosition then
      local map = C_Map.GetBestMapForUnit("player")
      local pos = map and C_Map.GetPlayerMapPosition(map, "player")
      if pos then
        local px = pos.x or pos:GetXY()
        local py = pos.y
        if pos.GetXY then px, py = pos:GetXY() end
        return px, py
      end
    end
    if GetPlayerMapPosition then return GetPlayerMapPosition("player") end
  end)
  if type(x) ~= "number" or type(y) ~= "number" then return nil end
  if x == 0 and y == 0 then return nil end
  return string.format("(%.1f, %.1f)", x * 100, y * 100)
end

local function positionLine()
  local zone = try(GetZoneText)
  local sub = try(GetSubZoneText)
  if not zone and not sub then return nil end
  local where = tostring(zone or "?")
  if sub and sub ~= "" and sub ~= zone then where = where .. ", " .. sub end
  local xy = coords()
  if xy then where = where .. " " .. xy end
  return "Position: " .. where
end

local function moneyLine()
  local copper = try(GetMoney)
  if type(copper) ~= "number" then return nil end
  local gold = math.floor(copper / 10000)
  local silver = math.floor((copper % 10000) / 100)
  local cu = copper % 100
  return string.format("Money: %dg %ds %dc", gold, silver, cu)
end

local function professionsLine()
  local names = {}
  local function push(name, rank, maxRank)
    if name and name ~= "" then
      names[#names + 1] = string.format("%s %s/%s", name, tostring(rank or "?"), tostring(maxRank or "?"))
    end
  end
  try(function()
    if GetProfessions and GetProfessionInfo then
      local a, b, c, d, e = GetProfessions()
      for _, idx in ipairs({ a, b, c, d, e }) do
        if idx then
          local name, _, rank, maxRank = GetProfessionInfo(idx)
          push(name, rank, maxRank)
        end
      end
      return
    end
    if GetNumSkillLines and GetSkillLineInfo then
      for i = 1, GetNumSkillLines() do
        local name, isHeader, _, rank, _, _, maxRank = GetSkillLineInfo(i)
        if name and not isHeader and maxRank and maxRank > 0 then push(name, rank, maxRank) end
      end
    end
  end)
  if #names == 0 then return nil end
  return "Professions: " .. table.concat(names, ", ")
end

local function questsLine()
  local titles = {}
  try(function()
    if C_QuestLog and C_QuestLog.GetNumQuestLogEntries and C_QuestLog.GetInfo then
      local n = C_QuestLog.GetNumQuestLogEntries()
      for i = 1, n do
        local info = C_QuestLog.GetInfo(i)
        if info and not info.isHeader and info.title then
          titles[#titles + 1] = "[" .. tostring(info.questID or i) .. "] " .. info.title
        end
        if #titles >= 8 then break end
      end
      return
    end
    if GetNumQuestLogEntries and GetQuestLogTitle then
      local n = GetNumQuestLogEntries()
      for i = 1, n do
        local title, _, _, isHeader, _, _, _, id = GetQuestLogTitle(i)
        if title and not isHeader then
          titles[#titles + 1] = "[" .. tostring(id or i) .. "] " .. title
        end
        if #titles >= 8 then break end
      end
    end
  end)
  if #titles == 0 then return nil end
  return "Quests: " .. table.concat(titles, "; ")
end

local EQUIP = {
  { 1, "Head" }, { 2, "Neck" }, { 3, "Shoulder" }, { 5, "Chest" }, { 6, "Waist" },
  { 7, "Legs" }, { 8, "Feet" }, { 9, "Wrist" }, { 10, "Hands" },
  { 11, "Finger" }, { 12, "Finger" }, { 13, "Trinket" }, { 14, "Trinket" },
  { 15, "Back" }, { 16, "MainHand" }, { 17, "OffHand" }, { 18, "Ranged" },
}

local function itemName(link)
  if not link then return nil end
  return link:match("%[(.-)%]") or link
end

local function equipmentLine()
  local bits = {}
  for _, slot in ipairs(EQUIP) do
    local link = try(function() return GetInventoryItemLink("player", slot[1]) end)
    local name = itemName(link)
    if name then bits[#bits + 1] = slot[2] .. " " .. name end
  end
  if #bits == 0 then return nil end
  return "Equipment: " .. table.concat(bits, "; ")
end

local function bagsLine()
  local total, empty = 0, 0
  local items = {}
  try(function()
    for bag = 0, 4 do
      local slots = nil
      if C_Container and C_Container.GetContainerNumSlots then slots = C_Container.GetContainerNumSlots(bag)
      elseif GetContainerNumSlots then slots = GetContainerNumSlots(bag) end
      slots = slots or 0
      total = total + slots
      for slot = 1, slots do
        local info
        if C_Container and C_Container.GetContainerItemInfo then info = C_Container.GetContainerItemInfo(bag, slot)
        end
        local link, count
        if type(info) == "table" then
          link, count = info.hyperlink, info.stackCount
        elseif GetContainerItemLink then
          link = GetContainerItemLink(bag, slot)
          local _, qty = GetContainerItemInfo(bag, slot)
          count = qty
        end
        if not link then empty = empty + 1
        elseif #items < 8 then
          items[#items + 1] = (itemName(link) or "item") .. " x" .. tostring(count or 1)
        end
      end
    end
  end)
  if total == 0 and #items == 0 then return nil end
  local line = string.format("Bags: %d slots, %d empty", total, empty)
  if #items > 0 then line = line .. "; " .. table.concat(items, ", ") end
  return line
end

local function groupLine()
  local grouped = try(function()
    if IsInRaid and IsInRaid() then return "raid"
    elseif IsInGroup and IsInGroup() then return "party" end
  end)
  if not grouped then return nil end
  local names = {}
  local n = try(GetNumGroupMembers) or 0
  local prefix = grouped == "raid" and "raid" or "party"
  local limit = grouped == "raid" and n or math.min(n, 4)
  for i = 1, limit do
    local unit = prefix .. i
    local name = try(function() return UnitName(unit) end)
    if name then names[#names + 1] = name end
    if #names >= 8 then break end
  end
  local line = string.format("Group: %s of %s", grouped, tostring(n))
  if #names > 0 then line = line .. " with " .. table.concat(names, ", ") end
  return line
end

local function targetLine()
  local exists = try(function() return UnitExists("target") end)
  if not exists then return nil end
  local name = try(function() return UnitName("target") end)
  local level = try(function() return UnitLevel("target") end)
  local class = try(function() return UnitClass("target") end) or try(function() return UnitCreatureType("target") end)
  local rank = try(function() return UnitClassification("target") end)
  if not name then return nil end
  local line = "Target: " .. name .. " level " .. tostring(level or "?")
  if class and class ~= "" then line = line .. " " .. class end
  if rank and rank ~= "" and rank ~= "normal" then line = line .. " " .. rank end
  return line
end

local function render(list)
  local lines = {}
  for _, part in ipairs(list) do lines[#lines + 1] = part.text end
  return table.concat(lines, "\n")
end

local function without(list, key)
  local nextList = {}
  for _, part in ipairs(list) do
    if part.key ~= key then nextList[#nextList + 1] = part end
  end
  return nextList
end

function X.GameContext(budget)
  budget = tonumber(budget) or 800
  local parts = {}
  add(parts, "client", try(clientLine))
  add(parts, "character", try(characterLine))
  add(parts, "position", try(positionLine))
  add(parts, "money", try(moneyLine))
  add(parts, "professions", try(professionsLine))
  add(parts, "quests", try(questsLine))
  add(parts, "equipment", try(equipmentLine))
  add(parts, "bags", try(bagsLine))
  add(parts, "group", try(groupLine))
  add(parts, "target", try(targetLine))
  local text = render(parts)
  local drop = { "bags", "equipment", "quests", "group", "professions", "target", "money" }
  for _, key in ipairs(drop) do
    if #text <= budget then break end
    parts = without(parts, key)
    text = render(parts)
  end
  if #text > budget then
    if budget <= 3 then return text:sub(1, budget) end
    local cut = text:sub(1, budget - 3)
    local nl = cut:match(".*()\n")
    if nl and nl > #cut / 2 then cut = cut:sub(1, nl - 1) end
    text = cut .. "..."
  end
  return text
end

function X.Tip()
  if X.tip then return X.tip end
  if not CreateFrame then return nil end
  local parent = UIParent
  local ok, tip = pcall(CreateFrame, "GameTooltip", "WowGrokTip", parent, "GameTooltipTemplate")
  if not ok then
    ok, tip = pcall(CreateFrame, "GameTooltip", "WowGrokTip", parent)
  end
  if ok then X.tip = tip end
  return X.tip
end

local function readTip(link, name)
  local lines = { "[" .. name .. "]" }
  pcall(function()
    local tip = X.Tip()
    if not tip then return end
    if tip.ClearLines then tip:ClearLines() end
    if tip.SetOwner and UIParent then tip:SetOwner(UIParent, "ANCHOR_NONE") end
    tip:SetHyperlink(link)
    local n = tip.NumLines and tip:NumLines() or 0
    for i = 1, n do
      local left = _G["WowGrokTipTextLeft" .. i]
      local right = _G["WowGrokTipTextRight" .. i]
      local l = left and left.GetText and left:GetText() or nil
      local r = right and right.GetText and right:GetText() or nil
      if l and l ~= "" and r and r ~= "" then lines[#lines + 1] = l .. "  " .. r
      elseif l and l ~= "" then lines[#lines + 1] = l end
    end
  end)
  return table.concat(lines, "\n")
end

function X.ExpandLinks(text)
  if type(text) ~= "string" or not text:find("|H", 1, true) then return text or "" end
  local blocks = {}
  local function repl(link, name)
    blocks[#blocks + 1] = readTip(link, name)
    return "[" .. name .. "]"
  end
  local plain = text:gsub("|c%x%x%x%x%x%x%x%x|H([^|]+)|h%[([^%]]+)%]|h|r", repl)
  plain = plain:gsub("|H([^|]+)|h%[([^%]]+)%]|h", repl)
  if #blocks == 0 then return text end
  return plain .. "\n\n--- Linked from the game ---\n" .. table.concat(blocks, "\n\n")
end
