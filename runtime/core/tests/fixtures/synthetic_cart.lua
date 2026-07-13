function _init()
 cartdata("aico8_synthetic")
 x=dget(0)
 ready=true
end

function _update()
 if btnp(1) then x=7 dset(0,x) end
 if btnp(4) then run() end
end

function _draw()
 cls()
 pal(1,9)
 map(0,0,0,0,2,1)
 spr(1,16,0)
 pset(24,0,7)
 rect(26,0,28,2,6)
 rectfill(30,0,32,2,5)
 print("ok",34,0,7)
 pal()
end
