pico-8 cartridge // http://www.pico-8.com
version 43
__lua__
local function emit(name,value)
 printh("p8probe|"..name.."|"..tostr(value))
end

function _init()
cls(0)
pset(2,2,8)
emit("pset_pget",pget(2,2))

camera(10,20)
pset(10,20,9)
camera()
emit("camera_offset",pget(0,0))

clip(4,4,2,2)
pset(3,3,10)
pset(4,4,11)
clip()
emit("clip_outside",pget(3,3))
emit("clip_inside",pget(4,4))

pal(8,12)
pset(1,1,8)
pal()
emit("draw_palette",pget(1,1))

pal(8,12,1)
pset(5,5,8)
pal(1)
emit("display_palette_not_in_pget",pget(5,5))

sset(0,0,8)
palt(8,true)
spr(0,20,20)
emit("sprite_transparent",pget(20,20))
palt()
spr(0,20,20)
emit("sprite_opaque",pget(20,20))

sset(8,0,14)
mset(0,0,1)
fset(1,0,true)
map(0,0,30,30,1,1,2)
emit("map_layer_rejected",pget(30,30))
map(0,0,30,30,1,1,1)
emit("map_layer_accepted",pget(30,30))
end

function _draw()
end
__gfx__
