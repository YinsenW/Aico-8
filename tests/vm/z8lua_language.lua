-- Compatibility shims intentionally cover APIs that z8lua documents as host
-- responsibilities. They let this probe isolate parser/VM behavior.
function add(t,value,index)
 if index then table.insert(t,index,value) else table.insert(t,value) end
 return value
end

function deli(t,index)
 return table.remove(t,index or #t)
end

function del(t,value)
 for i=1,#t do
  if t[i]==value then return deli(t,i) end
 end
end

function all(t)
 local snapshot={}
 for i=1,#t do snapshot[i]=t[i] end
 local i=0
 return function()
  i+=1
  return snapshot[i]
 end
end

cocreate=coroutine.create
coresume=coroutine.resume
costatus=coroutine.status
yield=coroutine.yield

function sub(value,first,last)
 if type(last)~="number" then last=first end
 return string.sub(value,first,last)
end

local function emit(name,value)
 print("p8vm|"..name.."|"..tostr(value,true))
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
emit("sub_single",sub("abcd",2,true))
