pico-8 cartridge // http://www.pico-8.com
version 43
__lua__
local updates=0
local draws=0

function _update60()
 updates+=1
 printh("p8probe|update60|"..updates..":"..tostr(time()))
end

function _draw()
 draws+=1
 printh("p8probe|draw|"..draws..":"..updates)
end
