#include "p8/core.h"
#include "p8/audio.h"
#include "p8/raster.h"

#include "audio_internal.h"

#include <algorithm>
#include <array>
#include <cstring>
#include <limits>
#include <new>
#include <vector>

namespace {

constexpr uint16_t kGfxMapRegister = 0x5f54;
constexpr uint16_t kScreenMapRegister = 0x5f55;
constexpr uint16_t kMapMapRegister = 0x5f56;
constexpr uint16_t kMapWidthRegister = 0x5f57;
constexpr uint16_t kButtonStateRegister = 0x5f4c;
constexpr uint16_t kRepeatDelayRegister = 0x5f5c;
constexpr uint16_t kRepeatIntervalRegister = 0x5f5d;
constexpr uint8_t kButtonMask = (1u << P8_BUTTONS_PER_PLAYER) - 1u;

uint16_t add_wrapped(uint16_t address, size_t offset)
{
    return static_cast<uint16_t>(address + static_cast<uint16_t>(offset));
}

} // namespace

struct p8_core {
    std::array<uint8_t, P8_RAM_SIZE> ram{};
    std::array<uint8_t, P8_ROM_SIZE> rom{};
    std::array<uint8_t, P8_DIRTY_BITMAP_SIZE> dirty{};
    std::array<uint8_t, P8_MAX_PLAYERS> pending_buttons{};
    std::array<uint8_t, P8_MAX_PLAYERS> buttons{};
    std::array<uint8_t, P8_MAX_PLAYERS> pressed{};
    std::array<std::array<uint32_t, P8_BUTTONS_PER_PLAYER>, P8_MAX_PLAYERS> held_ticks{};
    p8_core_callbacks callbacks{};
    unsigned update_rate = 30;
    unsigned host_phase = 0;
    uint64_t update_count = 0;
    uint32_t draw_sequence = 0;
    std::vector<p8_draw_command> draw_commands;
    std::vector<uint8_t> draw_payload;
    p8_audio_state audio{};

    uint16_t translate(uint16_t address) const
    {
        if (address < 0x2000) {
            return static_cast<uint16_t>((static_cast<uint16_t>(ram[kGfxMapRegister]) << 8) + address);
        }
        if (address >= 0x6000 && address < 0x8000) {
            return static_cast<uint16_t>((static_cast<uint16_t>(ram[kScreenMapRegister]) << 8) + (address - 0x6000));
        }
        return address;
    }

    uint8_t read(uint16_t address) const
    {
        return ram[translate(address)];
    }

    void mark_dirty(uint16_t physical)
    {
        dirty[physical >> 3] |= static_cast<uint8_t>(1u << (physical & 7u));
    }

    void write(uint16_t address, uint8_t value)
    {
        const uint16_t physical = translate(address);
        if (ram[physical] != value) {
            ram[physical] = value;
            mark_dirty(physical);
        }
    }

    bool map_address(int x, int y, uint16_t &address) const
    {
        const unsigned width = ram[kMapWidthRegister] == 0 ? 256u : ram[kMapWidthRegister];
        const uint8_t mapping = ram[kMapMapRegister];
        size_t capacity = 0;
        if (mapping >= 0x80) {
            capacity = P8_RAM_SIZE - (static_cast<size_t>(mapping) << 8);
        } else if (mapping >= 0x10 && mapping <= 0x2f) {
            capacity = 0x2000;
        } else {
            return false;
        }
        const unsigned height = static_cast<unsigned>(capacity / width);
        if (x < 0 || y < 0 || static_cast<unsigned>(x) >= width || static_cast<unsigned>(y) >= height) {
            return false;
        }

        const size_t offset = static_cast<size_t>(y) * width + static_cast<unsigned>(x);
        if (mapping >= 0x80) {
            address = static_cast<uint16_t>((static_cast<size_t>(mapping) << 8) + offset);
        } else {
            // The 0x1000..0x2fff map region is a ring. Thus the default
            // 0x20 mapping continues at 0x1000 after reaching 0x2fff.
            const size_t start = static_cast<size_t>(mapping - 0x10) << 8;
            address = static_cast<uint16_t>(0x1000 + ((start + offset) & 0x1fff));
        }
        return true;
    }

    unsigned repeat_scale() const
    {
        return update_rate == 60 ? 2u : 1u;
    }
};

p8_audio_state &p8_core_audio_state(p8_core *core)
{
    return core->audio;
}

const p8_audio_state &p8_core_audio_state(const p8_core *core)
{
    return core->audio;
}

extern "C" {

p8_core *p8_core_create(void)
{
    p8_core *core = new (std::nothrow) p8_core();
    if (core) {
        p8_core_reset(core);
    }
    return core;
}

void p8_core_destroy(p8_core *core)
{
    delete core;
}

int p8_core_load_rom(p8_core *core, const uint8_t *rom, size_t size)
{
    if (!core || !rom || size < P8_CART_DATA_SIZE || size > P8_ROM_SIZE) {
        return 0;
    }
    core->rom.fill(0);
    std::copy_n(rom, size, core->rom.begin());
    p8_core_reset(core);
    return 1;
}

void p8_core_reset(p8_core *core)
{
    if (!core) {
        return;
    }
    core->ram.fill(0);
    std::copy_n(core->rom.begin(), P8_CART_DATA_SIZE, core->ram.begin());
    core->pending_buttons.fill(0);
    core->buttons.fill(0);
    core->pressed.fill(0);
    for (auto &player : core->held_ticks) {
        player.fill(0);
    }
    core->ram[kGfxMapRegister] = 0x00;
    core->ram[kScreenMapRegister] = 0x60;
    core->ram[kMapMapRegister] = 0x20;
    core->ram[kMapWidthRegister] = 128;
    core->ram[kRepeatDelayRegister] = 15;
    core->ram[kRepeatIntervalRegister] = 4;
    p8_raster_reset(core);
    core->dirty.fill(0);
    core->callbacks = {};
    core->update_rate = 30;
    core->host_phase = 0;
    core->update_count = 0;
    core->draw_sequence = 0;
    core->draw_commands.clear();
    core->draw_payload.clear();
    p8_audio_reset(core);
}

uint8_t p8_core_peek(const p8_core *core, uint16_t address)
{
    return core ? core->read(address) : 0;
}

uint16_t p8_core_peek16(const p8_core *core, uint16_t address)
{
    uint16_t value = 0;
    for (unsigned i = 0; i < 2; ++i) {
        value |= static_cast<uint16_t>(p8_core_peek(core, add_wrapped(address, i))) << (i * 8);
    }
    return value;
}

uint32_t p8_core_peek32(const p8_core *core, uint16_t address)
{
    uint32_t value = 0;
    for (unsigned i = 0; i < 4; ++i) {
        value |= static_cast<uint32_t>(p8_core_peek(core, add_wrapped(address, i))) << (i * 8);
    }
    return value;
}

void p8_core_poke(p8_core *core, uint16_t address, uint8_t value)
{
    if (core) {
        core->write(address, value);
    }
}

void p8_core_poke16(p8_core *core, uint16_t address, uint16_t value)
{
    for (unsigned i = 0; i < 2; ++i) {
        p8_core_poke(core, add_wrapped(address, i), static_cast<uint8_t>(value >> (i * 8)));
    }
}

void p8_core_poke32(p8_core *core, uint16_t address, uint32_t value)
{
    for (unsigned i = 0; i < 4; ++i) {
        p8_core_poke(core, add_wrapped(address, i), static_cast<uint8_t>(value >> (i * 8)));
    }
}

void p8_core_memset(p8_core *core, uint16_t destination, uint8_t value, size_t length)
{
    for (size_t i = 0; i < length; ++i) {
        p8_core_poke(core, add_wrapped(destination, i), value);
    }
}

void p8_core_memcpy(p8_core *core, uint16_t destination, uint16_t source, size_t length)
{
    if (!core || length == 0) {
        return;
    }
    std::vector<uint8_t> copy(length);
    for (size_t i = 0; i < length; ++i) {
        copy[i] = p8_core_peek(core, add_wrapped(source, i));
    }
    for (size_t i = 0; i < length; ++i) {
        p8_core_poke(core, add_wrapped(destination, i), copy[i]);
    }
}

int p8_core_reload(p8_core *core, uint16_t destination, uint16_t source, size_t length)
{
    if (!core) {
        return 0;
    }
    if (length == 0) {
        return 1;
    }
    if (source >= P8_CART_DATA_SIZE
        || length > static_cast<size_t>(P8_CART_DATA_SIZE - source)) {
        return 0;
    }
    for (size_t offset = 0; offset < length; ++offset) {
        p8_core_poke(core, add_wrapped(destination, offset), core->rom[source + offset]);
    }
    return 1;
}

uint8_t p8_core_mget(const p8_core *core, int x, int y)
{
    uint16_t address = 0;
    return core && core->map_address(x, y, address) ? core->ram[address] : 0;
}

int p8_core_mset(p8_core *core, int x, int y, uint8_t value)
{
    uint16_t address = 0;
    if (!core || !core->map_address(x, y, address)) {
        return 0;
    }
    if (core->ram[address] != value) {
        core->ram[address] = value;
        core->mark_dirty(address);
    }
    return 1;
}

uint8_t p8_core_debug_peek_physical(const p8_core *core, uint16_t address)
{
    return core ? core->ram[address] : 0;
}

void p8_core_clear_dirty(p8_core *core)
{
    if (core) {
        core->dirty.fill(0);
    }
}

int p8_core_is_dirty(const p8_core *core, uint16_t address, size_t length)
{
    if (!core) {
        return 0;
    }
    for (size_t i = 0; i < length; ++i) {
        const uint16_t physical = core->translate(add_wrapped(address, i));
        if ((core->dirty[physical >> 3] & static_cast<uint8_t>(1u << (physical & 7u))) != 0) {
            return 1;
        }
    }
    return 0;
}

size_t p8_core_copy_dirty_bitmap(const p8_core *core, uint8_t *destination, size_t capacity)
{
    if (!core || !destination) {
        return 0;
    }
    const size_t count = std::min(capacity, core->dirty.size());
    std::copy_n(core->dirty.begin(), count, destination);
    return count;
}

void p8_core_set_buttons(p8_core *core, unsigned player, uint8_t six_button_mask)
{
    if (core && player < P8_MAX_PLAYERS) {
        core->pending_buttons[player] = six_button_mask & kButtonMask;
    }
}

void p8_core_begin_update(p8_core *core)
{
    if (!core) {
        return;
    }
    const unsigned scale = core->repeat_scale();
    const uint32_t delay = static_cast<uint32_t>(core->ram[kRepeatDelayRegister]) * scale;
    const uint32_t interval = std::max<uint32_t>(1, static_cast<uint32_t>(core->ram[kRepeatIntervalRegister]) * scale);

    for (unsigned player = 0; player < P8_MAX_PLAYERS; ++player) {
        core->buttons[player] = core->pending_buttons[player];
        core->pressed[player] = 0;
        for (unsigned button = 0; button < P8_BUTTONS_PER_PLAYER; ++button) {
            const uint8_t bit = static_cast<uint8_t>(1u << button);
            uint32_t &held = core->held_ticks[player][button];
            if ((core->buttons[player] & bit) == 0) {
                held = 0;
                continue;
            }
            ++held;
            if (held == 1 || (held > delay && ((held - delay - 1) % interval) == 0)) {
                core->pressed[player] |= bit;
            }
        }
        core->ram[kButtonStateRegister + player] = core->buttons[player];
    }
}

uint8_t p8_core_btn_mask(const p8_core *core, unsigned player)
{
    return core && player < P8_MAX_PLAYERS ? core->buttons[player] : 0;
}

uint8_t p8_core_btnp_mask(const p8_core *core, unsigned player)
{
    return core && player < P8_MAX_PLAYERS ? core->pressed[player] : 0;
}

uint16_t p8_core_btn_combined(const p8_core *core)
{
    return static_cast<uint16_t>(p8_core_btn_mask(core, 0))
        | (static_cast<uint16_t>(p8_core_btn_mask(core, 1)) << 8);
}

uint16_t p8_core_btnp_combined(const p8_core *core)
{
    return static_cast<uint16_t>(p8_core_btnp_mask(core, 0))
        | (static_cast<uint16_t>(p8_core_btnp_mask(core, 1)) << 8);
}

int p8_core_btn(const p8_core *core, unsigned button, unsigned player)
{
    return button < P8_BUTTONS_PER_PLAYER && (p8_core_btn_mask(core, player) & (1u << button)) != 0;
}

int p8_core_btnp(const p8_core *core, unsigned button, unsigned player)
{
    return button < P8_BUTTONS_PER_PLAYER && (p8_core_btnp_mask(core, player) & (1u << button)) != 0;
}

void p8_core_set_callbacks(p8_core *core, const p8_core_callbacks *callbacks)
{
    if (core) {
        core->callbacks = callbacks ? *callbacks : p8_core_callbacks{};
    }
}

void p8_core_set_update_rate(p8_core *core, unsigned updates_per_second)
{
    if (core && (updates_per_second == 30 || updates_per_second == 60)) {
        core->update_rate = updates_per_second;
        core->host_phase = 0;
    }
}

unsigned p8_core_get_update_rate(const p8_core *core)
{
    return core ? core->update_rate : 0;
}

uint64_t p8_core_get_update_count(const p8_core *core)
{
    return core ? core->update_count : 0;
}

double p8_core_time(const p8_core *core)
{
    return core ? static_cast<double>(core->update_count) / core->update_rate : 0.0;
}

int p8_core_host_tick60(p8_core *core, int allow_draw)
{
    if (!core) {
        return 0;
    }
    if (core->update_rate == 30) {
        core->host_phase ^= 1u;
        if (core->host_phase == 0) {
            p8_audio_host_tick60(core);
            return 0;
        }
    }

    ++core->update_count;
    p8_core_begin_update(core);
    if (core->update_rate == 60 && core->callbacks.update60) {
        core->callbacks.update60(core->callbacks.userdata);
    } else if (core->callbacks.update) {
        core->callbacks.update(core->callbacks.userdata);
    }
    if (allow_draw && core->callbacks.draw) {
        core->callbacks.draw(core->callbacks.userdata);
    }
    p8_audio_host_tick60(core);
    return 1;
}

void p8_core_begin_draw_stream(p8_core *core)
{
    if (core) {
        core->draw_commands.clear();
        core->draw_payload.clear();
        core->draw_sequence = 0;
    }
}

int p8_core_emit_draw(p8_core *core, const p8_draw_command *command)
{
    return p8_core_emit_draw_payload(core, command, nullptr, 0);
}

int p8_core_emit_draw_payload(p8_core *core, const p8_draw_command *command,
                              const void *payload, size_t payload_size)
{
    if (!core || !command || (payload_size != 0 && !payload)
        || payload_size > std::numeric_limits<uint32_t>::max()
        || core->draw_payload.size() > std::numeric_limits<uint32_t>::max() - payload_size) {
        return 0;
    }
    p8_draw_command copy = *command;
    copy.sequence = core->draw_sequence++;
    copy.payload_offset = static_cast<uint32_t>(core->draw_payload.size());
    copy.payload_size = static_cast<uint32_t>(payload_size);
    if (payload_size != 0) {
        const auto *bytes = static_cast<const uint8_t *>(payload);
        core->draw_payload.insert(core->draw_payload.end(), bytes, bytes + payload_size);
    }
    core->draw_commands.push_back(copy);
    return 1;
}

size_t p8_core_draw_count(const p8_core *core)
{
    return core ? core->draw_commands.size() : 0;
}

const p8_draw_command *p8_core_draw_data(const p8_core *core)
{
    return core && !core->draw_commands.empty() ? core->draw_commands.data() : nullptr;
}

size_t p8_core_draw_payload_size(const p8_core *core)
{
    return core ? core->draw_payload.size() : 0;
}

const uint8_t *p8_core_draw_payload_data(const p8_core *core)
{
    return core && !core->draw_payload.empty() ? core->draw_payload.data() : nullptr;
}

} // extern "C"
