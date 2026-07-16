pico-8 cartridge // http://www.pico-8.com
version 43
__lua__
local function emit(name,value)
 printh("p8probe|"..name.."|"..tostr(value))
end

local function row(y,x0,x1)
 local out=""
 for x=x0,x1 do
  if #out>0 then out..="," end
  out..=pget(x,y)
 end
 return out
end

-- fill pattern orientation and transparency
cls(0)
fillp(0b0000000100110111)
rectfill(0,0,3,3,0xe8)
emit("fillp_row_0",row(0,0,3))
emit("fillp_row_1",row(1,0,3))
emit("fillp_row_2",row(2,0,3))
emit("fillp_row_3",row(3,0,3))

cls(3)
fillp(0b0101101001011010.1)
rectfill(0,0,3,3,11)
emit("fillp_transparent_row",row(0,0,3))

-- secondary palette on sprites and globally
cls(0)
fillp()
pal()
palt()
for i=0,15 do pal(i,i+i*16,2) end
pal(12,0x87,2)
sset(0,0,12)
sset(1,0,12)
fillp(0b1000000000000000.01)
spr(0,12,0)
emit("secondary_sprite",row(0,12,13))

fillp(0b1000000000000000.001)
rectfill(20,0,21,0,12)
emit("secondary_global",row(0,20,21))

pal(3,12)
rectfill(24,0,25,0,3)
emit("draw_then_secondary",row(0,24,25))

-- a colour argument can carry a fill pattern
pal()
fillp()
cls(0)
poke(0x5f34,0x1)
rectfill(0,10,3,13,0x104e.abcd)
emit("embedded_pattern_registers",tostr(peek(0x5f31))..","..tostr(peek(0x5f32))..","..tostr(peek(0x5f33)))
emit("embedded_pattern_row",row(10,0,3))

-- inverted filled shapes draw outside the shape, within the clip rectangle
fillp()
cls(1)
clip(0,20,8,8)
poke(0x5f34,0x2)
circfill(3,23,1,0x1808.0000)
clip()
emit("inverted_outside",pget(0,20))
emit("inverted_inside",pget(3,23))

-- tline: default tile-space sampling, masks/offsets, and pixel-space precision
poke(0x5f34,0)
pal()
palt()
fillp()
cls(0)
for x=0,7 do sset(8+x,0,x+1) end
for x=0,7 do sset(16+x,0,8+x) end
mset(0,0,1)
mset(1,0,2)
tline(0,30,7,30,0,0)
emit("tline_default",row(30,0,7))

poke(0x5f38,1)
poke(0x5f3a,1)
tline(0,31,7,31,0,0)
emit("tline_mask_offset",row(31,0,7))

poke(0x5f38,0)
poke(0x5f3a,0)
tline(16)
tline(0,32,7,32,0,0,1,0)
emit("tline_pixel_precision",row(32,0,7))

-- low-level video and map remapping
camera()
clip()
pal()
palt()
fillp()
poke(0x5f34,0)
poke(0x5f36,0)
cls(0)
pset(0,0,9)
pset(1,0,10)
poke(0x5f54,0x60)
emit("gfx_to_screen_sget",tostr(sget(0,0))..","..tostr(sget(1,0)))
emit("gfx_to_screen_peek",peek(0))
poke(0x5f54,0)

sset(0,0,11)
sset(1,0,12)
poke(0x5f55,0)
emit("screen_to_gfx_pget",tostr(pget(0,0))..","..tostr(pget(1,0)))
poke(0x5f55,0x60)

poke(0x8000,0xdc)
poke(0x5f54,0x80)
emit("upper_ram_gfx",tostr(sget(0,0))..","..tostr(sget(1,0)))
poke(0x5f54,0)

poke(0x8000,42,43)
poke(0x5f56,0x80)
poke(0x5f57,16)
emit("upper_ram_map_read",tostr(mget(0,0))..","..tostr(mget(1,0)))
mset(1,0,44)
emit("upper_ram_map_write",peek(0x8001))

function _draw()
end
