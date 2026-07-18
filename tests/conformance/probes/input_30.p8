pico-8 cartridge // http://www.pico-8.com
version 43
__lua__
local tick=0
local phase=0

local function emit(name,value)
 printh("p8probe|"..name.."|"..tostr(value))
end

function _update()
 if phase==3 then
  return
 end
 if phase==0 then
  if btn(0) then
   phase=1
  else
   return
  end
 end
 if phase==1 and tick==24 then
  if btn(0) then
   return
  end
  tick=25
  emit("released",tostr(btn(0))..":"..tostr(btnp(0))..":"..tostr(peek(0x5f4c)))
  poke(0x5f5c,3)
  poke(0x5f5d,2)
  emit("prompt","press-left-custom")
  phase=2
  return
 end
 if phase==2 then
  if not btn(0) then
   return
  end
  phase=1
 end
 tick+=1
 local first=btnp(0)
 local second=btnp(0)
 if first or second then
  emit("btnp",tostr(tick)..":"..tostr(first)..":"..tostr(second)..":"..tostr(btn(0))..":"..tostr(peek(0x5f4c)))
 end
 if tick==2 then
  emit("held",tostr(btn(0))..":"..tostr(btn())..":"..tostr(peek(0x5f4c)))
 end
 if tick==24 then
  emit("prompt","release-left")
 elseif tick==38 then
  emit("done","38")
  phase=3
 end
end

function _init()
 emit("ready","press-left-default")
end

function _draw()
end
__gfx__
