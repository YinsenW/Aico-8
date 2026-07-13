pico-8 cartridge // http://www.pico-8.com
version 43
__lua__
local function emit(name,value)
 printh("p8probe|"..name.."|"..tostr(value,true))
end

emit("a_loaded",cartdata("p8remake_conformance_a"))
emit("a_value_0",dget(0))
emit("a_value_63",dget(63))

emit("b_loaded",cartdata("p8remake_conformance_b"))
emit("b_value_0",dget(0))

emit("c_loaded",cartdata("p8remake_conformance_c"))
emit("c_value_0",dget(0))

emit("d_loaded",cartdata("p8remake_conformance_d"))
emit("d_value_0",dget(0))

function _draw()
end
