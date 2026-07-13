pico-8 cartridge // http://www.pico-8.com
version 43
__lua__
local tick=0

local function emit(name,value)
 printh("p8probe|"..name.."|"..tostr(value))
end

function _update()
 tick+=1
 local first=btnp(0)
 local second=btnp(0)
 if first or second then
  emit("btnp",tostr(tick)..":"..tostr(first)..":"..tostr(second)..":"..tostr(btn(0))..":"..tostr(peek(0x5f4c)))
 end
 if tick==2 then
  emit("held",tostr(btn(0))..":"..tostr(btn())..":"..tostr(peek(0x5f4c)))
 end
 if tick==25 then
  emit("released",tostr(btn(0))..":"..tostr(btnp(0))..":"..tostr(peek(0x5f4c)))
  poke(0x5f5c,3)
  poke(0x5f5d,2)
 end
end

function _draw()
end
