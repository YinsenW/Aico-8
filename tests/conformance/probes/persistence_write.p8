pico-8 cartridge // http://www.pico-8.com
version 43
__lua__
local function emit(name,value)
 printh("p8probe|"..name.."|"..tostr(value,true))
end

function _init()
 emit("slot_preexisting",cartdata("aico8_compat_persistence_20260718_v2"))
 emit("initial_0",dget(0))
 emit("initial_63",dget(63))
 dset(0,123.5)
 dset(63,-2.25)
 emit("written_0",dget(0))
 emit("written_63",dget(63))
 emit("mapped_memory_0",peek4(0x5e00))
end

function _draw()
end
__gfx__
