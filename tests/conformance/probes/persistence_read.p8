pico-8 cartridge // http://www.pico-8.com
version 43
__lua__
local function emit(name,value)
 printh("p8probe|"..name.."|"..tostr(value,true))
end

function _init()
 emit("slot_loaded",cartdata("aico8_compat_persistence_20260718_v2"))
 emit("persisted_0",dget(0))
 emit("persisted_63",dget(63))
 emit("mapped_memory_0",peek4(0x5e00))
end

function _draw()
end
__gfx__
