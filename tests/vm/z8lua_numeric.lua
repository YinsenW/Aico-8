local function emit(name,value)
 print("p8vm|"..name.."|"..tostr(value,true))
end

emit("wrap_positive",0x7fff.ffff+0x0.0001)
emit("wrap_negative",0x8000-0x0.0001)
emit("divide_positive_zero",1/0)
emit("divide_negative_zero",-1/0)
emit("sin_quarter",sin(0.25))
emit("cos_zero",cos(0))
emit("sgn_zero",sgn(0))
emit("integer_divide",9\2)
