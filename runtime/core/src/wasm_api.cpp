#include "p8/wasm.h"

#include "p8/raster.h"
#include "p8/vm.h"

#include <algorithm>
#include <array>
#include <new>

namespace {

constexpr uint16_t kPersistentBase = 0x5e00;
constexpr size_t kPersistentSize = 64 * sizeof(uint32_t);

} // namespace

struct aico8_runtime {
    p8_core *core = nullptr;
    p8_vm *vm = nullptr;
    std::array<uint8_t, P8_SCREEN_PIXELS> framebuffer{};
    bool loaded = false;
    bool started = false;
};

extern "C" {

aico8_runtime *aico8_create(void)
{
    aico8_runtime *runtime = new (std::nothrow) aico8_runtime();
    if (!runtime) {
        return nullptr;
    }
    runtime->core = p8_core_create();
    if (!runtime->core) {
        delete runtime;
        return nullptr;
    }
    return runtime;
}

void aico8_destroy(aico8_runtime *runtime)
{
    if (!runtime) {
        return;
    }
    p8_vm_destroy(runtime->vm);
    p8_core_destroy(runtime->core);
    delete runtime;
}

int aico8_load_cart(aico8_runtime *runtime, const uint8_t *rom, size_t rom_size,
                    const char *source, size_t source_size)
{
    if (!runtime || !rom || !source || !p8_core_load_rom(runtime->core, rom, rom_size)) {
        return 0;
    }
    p8_vm_destroy(runtime->vm);
    runtime->vm = p8_vm_create(runtime->core);
    runtime->loaded = runtime->vm
        && p8_vm_load_source(runtime->vm, source, source_size, "@aico8-cart");
    runtime->started = false;
    return runtime->loaded ? 1 : 0;
}

int aico8_load_persistent(aico8_runtime *runtime, const uint8_t *data, size_t size)
{
    if (!runtime || !runtime->loaded || (!data && size != 0)) {
        return 0;
    }
    const size_t count = std::min(size, kPersistentSize);
    for (size_t i = 0; i < count; ++i) {
        p8_core_poke(runtime->core, static_cast<uint16_t>(kPersistentBase + i), data[i]);
    }
    return 1;
}

int aico8_start(aico8_runtime *runtime)
{
    if (!runtime || !runtime->loaded || !p8_vm_call(runtime->vm, "_init")) {
        return 0;
    }
    runtime->started = true;
    return 1;
}

int aico8_tick60(aico8_runtime *runtime, uint8_t player_zero_buttons)
{
    if (!runtime || !runtime->started) {
        return -1;
    }
    p8_core_set_buttons(runtime->core, 0, player_zero_buttons);
    const int updated = p8_core_host_tick60(runtime->core, 1);
    return p8_vm_last_error(runtime->vm)[0] == '\0' ? updated : -1;
}

const uint8_t *aico8_framebuffer(aico8_runtime *runtime)
{
    if (!runtime) {
        return nullptr;
    }
    p8_gfx_copy_framebuffer_indexed(runtime->core, runtime->framebuffer.data(),
                                    runtime->framebuffer.size());
    return runtime->framebuffer.data();
}

size_t aico8_framebuffer_size(void)
{
    return P8_SCREEN_PIXELS;
}

const p8_draw_command *aico8_draw_commands(const aico8_runtime *runtime)
{
    return runtime ? p8_core_draw_data(runtime->core) : nullptr;
}

size_t aico8_draw_command_count(const aico8_runtime *runtime)
{
    return runtime ? p8_core_draw_count(runtime->core) : 0;
}

const uint8_t *aico8_draw_payload(const aico8_runtime *runtime)
{
    return runtime ? p8_core_draw_payload_data(runtime->core) : nullptr;
}

size_t aico8_draw_payload_size(const aico8_runtime *runtime)
{
    return runtime ? p8_core_draw_payload_size(runtime->core) : 0;
}

size_t aico8_copy_persistent(const aico8_runtime *runtime, uint8_t *destination,
                             size_t capacity)
{
    if (!runtime || !destination || capacity < kPersistentSize) {
        return 0;
    }
    for (size_t i = 0; i < kPersistentSize; ++i) {
        destination[i] = p8_core_peek(runtime->core,
                                      static_cast<uint16_t>(kPersistentBase + i));
    }
    return kPersistentSize;
}

const char *aico8_last_error(const aico8_runtime *runtime)
{
    return runtime && runtime->vm ? p8_vm_last_error(runtime->vm) : "runtime is not loaded";
}

} // extern "C"
