#include "p8/wasm.h"

#include "p8/audio.h"
#include "p8/raster.h"
#include "p8/text.h"
#include "p8/vm.h"

#include <algorithm>
#include <array>
#include <cstring>
#include <new>
#include <string>
#include <vector>

namespace {

constexpr uint16_t kPersistentBase = 0x5e00;
constexpr size_t kPersistentSize = 64 * sizeof(uint32_t);

} // namespace

struct aico8_runtime {
    p8_core *core = nullptr;
    p8_vm *vm = nullptr;
    std::array<uint8_t, P8_SCREEN_PIXELS> framebuffer{};
    std::vector<uint8_t> rom;
    std::string source;
    bool loaded = false;
    bool started = false;
    bool initialization_complete = false;
    uint32_t audio_diagnostic_mask = 0;
    uint32_t audio_diagnostic_used_flags = 0;
};

namespace {

bool restart_cart(aico8_runtime *runtime)
{
    runtime->audio_diagnostic_used_flags |= p8_audio_diagnostic_flags(runtime->core);
    std::array<uint8_t, kPersistentSize> persistent{};
    for (size_t index = 0; index < persistent.size(); ++index) {
        persistent[index] = p8_core_peek(
            runtime->core, static_cast<uint16_t>(kPersistentBase + index));
    }

    p8_vm_destroy(runtime->vm);
    runtime->vm = nullptr;
    if (!p8_core_load_rom(runtime->core, runtime->rom.data(), runtime->rom.size())) {
        runtime->started = false;
        return false;
    }
    if (!p8_audio_set_diagnostic_mask(runtime->core, runtime->audio_diagnostic_mask)) {
        runtime->started = false;
        return false;
    }
    for (size_t index = 0; index < persistent.size(); ++index) {
        p8_core_poke(runtime->core, static_cast<uint16_t>(kPersistentBase + index),
                     persistent[index]);
    }

    runtime->vm = p8_vm_create(runtime->core);
    runtime->loaded = runtime->vm
        && p8_vm_load_source(runtime->vm, runtime->source.data(), runtime->source.size(),
                             "@aico8-cart");
    runtime->started = runtime->loaded && p8_vm_call(runtime->vm, "_init");
    runtime->initialization_complete = runtime->started
        && !(p8_vm_call_pending(runtime->vm)
             && std::string(p8_vm_active_function(runtime->vm)) == "_init");
    return runtime->started;
}

} // namespace

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
    runtime->rom.assign(rom, rom + rom_size);
    runtime->source.assign(source, source_size);
    runtime->started = false;
    runtime->initialization_complete = false;
    runtime->audio_diagnostic_mask = 0;
    runtime->audio_diagnostic_used_flags = 0;
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
    runtime->initialization_complete = !(p8_vm_call_pending(runtime->vm)
        && std::string(p8_vm_active_function(runtime->vm)) == "_init");
    return 1;
}

int aico8_initialization_complete(const aico8_runtime *runtime)
{
    return runtime && runtime->started && runtime->initialization_complete ? 1 : 0;
}

int aico8_tick60(aico8_runtime *runtime, uint8_t player_zero_buttons)
{
    if (!runtime || !runtime->started) {
        return -1;
    }
    p8_core_set_buttons(runtime->core, 0, player_zero_buttons);
    const int updated = p8_core_host_tick60(runtime->core, 1);
    if (p8_vm_last_error(runtime->vm)[0] != '\0') {
        return -1;
    }
    if (p8_audio_last_error(runtime->core)[0] != '\0') {
        return -1;
    }
    if (!runtime->initialization_complete && !p8_vm_call_pending(runtime->vm)) {
        runtime->initialization_complete = true;
    }
    if (p8_vm_restart_requested(runtime->vm) && !restart_cart(runtime)) {
        return -1;
    }
    return updated;
}

size_t aico8_audio_available(const aico8_runtime *runtime)
{
    return runtime ? p8_audio_available(runtime->core) : 0;
}

size_t aico8_read_audio(aico8_runtime *runtime, int16_t *destination,
                        size_t capacity)
{
    return runtime ? p8_audio_read(runtime->core, destination, capacity) : 0;
}

uint32_t aico8_audio_capabilities(const aico8_runtime *runtime)
{
    return runtime ? p8_audio_capabilities(runtime->core) : 0;
}

int aico8_set_audio_diagnostic_mask(aico8_runtime *runtime, uint32_t mask)
{
    if (!runtime || runtime->started || !p8_audio_set_diagnostic_mask(runtime->core, mask)) {
        return 0;
    }
    runtime->audio_diagnostic_mask = mask;
    return 1;
}

uint32_t aico8_audio_diagnostic_flags(const aico8_runtime *runtime)
{
    return runtime ? runtime->audio_diagnostic_used_flags
        | p8_audio_diagnostic_flags(runtime->core) : 0;
}

int aico8_get_audio_channel_status(const aico8_runtime *runtime, unsigned channel,
                                   p8_audio_channel_status *status)
{
    return runtime ? p8_audio_get_channel_status(runtime->core, channel, status) : 0;
}

size_t aico8_copy_audio_events(const aico8_runtime *runtime,
                               p8_audio_event *destination, size_t capacity)
{
    return runtime ? p8_audio_copy_events(runtime->core, destination, capacity) : 0;
}

const uint8_t *aico8_framebuffer(aico8_runtime *runtime)
{
    if (!runtime) {
        return nullptr;
    }
    if (!runtime->vm || !p8_vm_frame_held(runtime->vm)) {
        p8_gfx_copy_framebuffer_indexed(runtime->core, runtime->framebuffer.data(),
                                        runtime->framebuffer.size());
    }
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

const uint8_t *aico8_text_ir(const aico8_runtime *runtime)
{
    return runtime ? p8_core_text_ir_data(runtime->core) : nullptr;
}

size_t aico8_text_ir_size(const aico8_runtime *runtime)
{
    return runtime ? p8_core_text_ir_size(runtime->core) : 0;
}

size_t aico8_copy_map_region(const aico8_runtime *runtime, int cell_x, int cell_y,
                             int width, int height, uint8_t *destination,
                             size_t capacity)
{
    if (!runtime || !destination || width <= 0 || height <= 0) {
        return 0;
    }
    const size_t required = static_cast<size_t>(width) * static_cast<size_t>(height);
    if (capacity < required) {
        return 0;
    }
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            destination[static_cast<size_t>(y) * static_cast<size_t>(width)
                        + static_cast<size_t>(x)]
                = p8_core_mget(runtime->core, cell_x + x, cell_y + y);
        }
    }
    return required;
}

size_t aico8_copy_sprite_region(const aico8_runtime *runtime, int pixel_x, int pixel_y,
                                int width, int height, uint8_t *destination,
                                size_t capacity)
{
    if (!runtime || !runtime->core || !destination || width < 0 || height < 0
        || pixel_x < 0 || pixel_y < 0 || pixel_x + width > 128
        || pixel_y + height > 128) {
        return 0;
    }
    const size_t required = static_cast<size_t>(width) * static_cast<size_t>(height);
    if (capacity < required) return 0;
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            destination[static_cast<size_t>(y) * static_cast<size_t>(width)
                        + static_cast<size_t>(x)] =
                p8_gfx_sget(runtime->core, pixel_x + x, pixel_y + y);
        }
    }
    return required;
}

size_t aico8_copy_sprite_flags(const aico8_runtime *runtime, int first_sprite,
                               int count, uint8_t *destination, size_t capacity)
{
    if (!runtime || !runtime->core || !destination || first_sprite < 0 || count < 0
        || first_sprite + count > 256 || capacity < static_cast<size_t>(count)) {
        return 0;
    }
    for (int index = 0; index < count; ++index) {
        destination[index] = p8_core_peek(
            runtime->core, static_cast<uint16_t>(0x3000 + first_sprite + index));
    }
    return static_cast<size_t>(count);
}

size_t aico8_copy_palette_state(const aico8_runtime *runtime, uint8_t *destination,
                                size_t capacity)
{
    constexpr size_t kPaletteStateSize = 32;
    if (!runtime || !runtime->core || !destination || capacity < kPaletteStateSize) return 0;
    for (size_t index = 0; index < kPaletteStateSize; ++index) {
        destination[index] = p8_core_peek(
            runtime->core, static_cast<uint16_t>(0x5f00 + index));
    }
    return kPaletteStateSize;
}

int aico8_get_global_raw(aico8_runtime *runtime, const char *name,
                         int32_t *raw_16_16)
{
    return runtime && runtime->vm ? p8_vm_get_global_raw(runtime->vm, name, raw_16_16) : 0;
}

int aico8_get_global_boolean(aico8_runtime *runtime, const char *name, int *value)
{
    return runtime && runtime->vm ? p8_vm_get_global_boolean(runtime->vm, name, value) : 0;
}

size_t aico8_copy_global_string(aico8_runtime *runtime, const char *name,
                                char *destination, size_t capacity)
{
    return runtime && runtime->vm
        ? p8_vm_copy_global_string(runtime->vm, name, destination, capacity) : 0;
}

int aico8_get_table_length(aico8_runtime *runtime, const char *name,
                           size_t *length)
{
    return runtime && runtime->vm ? p8_vm_get_table_length(runtime->vm, name, length) : 0;
}

int aico8_get_table_value_raw(aico8_runtime *runtime, const char *name,
                              size_t one_based_index, int32_t *raw_16_16)
{
    return runtime && runtime->vm
        ? p8_vm_get_table_value_raw(runtime->vm, name, one_based_index, raw_16_16) : 0;
}

int aico8_get_table_field_raw(aico8_runtime *runtime, const char *name,
                              const char *field, int32_t *raw_16_16)
{
    return runtime && runtime->vm
        ? p8_vm_get_table_field_raw(runtime->vm, name, field, raw_16_16) : 0;
}

int aico8_get_table_field_boolean(aico8_runtime *runtime, const char *name,
                                  const char *field, int *value)
{
    return runtime && runtime->vm
        ? p8_vm_get_table_field_boolean(runtime->vm, name, field, value) : 0;
}

int aico8_get_table_entry_raw(aico8_runtime *runtime, const char *name,
                              size_t one_based_index, const char *field,
                              int32_t *raw_16_16)
{
    return runtime && runtime->vm
        ? p8_vm_get_table_entry_raw(runtime->vm, name, one_based_index, field, raw_16_16) : 0;
}

int aico8_get_table_entry_boolean(aico8_runtime *runtime, const char *name,
                                  size_t one_based_index, const char *field,
                                  int *value)
{
    return runtime && runtime->vm
        ? p8_vm_get_table_entry_boolean(runtime->vm, name, one_based_index, field, value) : 0;
}

size_t aico8_copy_menu_item_label(const aico8_runtime *runtime, unsigned index,
                                  char *destination, size_t capacity)
{
    if (!runtime || !runtime->vm || !destination || capacity == 0) return 0;
    const char *label = p8_vm_menu_item_label(runtime->vm, index);
    const size_t size = std::strlen(label);
    if (size == 0 || size + 1 > capacity) return 0;
    std::memcpy(destination, label, size);
    destination[size] = '\0';
    return size;
}

uint8_t aico8_menu_item_filter(const aico8_runtime *runtime, unsigned index)
{
    return runtime && runtime->vm ? p8_vm_menu_item_filter(runtime->vm, index) : 0;
}

int aico8_invoke_menu_item(aico8_runtime *runtime, unsigned index,
                           uint8_t buttons, int *keep_open)
{
    if (!runtime || !runtime->vm || !keep_open) return 0;
    if (!p8_vm_invoke_menu_item(runtime->vm, index, buttons, keep_open)) return 0;
    if (p8_vm_restart_requested(runtime->vm)) {
        *keep_open = 0;
        return restart_cart(runtime) ? 1 : 0;
    }
    return 1;
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
    if (!runtime || !runtime->vm) return "runtime is not loaded";
    return p8_vm_last_error(runtime->vm)[0] != '\0'
        ? p8_vm_last_error(runtime->vm) : p8_audio_last_error(runtime->core);
}

const char *aico8_diagnostic_output(const aico8_runtime *runtime)
{
    return runtime && runtime->vm ? p8_vm_diagnostic_output(runtime->vm) : "";
}

} // extern "C"
