pico-8 cartridge // http://www.pico-8.com
version 43
__lua__
local tick=0
local running=false
local done=false

local function emit(name,value)
 printh("p8probe|"..name.."|"..tostr(value))
end

function _update60()
 if done then return end
 if not running then
  if not btn(0) then return end
  running=true
 end
 tick+=1
 if btnp(0) then emit("btnp",tick) end
 if tick==2 then emit("held",tostr(btn(0))..":"..tostr(btn())..":"..tostr(peek(0x5f4c))) end
 if tick==50 then
  emit("done","50")
  done=true
 end
end

function _init()
 emit("ready","press-left")
end

function _draw()
end
__gfx__
