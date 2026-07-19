pico-8 cartridge // http://www.pico-8.com
version 43
__lua__
-- Appendix A control-7 probe. The RAM snapshots make the generated temporary
-- SFX grammar observable; the separate PCM artifact proves actual playback.

local function emit(name,value)
 printh("p8probe|"..name.."|"..value)
end

local function sfx_hex(index)
 local out=""
 local digits="0123456789abcdef"
 local address=0x3200+index*68
 for offset=0,67 do
  local value=peek(address+offset)
  local high=flr(value/16)+1
  local low=value%16+1
  out..=sub(digits,high,high)..sub(digits,low,low)
 end
 return out
end

function _init()
 print(chr(7).."12",0,-20,7)
 print(chr(7).."s4x5c1eg",0,-20,7)
 emit("generated_60",sfx_hex(60))
 emit("generated_61",sfx_hex(61))
 emit("generated_62",sfx_hex(62))
 emit("generated_63",sfx_hex(63))
 print(chr(7),0,-20,7)
 emit("bare_60",sfx_hex(60))
 emit("bare_61",sfx_hex(61))
 emit("bare_62",sfx_hex(62))
 emit("bare_63",sfx_hex(63))
 emit("capture_ready","existing-inline-bare")
end

function _draw()
 cls(0)
 print("p8scii audio",38,61,7)
end
__sfx__
000800001807018070180701807018070180701807018070180701807018070180701807018070180701807018070180701807018070180701807018070180701807018070180701807018070180701807018070
