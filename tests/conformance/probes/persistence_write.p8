pico-8 cartridge // http://www.pico-8.com
version 43
__lua__
local function emit(name,value)
 printh("p8probe|"..name.."|"..tostr(value,true))
end

emit("a_initial_loaded",cartdata("p8remake_conformance_a"))
dset(0,123.5)
dset(63,-2.25)
emit("a_dget_0",dget(0))
emit("a_dget_63",dget(63))
emit("a_mapped_memory_0",peek4(0x5e00))

emit("b_initial_loaded",cartdata("p8remake_conformance_b"))
emit("b_zero_initialized",dget(0))
dset(0,77)

emit("c_initial_loaded",cartdata("p8remake_conformance_c"))
dset(0,3)
emit("d_initial_loaded",cartdata("p8remake_conformance_d"))
dset(0,4)

emit("a_reloaded",cartdata("p8remake_conformance_a"))
emit("a_reloaded_0",dget(0))
emit("a_reloaded_63",dget(63))

function _draw()
end
