pico-8 cartridge // http://www.pico-8.com
version 43
__lua__
local function emit(name,value)
 printh("p8probe|"..name.."|"..tostr(value,true))
end

emit("wrap_positive",0x7fff.ffff+0x0.0001)
emit("wrap_negative",0x8000-0x0.0001)
emit("divide_positive_zero",1/0)
emit("divide_negative_zero",-1/0)
emit("sin_quarter",sin(0.25))
emit("cos_zero",cos(0))
emit("sgn_zero",sgn(0))
emit("integer_divide",9\2)

poke(0x4300,0x34,0x12)
emit("peek2_little_endian",peek2(0x4300))

sset(0,64,3)
emit("gfx_map_shared_alias",mget(0,32))

function _draw()
end
