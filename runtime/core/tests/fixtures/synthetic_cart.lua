function _init()
 cartdata("aico8_synthetic")
 x=dget(0)
 fset(1,5)
 fset(1,2,true)
 fset(1,0,false)
 flags=fget(1)
 layer=fget(1,2)
 mode="fixture"
 actors={{x=3,rock=true},{x=4,rock=false}}
 player={x=11,active=true}
 values={4,9}
 menu_buttons=-1
 poke(0x2000,2)
 reload(0x2000,0x2000,1)
 restored=peek(0x2000)
 menuitem(0x301,"fixture action",function(buttons)
  menu_buttons=buttons
  menuitem(nil,"stay open",function() return false end)
  return true
 end)
 sfx(0,0)
 ready=true
end

function _update()
 if btnp(➡️) then x=7 dset(0,x) end
 if btnp(🅾️) then run() end
end

function _draw()
 cls()
 pal(1,9)
 map(0,0,0,0,2,1)
 spr(1,16,0)
 color(7)
 pset(24,0)
 color(6)
 rect(26,0,28,2)
 color(5)
 rectfill(30,0,32,2)
 color(8)
 circ(42,2,2)
 color(9)
 circfill(48,2,2)
 color(7)
 print("ok",34,0)
 pal()
end
