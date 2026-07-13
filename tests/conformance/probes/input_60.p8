pico-8 cartridge // http://www.pico-8.com
version 43
__lua__
local tick=0

local function emit(name,value)
 printh("p8probe|"..name.."|"..tostr(value))
end

function _update60()
 tick+=1
 if btnp(0) then emit("btnp",tick) end
 if tick==2 then emit("held",tostr(btn(0))..":"..tostr(btn())..":"..tostr(peek(0x5f4c))) end
end

function _draw()
end
