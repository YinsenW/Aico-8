pico-8 cartridge // http://www.pico-8.com
version 43
__lua__
local function emit(name,value)
 printh("p8probe|"..name.."|"..tostr(value,true))
end

local shorthand=0
if (true) shorthand+=1
while (shorthand<3) shorthand+=1
emit("shorthand",shorthand)

local t={10,20,30}
emit("add_return",add(t,40))
add(t,15,2)
emit("add_at_index",tostr(t[1])..","..tostr(t[2])..","..tostr(t[3])..","..tostr(t[4])..","..tostr(t[5]))
emit("del_return",del(t,20))
emit("deli_return",deli(t,1))
emit("table_after_delete",tostr(t[1])..","..tostr(t[2])..","..tostr(t[3]))

local iter={1,2,3,4}
local seen=""
for v in all(iter) do
 seen..=v
 if v==2 then del(iter,v) end
end
emit("all_delete_current",seen)

local s="abc"..chr(0x80)
emit("string_index",s[2])
emit("string_index_ord",ord(s[4]))
local a,b,c=ord("xyz",1,3)
emit("ord_multi",tostr(a)..","..tostr(b)..","..tostr(c))

emit("coerce_add",2+"3")
emit("coerce_concat","n="..4)
emit("tonum_hex",tonum("1234abcd",0x3))

local mt={__add=function(a,b) return a.v+b.v end}
local va=setmetatable({v=7},mt)
local vb=setmetatable({v=9},mt)
emit("metatable_add",va+vb)

local co=cocreate(function()
 yield(7)
 return 8
end)
local ok1,v1=coresume(co)
emit("coroutine_first",tostr(ok1)..","..tostr(v1)..","..costatus(co))
local ok2,v2=coresume(co)
emit("coroutine_second",tostr(ok2)..","..tostr(v2)..","..costatus(co))

emit("bit_expression",(0xf0 & 0x3c) | 0x2)

-- Current PICO-8 accepts any non-number third argument as "one character".
-- Keep this last so an older runtime that rejects it does not hide other results.
emit("sub_single",sub("abcd",2,true))

function _draw()
end
