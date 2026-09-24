-- Pixel codec. Pure Lua so it can be tested outside the game.
-- Frame bytes: magic, 16-bit id, 16-bit length, payload, Fletcher-16 over id..payload.
-- Bytes are packed MSB-first into 3-bit cells. Bit 2 is red, bit 1 green, bit 0 blue.

WowGrok_Codec = {}
local C = WowGrok_Codec

C.MAGIC1, C.MAGIC2 = 0xC7, 0x1A
C.BITS = 3
C.MAX_PAYLOAD = 3200

function C.Fletcher16(bytes, from, to)
  local s1, s2 = 0, 0
  for i = from, to do
    s1 = (s1 + bytes[i]) % 255
    s2 = (s2 + s1) % 255
  end
  return s1, s2
end

function C.Encode(id, payload)
  payload = payload or ""
  local len = #payload
  if len > C.MAX_PAYLOAD then
    return nil, "That message is too long for the pixel strip (" .. C.MAX_PAYLOAD .. " bytes). Shorten it or split it."
  end
  local bytes = {
    C.MAGIC1, C.MAGIC2,
    math.floor(id / 256) % 256, id % 256,
    math.floor(len / 256) % 256, len % 256,
  }
  for i = 1, len do
    bytes[#bytes + 1] = payload:byte(i)
  end
  local s1, s2 = C.Fletcher16(bytes, 3, 6 + len)
  bytes[#bytes + 1] = s1
  bytes[#bytes + 1] = s2

  local cells = {}
  local acc, nbits = 0, 0
  for i = 1, #bytes do
    acc = acc * 256 + bytes[i]
    nbits = nbits + 8
    while nbits >= 3 do
      local shift = nbits - 3
      local div = 2 ^ shift
      cells[#cells + 1] = math.floor(acc / div) % 8
      nbits = shift
      acc = acc % div
    end
  end
  if nbits > 0 then
    cells[#cells + 1] = (acc * 2 ^ (3 - nbits)) % 8
  end
  return cells, #bytes
end

function C.CellColor(v)
  local r = math.floor(v / 4) % 2
  local g = math.floor(v / 2) % 2
  local b = v % 2
  return r, g, b
end
