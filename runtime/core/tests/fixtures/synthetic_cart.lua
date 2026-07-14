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
 pset(24,0,7)
 rect(26,0,28,2,6)
 rectfill(30,0,32,2,5)
 circ(42,2,2,8)
 circfill(48,2,2,9)
 print("ok",34,0,7)
 pal()
end
