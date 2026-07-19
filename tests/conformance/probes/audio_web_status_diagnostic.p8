pico-8 cartridge // http://www.pico-8.com
version 43
__lua__
-- Official-Web diagnostic only. stat(46..56) depends on the browser audio
-- callback schedule, so this trace measures host variation and must never be
-- promoted to a logical-update-exact compatibility golden.

local update_no=0

local function emit_status()
 local row=tostr(stat(24),true)
 for i=46,57 do
  row..=","..tostr(stat(i),true)
 end
 printh("p8probe|audio_diag_"..update_no.."|"..row)
end

function _init()
 music(0)
 emit_status()
end

function _update60()
 update_no+=1
 if update_no==10 then sfx(0,3) end
 if update_no==40 then sfx(-2,3) end
 if update_no==70 then
  memcpy(0x3288,0x3200,68)
  sfx(2,2)
 end
 if update_no==90 then music(-1,500) end
 if update_no<=150 then emit_status() end
end

function _draw()
 cls(0)
 print("audio web diagnostic",24,54,7)
 print(update_no.." / 150",44,66,6)
end
__sfx__
000800001807018070180701807018070180701807018070180701807018070180701807018070180701807018070180701807018070180701807018070180701807018070180701807018070180701807018070
6e0800042057021570225702357020570215702257023570000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
__music__
00 00404040
