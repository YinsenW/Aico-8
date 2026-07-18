pico-8 cartridge // http://www.pico-8.com
version 43
__lua__
local function emit(name,value)
 printh("p8probe|"..name.."|"..tostr(value))
end

function _init()
 local special=chr(6)
 local glyph=special..":ff818181818181ff"

 cls(0)
 local w=print(glyph,0,0,7)
 emit("inline_glyph_width",w)
 emit("inline_glyph_pixels",tostr(pget(0,0))..","..tostr(pget(1,1)))

 w=print(chr(1).."3".."a",0,10,7)
 emit("repeat_width",w)

 w=print(glyph..chr(0)..glyph,0,20,7)
 emit("terminate_width",w)

 print(chr(12).."8"..glyph,10,0,7)
 emit("foreground_control",pget(10,0))
 emit("foreground_side_effect",peek(0x5f25))

 print(chr(2).."4"..glyph,20,0,7)
 emit("solid_background",tostr(pget(20,0))..","..tostr(pget(21,1)))

 w=print(special.."j23"..glyph,0,0,7)
 emit("absolute_cursor_width",w)
 emit("absolute_cursor_pixel",pget(8,12))

 print(special.."@43000004".."abcd",0,-20,7)
 emit("raw_memory_write",tostr(peek(0x4300))..","..tostr(peek(0x4301))..","..tostr(peek(0x4302))..","..tostr(peek(0x4303)))

 poke(0x5600,8,8,8,0,0,0,4,0)
 poke(0x5680,1,2,4,8,16,32,64,128)
 w=print(chr(14)..chr(16)..chr(15),30,0,6)
 emit("custom_font_width",w)
 emit("custom_font_pixels",tostr(pget(30,0))..","..tostr(pget(31,0))..","..tostr(pget(37,7)))

 print(special.."o8ff"..":",50,1,3)
 emit("outline_pixels",tostr(pget(50,1))..","..tostr(pget(51,2)))

 print(special.."u"..":",60,1,3)
 emit("underline_pixel",pget(59,7))
end

function _draw()
end
__gfx__
