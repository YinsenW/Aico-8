#include "lauxlib.h"
#include "lua.h"

#include <cstdint>

extern "C" int32_t aico8_z8lua_native_probe()
{
    constexpr char source[] = "return 6*7";
    lua_State *state = luaL_newstate();
    if (state == nullptr) {
        return -1;
    }
    int status = luaL_loadbuffer(state, source, sizeof(source) - 1, "@aico8_rust_spike");
    if (status == LUA_OK) {
        status = lua_pcall(state, 0, 1, 0);
    }
    const int32_t result = status == LUA_OK
        ? static_cast<int32_t>(lua_tointeger(state, -1))
        : -2;
    lua_close(state);
    return result;
}
