#include "p8/vm.h"

#include "lauxlib.h"
#include "lua.h"
#include "lualib.h"

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <new>
#include <string>

namespace {

constexpr uint16_t kRngStateA = 0x5f44;
constexpr uint16_t kRngStateB = 0x5f48;
constexpr uint16_t kPersistentBase = 0x5e00;

constexpr char kHostBootstrap[] = R"p8lua(
function all(c)
 if c==nil or #c==0 then return function() end end
 local i,prev=1,nil
 return function()
  if c[i]==prev then i+=1 end
  while i<=#c and c[i]==nil do i+=1 end
  prev=c[i]
  return prev
 end
end

function foreach(c,f)
 for value in all(c) do f(value) end
end

function add(c,value,index)
 if c!=nil then
  index=index and mid(1,index\1,#c+1) or #c+1
  for j=#c,index,-1 do c[j+1]=c[j] end
  c[index]=value
  return value
 end
end

function del(c,value)
 if c!=nil then
  for i=1,#c do
   if c[i]==value then
    for j=i,#c do c[j]=c[j+1] end
    return value
   end
  end
 end
end

function deli(c,index)
 if c!=nil then
  index=index and mid(1,index\1,#c) or #c
  local value=c[index]
  for j=index,#c do c[j]=c[j+1] end
  return value
 end
end

local __host_sub=string.sub
function sub(value,first,last)
 if last!=nil and type(last)!="number" then last=first end
 return __host_sub(value,first,last)
end

yield=coroutine.yield
cocreate=coroutine.create
coresume=coroutine.resume
costatus=coroutine.status
)p8lua";

int32_t raw_number(lua_State *state, int index, int32_t fallback = 0)
{
    return lua_isnoneornil(state, index) ? fallback : lua_tonumber(state, index).bits();
}

int integer(lua_State *state, int index, int fallback = 0)
{
    return lua_isnoneornil(state, index) ? fallback : static_cast<int32_t>(lua_tonumber(state, index));
}

uint32_t rotate16(uint32_t value)
{
    return (value >> 16) | (value << 16);
}

} // namespace

struct p8_vm {
    p8_core *core = nullptr;
    lua_State *state = nullptr;
    std::string error;
    std::string cartdata_id;
    bool cartdata_active = false;
    bool has_update60 = false;
    bool restart_requested = false;

    static p8_vm *from(lua_State *state)
    {
        return static_cast<p8_vm *>(lua_touserdata(state, lua_upvalueindex(1)));
    }

    void set_error_from_stack()
    {
        const char *message = lua_tostring(state, -1);
        error = message ? message : "unknown z8lua error";
        lua_pop(state, 1);
    }

    void update_rng()
    {
        uint32_t a = p8_core_peek32(core, kRngStateA);
        uint32_t b = p8_core_peek32(core, kRngStateB);
        b = a + rotate16(b);
        a += b;
        p8_core_poke32(core, kRngStateA, a);
        p8_core_poke32(core, kRngStateB, b);
    }

    void seed_rng(int32_t bits)
    {
        uint32_t a = bits != 0 ? static_cast<uint32_t>(bits) : 0xdeadbeefu;
        uint32_t b = a ^ 0xbead29bau;
        p8_core_poke32(core, kRngStateA, a);
        p8_core_poke32(core, kRngStateB, b);
        for (unsigned i = 0; i < 32; ++i) {
            update_rng();
        }
    }

    void install(const char *name, lua_CFunction function)
    {
        lua_pushlightuserdata(state, this);
        lua_pushcclosure(state, function, 1);
        lua_setglobal(state, name);
    }

    void emit(uint16_t opcode, lua_State *source, unsigned argument_count)
    {
        p8_draw_command command{};
        command.opcode = opcode;
        command.flags = static_cast<uint16_t>(lua_gettop(source));
        const unsigned count = std::min<unsigned>(argument_count, 12);
        for (unsigned i = 0; i < count; ++i) {
            command.args[i] = raw_number(source, static_cast<int>(i + 1));
        }
        p8_core_emit_draw(core, &command);
    }
};

namespace {

int api_mget(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    lua_pushnumber(state, p8_core_mget(vm->core, integer(state, 1), integer(state, 2)));
    return 1;
}

int api_mset(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    p8_core_mset(vm->core, integer(state, 1), integer(state, 2), static_cast<uint8_t>(integer(state, 3)));
    return 0;
}

int api_btn(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    if (lua_gettop(state) == 0) {
        lua_pushnumber(state, p8_core_btn_combined(vm->core));
    } else {
        lua_pushboolean(state, p8_core_btn(vm->core, static_cast<unsigned>(integer(state, 1)),
                                          static_cast<unsigned>(integer(state, 2))));
    }
    return 1;
}

int api_btnp(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    if (lua_gettop(state) == 0) {
        lua_pushnumber(state, p8_core_btnp_combined(vm->core));
    } else {
        lua_pushboolean(state, p8_core_btnp(vm->core, static_cast<unsigned>(integer(state, 1)),
                                           static_cast<unsigned>(integer(state, 2))));
    }
    return 1;
}

int api_cartdata(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    size_t size = 0;
    const char *id = luaL_checklstring(state, 1, &size);
    if (vm->cartdata_active) {
        lua_pushboolean(state, 0);
        return 1;
    }
    vm->cartdata_id.assign(id, size);
    vm->cartdata_active = true;
    lua_pushboolean(state, 0); // new in-memory slot; no prior file was loaded
    return 1;
}

int api_dget(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    const int index = integer(state, 1);
    const uint32_t bits = index >= 0 && index < 64
        ? p8_core_peek32(vm->core, static_cast<uint16_t>(kPersistentBase + index * 4))
        : 0;
    lua_pushnumber(state, lua_Number::frombits(bits));
    return 1;
}

int api_dset(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    const int index = integer(state, 1);
    if (index >= 0 && index < 64) {
        p8_core_poke32(vm->core, static_cast<uint16_t>(kPersistentBase + index * 4),
                      static_cast<uint32_t>(raw_number(state, 2)));
    }
    return 0;
}

int api_srand(lua_State *state)
{
    p8_vm::from(state)->seed_rng(raw_number(state, 1));
    return 0;
}

int api_rnd(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    vm->update_rng();
    const uint32_t random = p8_core_peek32(vm->core, kRngStateB);
    if (lua_istable(state, 1)) {
        const size_t count = lua_rawlen(state, 1);
        if (count == 0) {
            return 0;
        }
        const uint32_t range = static_cast<uint32_t>(count << 16);
        const unsigned index = static_cast<unsigned>((random % range) >> 16) + 1;
        lua_rawgeti(state, 1, index);
        return 1;
    }
    const int32_t range = lua_gettop(state) == 0 ? 0x10000 : raw_number(state, 1);
    lua_pushnumber(state, lua_Number::frombits(range > 0 ? random % static_cast<uint32_t>(range) : 0));
    return 1;
}

int api_cls(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    p8_draw_command command{};
    command.opcode = P8_DRAW_CLS;
    command.flags = static_cast<uint16_t>(lua_gettop(state));
    command.args[0] = raw_number(state, 1, 0);
    p8_core_emit_draw(vm->core, &command);
    return 0;
}

int api_pset(lua_State *state) { p8_vm::from(state)->emit(P8_DRAW_PSET, state, 3); return 0; }
int api_rect(lua_State *state) { p8_vm::from(state)->emit(P8_DRAW_RECT, state, 5); return 0; }
int api_rectfill(lua_State *state) { p8_vm::from(state)->emit(P8_DRAW_RECTFILL, state, 5); return 0; }

int api_spr(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    p8_draw_command command{};
    command.opcode = P8_DRAW_SPR;
    command.flags = static_cast<uint16_t>(lua_gettop(state));
    command.args[0] = raw_number(state, 1);
    command.args[1] = raw_number(state, 2);
    command.args[2] = raw_number(state, 3);
    command.args[3] = raw_number(state, 4, 0x10000);
    command.args[4] = raw_number(state, 5, 0x10000);
    command.args[5] = lua_toboolean(state, 6) ? 0x10000 : 0;
    command.args[6] = lua_toboolean(state, 7) ? 0x10000 : 0;
    p8_core_emit_draw(vm->core, &command);
    return 0;
}

int api_map(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    p8_draw_command command{};
    command.opcode = P8_DRAW_MAP;
    command.flags = static_cast<uint16_t>(lua_gettop(state));
    for (int i = 0; i < 7; ++i) {
        command.args[i] = raw_number(state, i + 1);
    }
    if (lua_gettop(state) < 5) {
        const unsigned width = p8_core_peek(vm->core, 0x5f57) == 0 ? 256 : p8_core_peek(vm->core, 0x5f57);
        command.args[4] = static_cast<int32_t>(width << 16);
        command.args[5] = static_cast<int32_t>((8192 / width) << 16);
    }
    p8_core_emit_draw(vm->core, &command);
    return 0;
}

int api_pal(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    p8_draw_command command{};
    command.opcode = P8_DRAW_PAL;
    command.flags = static_cast<uint16_t>(lua_gettop(state));
    command.args[0] = raw_number(state, 1);
    command.args[1] = raw_number(state, 2);
    command.args[2] = raw_number(state, 3);
    p8_core_emit_draw(vm->core, &command);
    return 0;
}

int api_print(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    size_t size = 0;
    const char *text = luaL_tolstring(state, 1, &size);
    p8_draw_command command{};
    command.opcode = P8_DRAW_PRINT;
    command.flags = static_cast<uint16_t>(lua_gettop(state) - 1);
    command.args[0] = raw_number(state, 2);
    command.args[1] = raw_number(state, 3);
    command.args[2] = raw_number(state, 4, 6 << 16);
    p8_core_emit_draw_payload(vm->core, &command, text, size);
    const int32_t rightmost = command.args[0] + static_cast<int32_t>(size * 4u << 16);
    lua_pop(state, 1);
    lua_pushnumber(state, lua_Number::frombits(rightmost));
    return 1;
}

int api_run(lua_State *state)
{
    p8_vm::from(state)->restart_requested = true;
    return 0;
}

void update_callback(void *userdata) { p8_vm_call(static_cast<p8_vm *>(userdata), "_update"); }
void update60_callback(void *userdata) { p8_vm_call(static_cast<p8_vm *>(userdata), "_update60"); }
void draw_callback(void *userdata) { p8_vm_draw(static_cast<p8_vm *>(userdata)); }

} // namespace

extern "C" {

p8_vm *p8_vm_create(p8_core *core)
{
    if (!core) {
        return nullptr;
    }
    p8_vm *vm = new (std::nothrow) p8_vm();
    if (!vm) {
        return nullptr;
    }
    vm->core = core;
    vm->state = luaL_newstate();
    if (!vm->state) {
        delete vm;
        return nullptr;
    }
    luaL_openlibs(vm->state);
    vm->install("mget", api_mget);
    vm->install("mset", api_mset);
    vm->install("btn", api_btn);
    vm->install("btnp", api_btnp);
    vm->install("cartdata", api_cartdata);
    vm->install("dget", api_dget);
    vm->install("dset", api_dset);
    vm->install("rnd", api_rnd);
    vm->install("srand", api_srand);
    vm->install("cls", api_cls);
    vm->install("pset", api_pset);
    vm->install("rect", api_rect);
    vm->install("rectfill", api_rectfill);
    vm->install("spr", api_spr);
    vm->install("map", api_map);
    vm->install("pal", api_pal);
    vm->install("print", api_print);
    vm->install("run", api_run);
    vm->seed_rng(0);

    if (luaL_loadbuffer(vm->state, kHostBootstrap, std::strlen(kHostBootstrap), "@p8_host_bootstrap") != LUA_OK
        || lua_pcall(vm->state, 0, 0, 0) != LUA_OK) {
        vm->set_error_from_stack();
        p8_vm_destroy(vm);
        return nullptr;
    }
    return vm;
}

void p8_vm_destroy(p8_vm *vm)
{
    if (!vm) {
        return;
    }
    if (vm->core) {
        p8_core_set_callbacks(vm->core, nullptr);
    }
    if (vm->state) {
        lua_close(vm->state);
    }
    delete vm;
}

int p8_vm_load_source(p8_vm *vm, const char *source, size_t size, const char *chunk_name)
{
    if (!vm || !source) {
        return 0;
    }
    vm->error.clear();
    const char *name = chunk_name ? chunk_name : "@cart";
    if (luaL_loadbuffer(vm->state, source, size, name) != LUA_OK
        || lua_pcall(vm->state, 0, 0, 0) != LUA_OK) {
        vm->set_error_from_stack();
        return 0;
    }
    lua_getglobal(vm->state, "_update60");
    vm->has_update60 = lua_isfunction(vm->state, -1);
    lua_pop(vm->state, 1);
    p8_core_set_update_rate(vm->core, vm->has_update60 ? 60 : 30);
    const p8_core_callbacks callbacks{update_callback, update60_callback, draw_callback, vm};
    p8_core_set_callbacks(vm->core, &callbacks);
    return 1;
}

int p8_vm_boot(p8_vm *vm, const char *source, size_t size, const char *chunk_name)
{
    return p8_vm_load_source(vm, source, size, chunk_name) && p8_vm_call(vm, "_init");
}

int p8_vm_call(p8_vm *vm, const char *function_name)
{
    if (!vm || !function_name) {
        return 0;
    }
    lua_getglobal(vm->state, function_name);
    if (!lua_isfunction(vm->state, -1)) {
        lua_pop(vm->state, 1);
        return 1;
    }
    if (lua_pcall(vm->state, 0, 0, 0) != LUA_OK) {
        vm->set_error_from_stack();
        return 0;
    }
    return 1;
}

int p8_vm_update(p8_vm *vm)
{
    if (!vm) {
        return 0;
    }
    p8_core_begin_update(vm->core);
    return p8_vm_call(vm, vm->has_update60 ? "_update60" : "_update");
}

int p8_vm_draw(p8_vm *vm)
{
    if (!vm) {
        return 0;
    }
    p8_core_begin_draw_stream(vm->core);
    return p8_vm_call(vm, "_draw");
}

const char *p8_vm_last_error(const p8_vm *vm)
{
    return vm ? vm->error.c_str() : "no vm";
}

int p8_vm_has_global(p8_vm *vm, const char *name)
{
    if (!vm || !name) {
        return 0;
    }
    lua_getglobal(vm->state, name);
    const int present = !lua_isnil(vm->state, -1);
    lua_pop(vm->state, 1);
    return present;
}

int p8_vm_get_global_raw(p8_vm *vm, const char *name, int32_t *raw_16_16)
{
    if (!vm || !name || !raw_16_16) {
        return 0;
    }
    lua_getglobal(vm->state, name);
    const int numeric = lua_isnumber(vm->state, -1);
    if (numeric) {
        *raw_16_16 = lua_tonumber(vm->state, -1).bits();
    }
    lua_pop(vm->state, 1);
    return numeric;
}

int p8_vm_get_global_boolean(p8_vm *vm, const char *name, int *value)
{
    if (!vm || !name || !value) {
        return 0;
    }
    lua_getglobal(vm->state, name);
    const int boolean = lua_isboolean(vm->state, -1);
    if (boolean) {
        *value = lua_toboolean(vm->state, -1);
    }
    lua_pop(vm->state, 1);
    return boolean;
}

int p8_vm_get_table_length(p8_vm *vm, const char *name, size_t *length)
{
    if (!vm || !name || !length) {
        return 0;
    }
    lua_getglobal(vm->state, name);
    const int table = lua_istable(vm->state, -1);
    if (table) {
        *length = lua_rawlen(vm->state, -1);
    }
    lua_pop(vm->state, 1);
    return table;
}

int p8_vm_restart_requested(const p8_vm *vm)
{
    return vm && vm->restart_requested;
}

} // extern "C"
