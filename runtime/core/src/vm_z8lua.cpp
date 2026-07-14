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
#include <string_view>

namespace {

constexpr uint16_t kRngStateA = 0x5f44;
constexpr uint16_t kRngStateB = 0x5f48;
constexpr uint16_t kPersistentBase = 0x5e00;
constexpr uint16_t kSpriteFlagsBase = 0x3000;

struct p8_unicode_glyph {
    std::string_view unicode;
    uint8_t p8scii;
};

// PICO-8 source files represent non-ASCII P8SCII bytes with Unicode display
// glyphs. The VM itself must still receive byte strings: #, sub(), ord(), and
// string indexing are byte-oriented. Keep this source-literal boundary
// conversion separate from presentation text so Unicode never leaks into cart
// execution semantics. The values are the official P8SCII character table.
constexpr p8_unicode_glyph kP8UnicodeGlyphs[] = {
    {u8"¹", 0x01}, {u8"²", 0x02}, {u8"³", 0x03}, {u8"⁴", 0x04},
    {u8"⁵", 0x05}, {u8"⁶", 0x06}, {u8"⁷", 0x07}, {u8"⁸", 0x08},
    {u8"ᵇ", 0x0b}, {u8"ᶜ", 0x0c}, {u8"ᵉ", 0x0e}, {u8"ᶠ", 0x0f},
    {u8"▮", 0x10}, {u8"■", 0x11}, {u8"□", 0x12}, {u8"⁙", 0x13},
    {u8"⁘", 0x14}, {u8"‖", 0x15}, {u8"◀", 0x16}, {u8"▶", 0x17},
    {u8"「", 0x18}, {u8"」", 0x19}, {u8"¥", 0x1a}, {u8"•", 0x1b},
    {u8"、", 0x1c}, {u8"。", 0x1d}, {u8"゛", 0x1e}, {u8"゜", 0x1f},
    {u8"○", 0x7f}, {u8"█", 0x80}, {u8"▒", 0x81}, {u8"🐱", 0x82},
    {u8"⬇️", 0x83}, {u8"░", 0x84}, {u8"✽", 0x85}, {u8"●", 0x86},
    {u8"♥", 0x87}, {u8"☉", 0x88}, {u8"웃", 0x89}, {u8"⌂", 0x8a},
    {u8"⬅️", 0x8b}, {u8"😐", 0x8c}, {u8"♪", 0x8d},
    {u8"🅾️", 0x8e}, {u8"◆", 0x8f}, {u8"…", 0x90},
    {u8"➡️", 0x91}, {u8"★", 0x92}, {u8"⧗", 0x93},
    {u8"⬆️", 0x94}, {u8"ˇ", 0x95}, {u8"∧", 0x96},
    {u8"❎", 0x97}, {u8"▤", 0x98}, {u8"▥", 0x99},
    {u8"あ", 0x9a}, {u8"い", 0x9b}, {u8"う", 0x9c}, {u8"え", 0x9d},
    {u8"お", 0x9e}, {u8"か", 0x9f}, {u8"き", 0xa0}, {u8"く", 0xa1},
    {u8"け", 0xa2}, {u8"こ", 0xa3}, {u8"さ", 0xa4}, {u8"し", 0xa5},
    {u8"す", 0xa6}, {u8"せ", 0xa7}, {u8"そ", 0xa8}, {u8"た", 0xa9},
    {u8"ち", 0xaa}, {u8"つ", 0xab}, {u8"て", 0xac}, {u8"と", 0xad},
    {u8"な", 0xae}, {u8"に", 0xaf}, {u8"ぬ", 0xb0}, {u8"ね", 0xb1},
    {u8"の", 0xb2}, {u8"は", 0xb3}, {u8"ひ", 0xb4}, {u8"ふ", 0xb5},
    {u8"へ", 0xb6}, {u8"ほ", 0xb7}, {u8"ま", 0xb8}, {u8"み", 0xb9},
    {u8"む", 0xba}, {u8"め", 0xbb}, {u8"も", 0xbc}, {u8"や", 0xbd},
    {u8"ゆ", 0xbe}, {u8"よ", 0xbf}, {u8"ら", 0xc0}, {u8"り", 0xc1},
    {u8"る", 0xc2}, {u8"れ", 0xc3}, {u8"ろ", 0xc4}, {u8"わ", 0xc5},
    {u8"を", 0xc6}, {u8"ん", 0xc7}, {u8"っ", 0xc8}, {u8"ゃ", 0xc9},
    {u8"ゅ", 0xca}, {u8"ょ", 0xcb}, {u8"ア", 0xcc}, {u8"イ", 0xcd},
    {u8"ウ", 0xce}, {u8"エ", 0xcf}, {u8"オ", 0xd0}, {u8"カ", 0xd1},
    {u8"キ", 0xd2}, {u8"ク", 0xd3}, {u8"ケ", 0xd4}, {u8"コ", 0xd5},
    {u8"サ", 0xd6}, {u8"シ", 0xd7}, {u8"ス", 0xd8}, {u8"セ", 0xd9},
    {u8"ソ", 0xda}, {u8"タ", 0xdb}, {u8"チ", 0xdc}, {u8"ツ", 0xdd},
    {u8"テ", 0xde}, {u8"ト", 0xdf}, {u8"ナ", 0xe0}, {u8"ニ", 0xe1},
    {u8"ヌ", 0xe2}, {u8"ネ", 0xe3}, {u8"ノ", 0xe4}, {u8"ハ", 0xe5},
    {u8"ヒ", 0xe6}, {u8"フ", 0xe7}, {u8"ヘ", 0xe8}, {u8"ホ", 0xe9},
    {u8"マ", 0xea}, {u8"ミ", 0xeb}, {u8"ム", 0xec}, {u8"メ", 0xed},
    {u8"モ", 0xee}, {u8"ヤ", 0xef}, {u8"ユ", 0xf0}, {u8"ヨ", 0xf1},
    {u8"ラ", 0xf2}, {u8"リ", 0xf3}, {u8"ル", 0xf4}, {u8"レ", 0xf5},
    {u8"ロ", 0xf6}, {u8"ワ", 0xf7}, {u8"ヲ", 0xf8}, {u8"ン", 0xf9},
    {u8"ッ", 0xfa}, {u8"ャ", 0xfb}, {u8"ュ", 0xfc}, {u8"ョ", 0xfd},
    {u8"◜", 0xfe}, {u8"◝", 0xff},
    {u8"𝘢", 'A'}, {u8"𝘣", 'B'}, {u8"𝘤", 'C'},
    {u8"𝘥", 'D'}, {u8"𝘦", 'E'}, {u8"𝘧", 'F'},
    {u8"𝘨", 'G'}, {u8"𝘩", 'H'}, {u8"𝘪", 'I'},
    {u8"𝘫", 'J'}, {u8"𝘬", 'K'}, {u8"𝘭", 'L'},
    {u8"𝘮", 'M'}, {u8"𝘯", 'N'}, {u8"𝘰", 'O'},
    {u8"𝘱", 'P'}, {u8"𝘲", 'Q'}, {u8"𝘳", 'R'},
    {u8"𝘴", 'S'}, {u8"𝘵", 'T'}, {u8"𝘶", 'U'},
    {u8"𝘷", 'V'}, {u8"𝘸", 'W'}, {u8"𝘹", 'X'},
    {u8"𝘺", 'Y'}, {u8"𝘻", 'Z'},
};

bool append_p8scii_glyph(std::string_view source, size_t offset, std::string &output,
                         size_t &consumed)
{
    for (const p8_unicode_glyph &glyph : kP8UnicodeGlyphs) {
        if (source.substr(offset, glyph.unicode.size()) == glyph.unicode) {
            output.push_back(static_cast<char>(glyph.p8scii));
            consumed = glyph.unicode.size();
            return true;
        }
    }
    return false;
}

std::string normalize_p8scii_source_literals(const char *source, size_t size)
{
    enum class lexical_state { code, quoted, line_comment, long_string, long_comment };
    const std::string_view input(source, size);
    std::string output;
    output.reserve(size);
    lexical_state state = lexical_state::code;
    char quote = '\0';

    for (size_t offset = 0; offset < size;) {
        const char current = input[offset];
        if (state == lexical_state::code) {
            if (current == '\'' || current == '"') {
                quote = current;
                state = lexical_state::quoted;
            } else if (current == '-' && offset + 1 < size && input[offset + 1] == '-') {
                if (offset + 3 < size && input[offset + 2] == '[' && input[offset + 3] == '[') {
                    output.append("--[[");
                    offset += 4;
                    state = lexical_state::long_comment;
                    continue;
                }
                state = lexical_state::line_comment;
            } else if (current == '[' && offset + 1 < size && input[offset + 1] == '[') {
                output.append("[[");
                offset += 2;
                state = lexical_state::long_string;
                continue;
            }
        } else if (state == lexical_state::quoted) {
            if (current == '\\' && offset + 1 < size) {
                output.push_back(current);
                output.push_back(input[offset + 1]);
                offset += 2;
                continue;
            }
            if (current == quote) state = lexical_state::code;
        } else if (state == lexical_state::line_comment) {
            if (current == '\n' || current == '\r') state = lexical_state::code;
        } else if (state == lexical_state::long_string || state == lexical_state::long_comment) {
            if (current == ']' && offset + 1 < size && input[offset + 1] == ']') {
                output.append("]]");
                offset += 2;
                state = lexical_state::code;
                continue;
            }
        }

        if ((state == lexical_state::quoted || state == lexical_state::long_string)
            && static_cast<unsigned char>(current) >= 0x80) {
            size_t consumed = 0;
            if (append_p8scii_glyph(input, offset, output, consumed)) {
                offset += consumed;
                continue;
            }
        }
        output.push_back(current);
        ++offset;
    }
    return output;
}

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

function count(c,...)
 if c==nil then return 0 end
 if select("#",...)==0 then return #c end
 local value,n=...,0
 for i=1,#c do
  if c[i]==value then n+=1 end
 end
 return n
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
    std::string diagnostic_output;
    std::string cartdata_id;
    bool cartdata_active = false;
    bool has_update60 = false;
    bool restart_requested = false;
    bool faulted = false;
    bool frame_held = false;
    lua_State *active_thread = nullptr;
    int active_thread_ref = LUA_NOREF;
    std::string active_function;
    bool suppress_draw_once = false;
    std::array<p8_menu_item, 5> menu_items{};
    unsigned active_menu_item = 0;
    bool line_cursor_ready = false;
    int line_cursor_x = 0;
    int line_cursor_y = 0;
    int32_t line_cursor_x_raw = 0;
    int32_t line_cursor_y_raw = 0;
    int32_t draw_color_raw = 6 << 16;

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
            faulted = true;
            clear_active_thread();
            return 0;
        }
        lua_settop(active_thread, 0);
        clear_active_thread();
        return 1;
    }

    int start_resumable_call(const char *function_name)
    {
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

    void emit_with_resolved_argument(uint16_t opcode, lua_State *source,
                                     unsigned argument_count, unsigned argument_index,
                                     int32_t resolved_value)
    {
        p8_draw_command command{};
        command.opcode = opcode;
        command.flags = static_cast<uint16_t>(lua_gettop(source));
        const unsigned count = std::min<unsigned>(argument_count, 12);
        for (unsigned i = 0; i < count; ++i) {
            command.args[i] = raw_number(source, static_cast<int>(i + 1));
        }
        if (argument_index < count
            && lua_isnoneornil(source, static_cast<int>(argument_index + 1))) {
            command.args[argument_index] = resolved_value;
        }
        p8_core_emit_draw(core, &command);
    }
};

namespace {

int api_peek(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    const uint16_t address = static_cast<uint16_t>(integer(state, 1));
    const int count = integer(state, 2, 1);
    if (count < 0 || count > 8192) {
        return luaL_error(state, "peek result count must be between 0 and 8192");
    }
    luaL_checkstack(state, count, "too many peek results");
    for (int offset = 0; offset < count; ++offset) {
        lua_pushnumber(state, p8_core_peek(vm->core,
                                          static_cast<uint16_t>(address + offset)));
    }
    return count;
}

int api_poke(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    const uint16_t address = static_cast<uint16_t>(integer(state, 1));
    const int count = lua_gettop(state) - 1;
    if (count > 8192) {
        return luaL_error(state, "poke value count must not exceed 8192");
    }
    for (int offset = 0; offset < count; ++offset) {
        p8_core_poke(vm->core, static_cast<uint16_t>(address + offset),
                     static_cast<uint8_t>(integer(state, offset + 2)));
    }
    return 0;
}

int api_peek2(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    lua_pushnumber(state, p8_core_peek16(vm->core,
                                        static_cast<uint16_t>(integer(state, 1))));
    return 1;
}

int api_poke2(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    p8_core_poke16(vm->core, static_cast<uint16_t>(integer(state, 1)),
                   static_cast<uint16_t>(integer(state, 2)));
    return 0;
}

int api_peek4(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    lua_pushnumber(state, lua_Number::frombits(
        p8_core_peek32(vm->core, static_cast<uint16_t>(integer(state, 1)))));
    return 1;
}

int api_poke4(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    p8_core_poke32(vm->core, static_cast<uint16_t>(integer(state, 1)),
                   static_cast<uint32_t>(raw_number(state, 2)));
    return 0;
}

int api_memcpy(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    const int length = integer(state, 3);
    if (length > 0) {
        p8_core_memcpy(vm->core, static_cast<uint16_t>(integer(state, 1)),
                       static_cast<uint16_t>(integer(state, 2)),
                       static_cast<size_t>(length));
    }
    return 0;
}

int api_memset(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    const int length = integer(state, 3);
    if (length > 0) {
        p8_core_memset(vm->core, static_cast<uint16_t>(integer(state, 1)),
                       static_cast<uint8_t>(integer(state, 2)),
                       static_cast<size_t>(length));
    }
    return 0;
}

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
    vm->emit_with_resolved_argument(P8_DRAW_PSET, state, 3, 2, vm->draw_color_raw);
    p8_gfx_pset(vm->core, integer(state, 1), integer(state, 2),
                static_cast<uint8_t>(integer(state, 3, vm->draw_color_raw >> 16)));
    return 0;
}

int api_pget(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    lua_pushnumber(state, p8_gfx_pget(vm->core, integer(state, 1), integer(state, 2)));
    return 1;
}

int api_sget(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    lua_pushnumber(state, p8_gfx_sget(vm->core, integer(state, 1), integer(state, 2)));
    return 1;
}

int api_sset(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    p8_gfx_sset(vm->core, integer(state, 1), integer(state, 2),
                static_cast<uint8_t>(integer(state, 3, vm->draw_color_raw >> 16)));
    return 0;
}

int api_color(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    vm->draw_color_raw = raw_number(state, 1, 6 << 16);
    return 0;
}

int api_line(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    const int argument_count = lua_gettop(state);
    p8_draw_command command{};
    command.opcode = P8_DRAW_LINE;
    command.flags = static_cast<uint16_t>(argument_count);
    if (argument_count == 0) {
        vm->line_cursor_ready = false;
        p8_core_emit_draw(vm->core, &command);
        return 0;
    }

    int x0 = integer(state, 1);
    int y0 = integer(state, 2);
    int x1 = x0;
    int y1 = y0;
    int32_t x0_raw = raw_number(state, 1);
    int32_t y0_raw = raw_number(state, 2);
    int32_t x1_raw = x0_raw;
    int32_t y1_raw = y0_raw;
    int32_t color_raw = vm->draw_color_raw;
    uint8_t color = static_cast<uint8_t>(color_raw >> 16);
    bool should_draw = true;
    if (argument_count >= 4) {
        x1 = integer(state, 3);
        y1 = integer(state, 4);
        x1_raw = raw_number(state, 3);
        y1_raw = raw_number(state, 4);
        color_raw = raw_number(state, 5, vm->draw_color_raw);
        color = static_cast<uint8_t>(color_raw >> 16);
    } else {
        x1 = x0;
        y1 = y0;
        color_raw = raw_number(state, 3, vm->draw_color_raw);
        color = static_cast<uint8_t>(color_raw >> 16);
        should_draw = vm->line_cursor_ready;
        if (should_draw) {
            x0 = vm->line_cursor_x;
            y0 = vm->line_cursor_y;
            x0_raw = vm->line_cursor_x_raw;
            y0_raw = vm->line_cursor_y_raw;
        }
    }
    command.args[0] = x0_raw;
    command.args[1] = y0_raw;
    command.args[2] = x1_raw;
    command.args[3] = y1_raw;
    command.args[4] = color_raw;
    p8_core_emit_draw(vm->core, &command);
    if (should_draw) {
        p8_gfx_line(vm->core, x0, y0, x1, y1, color);
    }
    vm->line_cursor_x = x1;
    vm->line_cursor_y = y1;
    vm->line_cursor_x_raw = x1_raw;
    vm->line_cursor_y_raw = y1_raw;
    vm->line_cursor_ready = true;
    return 0;
}

int api_rect(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    vm->emit_with_resolved_argument(P8_DRAW_RECT, state, 5, 4, vm->draw_color_raw);
    p8_gfx_rect(vm->core, integer(state, 1), integer(state, 2), integer(state, 3),
                integer(state, 4),
                static_cast<uint8_t>(integer(state, 5, vm->draw_color_raw >> 16)));
    return 0;
}

int api_rectfill(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    vm->emit_with_resolved_argument(P8_DRAW_RECTFILL, state, 5, 4, vm->draw_color_raw);
    p8_gfx_rectfill(vm->core, integer(state, 1), integer(state, 2), integer(state, 3),
                    integer(state, 4),
                    static_cast<uint8_t>(integer(state, 5, vm->draw_color_raw >> 16)));
    return 0;
}

int api_circ(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    vm->emit_with_resolved_argument(P8_DRAW_CIRC, state, 4, 3, vm->draw_color_raw);
    p8_gfx_circ(vm->core, integer(state, 1), integer(state, 2), integer(state, 3, 4),
                static_cast<uint8_t>(integer(state, 4, vm->draw_color_raw >> 16)));
    return 0;
}

int api_circfill(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    vm->emit_with_resolved_argument(P8_DRAW_CIRCFILL, state, 4, 3, vm->draw_color_raw);
    p8_gfx_circfill(vm->core, integer(state, 1), integer(state, 2), integer(state, 3, 4),
                    static_cast<uint8_t>(integer(state, 4, vm->draw_color_raw >> 16)));
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

int api_sspr(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    p8_draw_command command{};
    command.opcode = P8_DRAW_SSPR;
    command.flags = static_cast<uint16_t>(lua_gettop(state));
    for (int index = 0; index < 6; ++index) {
        command.args[index] = raw_number(state, index + 1);
    }
    command.args[6] = raw_number(state, 7, command.args[2]);
    command.args[7] = raw_number(state, 8, command.args[3]);
    command.args[8] = lua_toboolean(state, 9) ? 0x10000 : 0;
    command.args[9] = lua_toboolean(state, 10) ? 0x10000 : 0;
    p8_core_emit_draw(vm->core, &command);
    p8_gfx_sspr(vm->core, integer(state, 1), integer(state, 2), integer(state, 3),
                integer(state, 4), integer(state, 5), integer(state, 6),
                integer(state, 7, integer(state, 3)),
                integer(state, 8, integer(state, 4)),
                lua_toboolean(state, 9), lua_toboolean(state, 10));
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

int api_palt(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    p8_draw_command command{};
    command.opcode = P8_DRAW_PALT;
    command.flags = static_cast<uint16_t>(lua_gettop(state));
    command.args[0] = raw_number(state, 1);
    command.args[1] = lua_isnoneornil(state, 2) || lua_toboolean(state, 2) ? 0x10000 : 0;
    p8_core_emit_draw(vm->core, &command);
    if (lua_gettop(state) == 0) {
        p8_gfx_palt_reset(vm->core);
    } else if (lua_gettop(state) == 1) {
        const uint16_t mask = static_cast<uint16_t>(integer(state, 1));
        for (uint8_t color = 0; color < 16; ++color) {
            p8_gfx_palt(vm->core, color, (mask & (1u << (15u - color))) != 0);
        }
    } else {
        p8_gfx_palt(vm->core, static_cast<uint8_t>(integer(state, 1)),
                    lua_toboolean(state, 2));
    }
    return 0;
}

int api_camera(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    p8_draw_command command{};
    command.opcode = P8_DRAW_CAMERA;
    command.flags = static_cast<uint16_t>(lua_gettop(state));
    command.args[0] = raw_number(state, 1);
    command.args[1] = raw_number(state, 2);
    p8_core_emit_draw(vm->core, &command);
    if (lua_gettop(state) == 0) {
        p8_gfx_camera_reset(vm->core);
    } else {
        p8_gfx_camera(vm->core, integer(state, 1), integer(state, 2));
    }
    return 0;
}

int api_clip(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    p8_draw_command command{};
    command.opcode = P8_DRAW_CLIP;
    command.flags = static_cast<uint16_t>(lua_gettop(state));
    if (lua_gettop(state) == 0) {
        p8_core_emit_draw(vm->core, &command);
        p8_gfx_clip_reset(vm->core);
        return 0;
    }
    command.args[0] = raw_number(state, 1);
    command.args[1] = raw_number(state, 2);
    command.args[2] = raw_number(state, 3);
    command.args[3] = raw_number(state, 4);
    command.args[4] = lua_toboolean(state, 5) ? 0x10000 : 0;
    p8_core_emit_draw(vm->core, &command);
    p8_gfx_clip(vm->core, integer(state, 1), integer(state, 2), integer(state, 3),
                integer(state, 4), lua_toboolean(state, 5));
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
    const int argument_count = lua_gettop(state);
    const int optional_argument_count = argument_count - 1;
    size_t size = 0;
    const char *text = luaL_tolstring(state, 1, &size);
    p8_draw_command command{};
    command.opcode = P8_DRAW_PRINT;
    command.flags = static_cast<uint16_t>(argument_count);
    if (optional_argument_count == 1) {
        vm->draw_color_raw = raw_number(state, 2);
    } else {
        command.args[0] = raw_number(state, 2);
        command.args[1] = raw_number(state, 3);
        if (optional_argument_count >= 3) {
            vm->draw_color_raw = raw_number(state, 4);
        }
    }
    command.args[2] = vm->draw_color_raw;
    p8_core_emit_draw_payload(vm->core, &command, text, size);
    const int32_t rightmost = command.args[0] + static_cast<int32_t>(size * 4u << 16);
    lua_pop(state, 1);
    lua_pushnumber(state, lua_Number::frombits(rightmost));
    return 1;
}

int api_printh(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    if (lua_gettop(state) >= 2 && !lua_isnil(state, 2)) {
        return luaL_error(state,
                          "printh file output is disabled by the Aico 8 host policy");
    }
    size_t size = 0;
    const char *text = luaL_tolstring(state, 1, &size);
    if (text) {
        vm->diagnostic_output.append(text, size);
        vm->diagnostic_output.push_back('\n');
    }
    return 0;
}

int api_time(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    const uint64_t updates = p8_core_get_update_count(vm->core);
    const unsigned rate = p8_core_get_update_rate(vm->core);
    const uint64_t raw = rate == 0 ? 0 : (updates * 0x10000ull) / rate;
    lua_pushnumber(state, lua_Number::frombits(static_cast<int32_t>(raw)));
    return 1;
}

int api_stat(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    const int selector = integer(state, 1);
    switch (selector) {
    case 0: // Host-independent memory diagnostic; exact CPU accounting is not modelled.
    case 1:
        lua_pushnumber(state, 0);
        return 1;
    case 4: // Clipboard is unavailable until an explicit host paste capability exists.
    case 31: // No queued keyboard character in the controller-only host profile.
        lua_pushnil(state);
        return 1;
    case 6:
        lua_pushliteral(state, "");
        return 1;
    case 7:
    case 8: // Current and target logical frame rates.
        lua_pushnumber(state, static_cast<int32_t>(p8_core_get_update_rate(vm->core)));
        return 1;
    case 30:
    case 110:
        lua_pushboolean(state, 0);
        return 1;
    case 32:
    case 33:
    case 34:
    case 36:
    case 38:
    case 39:
        if (vm->diagnostic_output.find("stat(30..39): extended input unavailable")
            == std::string::npos) {
            vm->diagnostic_output.append(
                "stat(30..39): extended input unavailable; returning neutral state\n");
        }
        lua_pushnumber(state, 0);
        return 1;
    case 46:
    case 47:
    case 48:
    case 49:
    case 50:
    case 51:
    case 52:
    case 53:
    case 54:
    case 55:
    case 56:
    case 57: {
        int32_t value = 0;
        if (!p8_audio_stat(vm->core, static_cast<unsigned>(selector), &value)) {
            return luaL_error(state,
                              "stat audio selector %d is not conformance-qualified",
                              selector);
        }
        if (selector == 57) lua_pushboolean(state, value != 0);
        else lua_pushnumber(state, value);
        return 1;
    }
    default:
        return luaL_error(state, "stat selector %d is not conformance-qualified", selector);
    }
}

int api_extcmd(lua_State *state)
{
    p8_vm *vm = p8_vm::from(state);
    size_t size = 0;
    const char *command = luaL_checklstring(state, 1, &size);
    const std::string name(command, size);
    if (name == "rec" || name == "rec_frames") {
        const std::string message = "extcmd(" + name
            + "): recording is unavailable in this host; gameplay continued";
        if (vm->diagnostic_output.find(message) == std::string::npos) {
            vm->diagnostic_output.append(message);
            vm->diagnostic_output.push_back('\n');
        }
        return 0;
    }
    return luaL_error(state, "extcmd(%s) is unsupported by this host", name.c_str());
}

int api_run(lua_State *state)
{
    p8_vm::from(state)->restart_requested = true;
    return 0;
}

int api_flip(lua_State *state)
{
    p8_vm::from(state)->frame_held = false;
    return lua_yield(state, 0);
}

int api_holdframe(lua_State *state)
{
    p8_vm::from(state)->frame_held = true;
    return 0;
}

int run_update_step(p8_vm *vm)
{
    if (vm->faulted) return 0;
    if (vm->active_thread) {
        p8_core_begin_draw_stream(vm->core);
        vm->suppress_draw_once = true;
        return vm->resume_active_thread();
    }
    return vm->start_resumable_call(vm->has_update60 ? "_update60" : "_update");
}

void update_callback(void *userdata)
{
    p8_vm *vm = static_cast<p8_vm *>(userdata);
    if (!run_update_step(vm)) vm->faulted = true;
}

void update60_callback(void *userdata) { update_callback(userdata); }

void draw_callback(void *userdata)
{
    p8_vm *vm = static_cast<p8_vm *>(userdata);
    if (!vm->faulted && !p8_vm_draw(vm)) vm->faulted = true;
    if (!vm->faulted) vm->frame_held = false; // automatic end-of-frame presentation
}

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
    lua_getglobal(vm->state, "table");
    lua_getfield(vm->state, -1, "unpack");
    lua_setglobal(vm->state, "unpack");
    lua_pop(vm->state, 1);
    vm->install("peek", api_peek);
    vm->install("poke", api_poke);
    vm->install("peek2", api_peek2);
    vm->install("poke2", api_poke2);
    vm->install("peek4", api_peek4);
    vm->install("poke4", api_poke4);
    vm->install("memcpy", api_memcpy);
    vm->install("memset", api_memset);
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
    vm->install("pget", api_pget);
    vm->install("sget", api_sget);
    vm->install("sset", api_sset);
    vm->install("color", api_color);
    vm->install("line", api_line);
    vm->install("rect", api_rect);
    vm->install("rectfill", api_rectfill);
    vm->install("circ", api_circ);
    vm->install("circfill", api_circfill);
    vm->install("spr", api_spr);
    vm->install("sspr", api_sspr);
    vm->install("map", api_map);
    vm->install("pal", api_pal);
    vm->install("palt", api_palt);
    vm->install("camera", api_camera);
    vm->install("clip", api_clip);
    vm->install("fillp", api_fillp);
    vm->install("print", api_print);
    vm->install("printh", api_printh);
    vm->install("time", api_time);
    vm->install("t", api_time);
    vm->install("stat", api_stat);
    vm->install("extcmd", api_extcmd);
    vm->install("holdframe", api_holdframe);
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
    vm->faulted = false;
    vm->clear_menu_items();
    vm->draw_color_raw = 6 << 16;
    vm->line_cursor_ready = false;
    const char *name = chunk_name ? chunk_name : "@cart";
    const std::string normalized_source = normalize_p8scii_source_literals(source, size);
    if (luaL_loadbuffer(vm->state, normalized_source.data(), normalized_source.size(), name) != LUA_OK
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
    vm->error.clear();
    vm->faulted = false;
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
    if (!vm || vm->faulted) {
        return 0;
    }
    if (vm->active_thread || vm->suppress_draw_once) {
        vm->suppress_draw_once = false;
        return 1;
    }
    p8_core_begin_draw_stream(vm->core);
    return vm->start_resumable_call("_draw");
}

int p8_vm_call_pending(const p8_vm *vm)
{
    return vm && vm->active_thread ? 1 : 0;
}

const char *p8_vm_active_function(const p8_vm *vm)
{
    return vm && vm->active_thread ? vm->active_function.c_str() : "";
}

int p8_vm_frame_held(const p8_vm *vm)
{
    return vm && vm->frame_held ? 1 : 0;
}

const char *p8_vm_last_error(const p8_vm *vm)
{
    return vm ? vm->error.c_str() : "no vm";
}

const char *p8_vm_diagnostic_output(const p8_vm *vm)
{
    return vm ? vm->diagnostic_output.c_str() : "";
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

int p8_vm_get_table_field_raw(p8_vm *vm, const char *name, const char *field,
                              int32_t *raw_16_16)
{
    if (!vm || !name || !field || !raw_16_16) return 0;
    lua_getglobal(vm->state, name);
    if (!lua_istable(vm->state, -1)) {
        lua_pop(vm->state, 1);
        return 0;
    }
    lua_getfield(vm->state, -1, field);
    const int numeric = lua_isnumber(vm->state, -1);
    if (numeric) *raw_16_16 = lua_tonumber(vm->state, -1).bits();
    lua_pop(vm->state, 2);
    return numeric;
}

int p8_vm_get_table_field_boolean(p8_vm *vm, const char *name,
                                  const char *field, int *value)
{
    if (!vm || !name || !field || !value) return 0;
    lua_getglobal(vm->state, name);
    if (!lua_istable(vm->state, -1)) {
        lua_pop(vm->state, 1);
        return 0;
    }
    lua_getfield(vm->state, -1, field);
    const int boolean = lua_isboolean(vm->state, -1);
    if (boolean) *value = lua_toboolean(vm->state, -1);
    lua_pop(vm->state, 2);
    return boolean;
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
