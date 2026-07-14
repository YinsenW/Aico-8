#include "p8/vm.h"
#include "p8/audio.h"
#include "p8/raster.h"

#include "lauxlib.h"
#include "lua.h"
#include "lualib.h"

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <new>
#include <string>

namespace {

constexpr uint16_t kRngStateA = 0x5f44;
constexpr uint16_t kRngStateB = 0x5f48;
constexpr uint16_t kPersistentBase = 0x5e00;
constexpr uint16_t kSpriteFlagsBase = 0x3000;

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

⬅️=0
➡️=1
⬆️=2
⬇️=3
🅾️=4
❎=5
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

struct p8_menu_item {
    std::string label;
    int callback_ref = LUA_NOREF;
    uint8_t filter = 0;
};

struct p8_vm {
    p8_core *core = nullptr;
    lua_State *state = nullptr;
    std::string error;
    std::string cartdata_id;
    bool cartdata_active = false;
    bool has_update60 = false;
    bool restart_requested = false;
    lua_State *active_thread = nullptr;
    int active_thread_ref = LUA_NOREF;
    std::string active_function;
    bool suppress_draw_once = false;
    std::array<p8_menu_item, 5> menu_items{};
    unsigned active_menu_item = 0;

    static p8_vm *from(lua_State *state)
    {
        return static_cast<p8_vm *>(lua_touserdata(state, lua_upvalueindex(1)));
    }

    void set_error_from_stack(lua_State *source = nullptr)
    {
        lua_State *error_state = source ? source : state;
        const char *message = lua_tostring(error_state, -1);
        error = message ? message : "unknown z8lua error";
        lua_pop(error_state, 1);
    }

    void clear_active_thread()
    {
        if (active_thread_ref != LUA_NOREF) {
            luaL_unref(state, LUA_REGISTRYINDEX, active_thread_ref);
        }
        active_thread = nullptr;
        active_thread_ref = LUA_NOREF;
        active_function.clear();
    }

    void clear_menu_item(unsigned index)
    {
        if (index < 1 || index > menu_items.size()) return;
        p8_menu_item &item = menu_items[index - 1];
        if (item.callback_ref != LUA_NOREF) {
            luaL_unref(state, LUA_REGISTRYINDEX, item.callback_ref);
        }
        item = {};
    }

    void clear_menu_items()
    {
        for (unsigned index = 1; index <= menu_items.size(); ++index) {
            clear_menu_item(index);
        }
        active_menu_item = 0;
    }

    int resume_active_thread()
    {
        const int status = lua_resume(active_thread, state, 0);
        if (status == LUA_YIELD) {
            lua_settop(active_thread, 0);
            return 1;
        }
        if (status != LUA_OK) {
            set_error_from_stack(active_thread);
            clear_active_thread();
            return 0;
        }
        lua_settop(active_thread, 0);
        clear_active_thread();
        return 1;
    }

    int start_resumable_call(const char *function_name)
    {
        error.clear();
        lua_getglobal(state, function_name);
        if (!lua_isfunction(state, -1)) {
            lua_pop(state, 1);
            return 1;
        }
        active_thread = lua_newthread(state);
        active_thread_ref = luaL_ref(state, LUA_REGISTRYINDEX);
        lua_xmove(state, active_thread, 1);
        active_function = function_name;
        return resume_active_thread();
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

int api_fget(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    const int sprite = integer(state, 1);
    const uint8_t flags = sprite >= 0 && sprite < 256
        ? p8_core_peek(vm->core, static_cast<uint16_t>(kSpriteFlagsBase + sprite))
        : 0;
    if (lua_gettop(state) < 2) {
        lua_pushnumber(state, flags);
    } else {
        const int flag = integer(state, 2);
        lua_pushboolean(state, flag >= 0 && flag < 8 && (flags & (1u << flag)) != 0);
    }
    return 1;
}

int api_fset(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    const int sprite = integer(state, 1);
    if (sprite < 0 || sprite >= 256) {
        return 0;
    }
    const uint16_t address = static_cast<uint16_t>(kSpriteFlagsBase + sprite);
    if (lua_gettop(state) < 3) {
        p8_core_poke(vm->core, address, static_cast<uint8_t>(integer(state, 2)));
        return 0;
    }
    const int flag = integer(state, 2);
    if (flag >= 0 && flag < 8) {
        uint8_t flags = p8_core_peek(vm->core, address);
        const uint8_t mask = static_cast<uint8_t>(1u << flag);
        flags = lua_toboolean(state, 3) ? static_cast<uint8_t>(flags | mask)
                                        : static_cast<uint8_t>(flags & ~mask);
        p8_core_poke(vm->core, address, flags);
    }
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

int api_sfx(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    const int channel = p8_audio_sfx(vm->core, integer(state, 1), integer(state, 2, -1),
                                     integer(state, 3), integer(state, 4));
    if (p8_audio_last_error(vm->core)[0] != '\0') {
        return luaL_error(state, "%s", p8_audio_last_error(vm->core));
    }
    lua_pushnumber(state, channel);
    return 1;
}

int api_music(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    if (!p8_audio_music(vm->core, integer(state, 1), integer(state, 2),
                        static_cast<uint8_t>(integer(state, 3, 0x0f)))) {
        return luaL_error(state, "%s", p8_audio_last_error(vm->core));
    }
    return 0;
}

int api_menuitem(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    const int raw_index = lua_isnoneornil(state, 1)
        ? static_cast<int>(vm->active_menu_item) : integer(state, 1);
    const unsigned index = static_cast<unsigned>(raw_index) & 0xffu;
    if (index < 1 || index > vm->menu_items.size()) {
        return luaL_error(state, "menuitem index must be from 1 through 5");
    }
    if (lua_type(state, 2) != LUA_TSTRING || !lua_isfunction(state, 3)) {
        vm->clear_menu_item(index);
        return 0;
    }
    size_t label_size = 0;
    const char *label = lua_tolstring(state, 2, &label_size);
    vm->clear_menu_item(index);
    p8_menu_item &item = vm->menu_items[index - 1];
    item.label.assign(label, std::min<size_t>(label_size, 16));
    item.filter = static_cast<uint8_t>((static_cast<unsigned>(raw_index) >> 8) & 0xffu);
    lua_pushvalue(state, 3);
    item.callback_ref = luaL_ref(state, LUA_REGISTRYINDEX);
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
    p8_gfx_cls(vm->core, static_cast<uint8_t>(integer(state, 1, 0)));
    return 0;
}

int api_pset(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    vm->emit(P8_DRAW_PSET, state, 3);
    p8_gfx_pset(vm->core, integer(state, 1), integer(state, 2),
                static_cast<uint8_t>(integer(state, 3, 6)));
    return 0;
}

int api_rect(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    vm->emit(P8_DRAW_RECT, state, 5);
    p8_gfx_rect(vm->core, integer(state, 1), integer(state, 2), integer(state, 3),
                integer(state, 4), static_cast<uint8_t>(integer(state, 5, 6)));
    return 0;
}

int api_rectfill(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    vm->emit(P8_DRAW_RECTFILL, state, 5);
    p8_gfx_rectfill(vm->core, integer(state, 1), integer(state, 2), integer(state, 3),
                    integer(state, 4), static_cast<uint8_t>(integer(state, 5, 6)));
    return 0;
}

int api_circ(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    vm->emit(P8_DRAW_CIRC, state, 4);
    p8_gfx_circ(vm->core, integer(state, 1), integer(state, 2), integer(state, 3, 4),
                static_cast<uint8_t>(integer(state, 4, 6)));
    return 0;
}

int api_circfill(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    vm->emit(P8_DRAW_CIRCFILL, state, 4);
    p8_gfx_circfill(vm->core, integer(state, 1), integer(state, 2), integer(state, 3, 4),
                    static_cast<uint8_t>(integer(state, 4, 6)));
    return 0;
}

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
    p8_gfx_spr(vm->core, integer(state, 1), integer(state, 2), integer(state, 3),
               integer(state, 4, 1), integer(state, 5, 1), lua_toboolean(state, 6),
               lua_toboolean(state, 7));
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
    p8_gfx_map(vm->core, integer(state, 1), integer(state, 2), integer(state, 3),
               integer(state, 4), command.args[4] >> 16, command.args[5] >> 16,
               static_cast<uint8_t>(integer(state, 7)));
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
    if (lua_gettop(state) == 0) {
        p8_gfx_pal_reset(vm->core);
    } else if (lua_gettop(state) >= 2 && integer(state, 3, 0) == 0) {
        p8_gfx_pal(vm->core, static_cast<uint8_t>(integer(state, 1)),
                   static_cast<uint8_t>(integer(state, 2)));
    }
    return 0;
}

int api_fillp(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    p8_draw_command command{};
    command.opcode = P8_DRAW_FILLP;
    command.flags = static_cast<uint16_t>(lua_gettop(state));
    command.args[0] = raw_number(state, 1);
    p8_core_emit_draw(vm->core, &command);
    lua_pushnumber(state, lua_Number::frombits(p8_gfx_fillp(vm->core, command.args[0])));
    return 1;
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

int api_flip(lua_State *state)
{
    return lua_yield(state, 0);
}

int run_update_step(p8_vm *vm)
{
    if (vm->active_thread) {
        p8_core_begin_draw_stream(vm->core);
        vm->suppress_draw_once = true;
        return vm->resume_active_thread();
    }
    return p8_vm_call(vm, vm->has_update60 ? "_update60" : "_update");
}

void update_callback(void *userdata) { run_update_step(static_cast<p8_vm *>(userdata)); }
void update60_callback(void *userdata) { run_update_step(static_cast<p8_vm *>(userdata)); }
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
    vm->install("fget", api_fget);
    vm->install("fset", api_fset);
    vm->install("btn", api_btn);
    vm->install("btnp", api_btnp);
    vm->install("cartdata", api_cartdata);
    vm->install("dget", api_dget);
    vm->install("dset", api_dset);
    vm->install("rnd", api_rnd);
    vm->install("srand", api_srand);
    vm->install("sfx", api_sfx);
    vm->install("music", api_music);
    vm->install("menuitem", api_menuitem);
    vm->install("cls", api_cls);
    vm->install("pset", api_pset);
    vm->install("rect", api_rect);
    vm->install("rectfill", api_rectfill);
    vm->install("circ", api_circ);
    vm->install("circfill", api_circfill);
    vm->install("spr", api_spr);
    vm->install("map", api_map);
    vm->install("pal", api_pal);
    vm->install("fillp", api_fillp);
    vm->install("print", api_print);
    vm->install("flip", api_flip);
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
        vm->clear_active_thread();
        vm->clear_menu_items();
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
    vm->clear_menu_items();
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
    if (vm->active_thread) {
        vm->error = "cannot start " + std::string(function_name) + " while "
            + vm->active_function + " is suspended at flip()";
        return 0;
    }
    return vm->start_resumable_call(function_name);
}

int p8_vm_update(p8_vm *vm)
{
    if (!vm) {
        return 0;
    }
    p8_core_begin_update(vm->core);
    return run_update_step(vm);
}

int p8_vm_draw(p8_vm *vm)
{
    if (!vm) {
        return 0;
    }
    if (vm->active_thread || vm->suppress_draw_once) {
        vm->suppress_draw_once = false;
        return 1;
    }
    p8_core_begin_draw_stream(vm->core);
    return p8_vm_call(vm, "_draw");
}

int p8_vm_call_pending(const p8_vm *vm)
{
    return vm && vm->active_thread ? 1 : 0;
}

const char *p8_vm_active_function(const p8_vm *vm)
{
    return vm && vm->active_thread ? vm->active_function.c_str() : "";
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

size_t p8_vm_copy_global_string(p8_vm *vm, const char *name, char *destination,
                                size_t capacity)
{
    if (!vm || !name || !destination || capacity == 0) return 0;
    lua_getglobal(vm->state, name);
    size_t size = 0;
    const char *value = lua_type(vm->state, -1) == LUA_TSTRING
        ? lua_tolstring(vm->state, -1, &size) : nullptr;
    if (!value || size + 1 > capacity) {
        lua_pop(vm->state, 1);
        return 0;
    }
    std::memcpy(destination, value, size);
    destination[size] = '\0';
    lua_pop(vm->state, 1);
    return size;
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

int p8_vm_get_table_value_raw(p8_vm *vm, const char *name,
                              size_t one_based_index, int32_t *raw_16_16)
{
    if (!vm || !name || !raw_16_16 || one_based_index == 0) return 0;
    lua_getglobal(vm->state, name);
    if (!lua_istable(vm->state, -1)) {
        lua_pop(vm->state, 1);
        return 0;
    }
    lua_rawgeti(vm->state, -1, static_cast<lua_Integer>(one_based_index));
    const int numeric = lua_isnumber(vm->state, -1);
    if (numeric) *raw_16_16 = lua_tonumber(vm->state, -1).bits();
    lua_pop(vm->state, 2);
    return numeric;
}

int p8_vm_get_table_entry_raw(p8_vm *vm, const char *name, size_t one_based_index,
                              const char *field, int32_t *raw_16_16)
{
    if (!vm || !name || !field || !raw_16_16 || one_based_index == 0) return 0;
    lua_getglobal(vm->state, name);
    if (!lua_istable(vm->state, -1)) {
        lua_pop(vm->state, 1);
        return 0;
    }
    lua_rawgeti(vm->state, -1, static_cast<lua_Integer>(one_based_index));
    if (!lua_istable(vm->state, -1)) {
        lua_pop(vm->state, 2);
        return 0;
    }
    lua_getfield(vm->state, -1, field);
    const int numeric = lua_isnumber(vm->state, -1);
    if (numeric) *raw_16_16 = lua_tonumber(vm->state, -1).bits();
    lua_pop(vm->state, 3);
    return numeric;
}

int p8_vm_get_table_entry_boolean(p8_vm *vm, const char *name,
                                  size_t one_based_index, const char *field,
                                  int *value)
{
    if (!vm || !name || !field || !value || one_based_index == 0) return 0;
    lua_getglobal(vm->state, name);
    if (!lua_istable(vm->state, -1)) {
        lua_pop(vm->state, 1);
        return 0;
    }
    lua_rawgeti(vm->state, -1, static_cast<lua_Integer>(one_based_index));
    if (!lua_istable(vm->state, -1)) {
        lua_pop(vm->state, 2);
        return 0;
    }
    lua_getfield(vm->state, -1, field);
    const int boolean = lua_isboolean(vm->state, -1);
    if (boolean) *value = lua_toboolean(vm->state, -1);
    lua_pop(vm->state, 3);
    return boolean;
}

const char *p8_vm_menu_item_label(const p8_vm *vm, unsigned index)
{
    if (!vm || index < 1 || index > vm->menu_items.size()) return "";
    return vm->menu_items[index - 1].callback_ref == LUA_NOREF
        ? "" : vm->menu_items[index - 1].label.c_str();
}

uint8_t p8_vm_menu_item_filter(const p8_vm *vm, unsigned index)
{
    if (!vm || index < 1 || index > vm->menu_items.size()) return 0;
    return vm->menu_items[index - 1].callback_ref == LUA_NOREF
        ? 0 : vm->menu_items[index - 1].filter;
}

int p8_vm_invoke_menu_item(p8_vm *vm, unsigned index, uint8_t buttons,
                           int *keep_open)
{
    if (!vm || !keep_open || index < 1 || index > vm->menu_items.size()) return 0;
    if (vm->active_thread) {
        vm->error = "cannot invoke a menu item while a cart callback is suspended at flip()";
        return 0;
    }
    const p8_menu_item &item = vm->menu_items[index - 1];
    if (item.callback_ref == LUA_NOREF) return 0;
    vm->error.clear();
    lua_rawgeti(vm->state, LUA_REGISTRYINDEX, item.callback_ref);
    lua_pushnumber(vm->state, buttons & static_cast<uint8_t>(~item.filter));
    vm->active_menu_item = index;
    const int status = lua_pcall(vm->state, 1, 1, 0);
    vm->active_menu_item = 0;
    if (status != LUA_OK) {
        vm->set_error_from_stack();
        return 0;
    }
    *keep_open = lua_toboolean(vm->state, -1);
    lua_pop(vm->state, 1);
    return 1;
}

int p8_vm_restart_requested(const p8_vm *vm)
{
    return vm && vm->restart_requested;
}

} // extern "C"
