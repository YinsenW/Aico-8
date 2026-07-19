pico-8 cartridge // http://www.pico-8.com
version 43
__lua__
-- Browser-safe, capability-qualified audio probe. It avoids desktop-only
-- extcmd/file output and emits only status selectors whose transition meaning
-- is deterministic across the official browser host and the compatibility
-- kernel. PCM is captured independently from each host.

local update_no=0

local function emit_status()
 local row=tostr(stat(24),true)..","..tostr(stat(54),true)..","..tostr(stat(57),true)
 printh("p8probe|audio_"..update_no.."|"..row)
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
 print("audio web oracle",30,54,7)
 print(update_no.." / 150",44,66,6)
end
__sfx__
000800001807018070180701807018070180701807018070180701807018070180701807018070180701807018070180701807018070180701807018070180701807018070180701807018070180701807018070
6e0800042057021570225702357020570215702257023570000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
__music__
00 00404040
