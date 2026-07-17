pico-8 cartridge // http://www.pico-8.com
version 43
__lua__
-- A visual-only companion to curved_raster.p8. Keeping an empty _draw()
-- callback prevents Education Edition from returning to its host shell before
-- the operator captures the declared framebuffer. The asymmetric 2x2 marker
-- binds the screenshot crop to logical origin (0,0).
local keep_alive=0

function _init()
 camera()
 clip()
 pal()
 palt()
 fillp()
 poke(0x5f34,0)
 poke(0x5f36,0)
 cls(1)
 oval(8,8,47,35,8)
 ovalfill(56,8,95,35,10)
 rrect(8,48,40,28,10,11)
 rrectfill(56,48,40,28,10,12)
 pal(7,143,1)
 rrectfill(16,88,96,24,8,7)
 print("extended 143",33,97,0)
 pset(0,0,8)
 pset(1,0,9)
 pset(0,1,10)
 pset(1,1,11)
 printh("p8probe|live_frame_ready|8,9,10,11,"..peek(0x5f17))
end

function _update()
 keep_alive+=0
end

function _draw()
 camera()
end
__gfx__
