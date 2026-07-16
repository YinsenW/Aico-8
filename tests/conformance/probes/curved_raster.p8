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

reset()
cls(0)
oval(0,0,6,4,8)
for y=0,4 do emit("oval_odd_"..y,row(y,0,6)) end

cls(0)
oval(15,3,10,0,9)
for y=0,3 do emit("oval_even_reversed_"..y,row(y,10,15)) end

cls(0)
ovalfill(0,0,6,4,10)
for y=0,4 do emit("ovalfill_"..y,row(y,0,6)) end

cls(0)
rrectfill(0,0,10,8,0,11)
emit("rrectfill_r0_top",row(0,0,9))
rrectfill(12,0,10,8,1,12)
emit("rrectfill_r1_top",row(0,12,21))
rrectfill(24,0,10,8,2,13)
emit("rrectfill_r2_top",row(0,24,33))
rrectfill(36,0,16,16,6,14)
for y=0,5 do emit("rrectfill_r6_"..y,row(y,36,51)) end
rrect(54,0,10,8,99,7)
for y=0,3 do emit("rrect_clamped_"..y,row(y,54,63)) end

cls(1)
clip(0,20,8,8)
poke(0x5f34,3)
ovalfill(2,22,5,25,0x1808.0000)
clip()
emit("oval_inverted",tostr(pget(0,20))..","..tostr(pget(3,23))..","..tostr(pget(8,20)))

cls(1)
clip(0,30,8,8)
rrectfill(2,32,4,4,1,0x1809.0000)
clip()
emit("rrect_inverted",tostr(pget(0,30))..","..tostr(pget(3,33))..","..tostr(pget(8,30)))

poke(0x5f34,0)
cls(0)
oval(0.5,40.5,6.5,44.5,8)
for y=40,44 do emit("oval_fractional_"..y,row(y,0,7)) end

pal(7,143,1)
emit("extended_display_register",peek(0x5f17))
pal()
sset(0,0,7)
mset(0,0,0)
cls(6)
map(0,0,0,50,1,1)
emit("map_sprite_zero_default",pget(0,50))
poke(0x5f36,8)
map(0,0,0,50,1,1)
emit("map_sprite_zero_override",pget(0,50))
poke(0x5f59,9)
poke(0x5f5a,10)
poke(0x5f5b,11)
poke(0x5f36,0x18)
emit("out_of_bounds",tostr(sget(-1,0))..","..tostr(mget(-1,0))..","..tostr(pget(-1,0)))

function _draw()
end
