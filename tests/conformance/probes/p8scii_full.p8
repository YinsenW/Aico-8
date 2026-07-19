pico-8 cartridge // http://www.pico-8.com
version 43
__lua__
-- Complete built-in P8SCII raster and advance probe for printable bytes 16..255.
-- Every character is anchored to its own 8x8 cell so variable advances cannot
-- move neighbouring glyphs. The live 128x128 canvas is the pixel oracle.

local function emit(name,value)
 printh("p8probe|"..name.."|"..value)
end

function _init()
 cls(0)
 for row=1,15 do
  local widths=""
  for column=0,15 do
   local byte=row*16+column
   local width=print(chr(byte),column*8,(row-1)*8,7)
   widths..=(column>0 and "," or "")..tostr(width)
  end
  emit("widths_"..row,widths)
 end
 emit("cursor",tostr(peek(0x5f26))..","..tostr(peek(0x5f27)))
 emit("capture_ready","240-glyphs")
end

function _draw()
end
__gfx__
