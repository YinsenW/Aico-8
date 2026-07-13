#include "p8/core.h"
#include "p8/raster.h"
#include "p8/vm.h"

#include <array>
#include <cassert>
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

namespace {

constexpr uint16_t kPersistentBase = 0x5e00;

std::string read_fixture()
{
    std::ifstream input("tests/fixtures/synthetic_cart.lua", std::ios::binary);
    assert(input);
    return {std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>()};
}

void append_byte(std::vector<uint8_t> &checkpoint, uint8_t value)
{
    checkpoint.push_back(value);
}

void append_u16(std::vector<uint8_t> &checkpoint, uint16_t value)
{
    append_byte(checkpoint, static_cast<uint8_t>(value));
    append_byte(checkpoint, static_cast<uint8_t>(value >> 8));
}

void append_u32(std::vector<uint8_t> &checkpoint, uint32_t value)
{
    for (unsigned shift = 0; shift < 32; shift += 8) {
        append_byte(checkpoint, static_cast<uint8_t>(value >> shift));
    }
}

std::vector<uint8_t> canonical_checkpoint(const p8_core *core)
{
    std::vector<uint8_t> checkpoint;
    std::array<uint8_t, P8_SCREEN_PIXELS> framebuffer{};
    assert(p8_gfx_copy_framebuffer_indexed(core, framebuffer.data(), framebuffer.size())
           == framebuffer.size());
    checkpoint.insert(checkpoint.end(), framebuffer.begin(), framebuffer.end());

    const size_t command_count = p8_core_draw_count(core);
    append_u32(checkpoint, static_cast<uint32_t>(command_count));
    const p8_draw_command *commands = p8_core_draw_data(core);
    for (size_t index = 0; index < command_count; ++index) {
        append_u16(checkpoint, commands[index].opcode);
        append_u16(checkpoint, commands[index].flags);
        for (int32_t argument : commands[index].args) {
            append_u32(checkpoint, static_cast<uint32_t>(argument));
        }
    }

    const size_t payload_size = p8_core_draw_payload_size(core);
    append_u32(checkpoint, static_cast<uint32_t>(payload_size));
    const uint8_t *payload = p8_core_draw_payload_data(core);
    checkpoint.insert(checkpoint.end(), payload, payload + payload_size);
    for (size_t index = 0; index < 256; ++index) {
        append_byte(checkpoint, p8_core_peek(core, static_cast<uint16_t>(kPersistentBase + index)));
    }
    return checkpoint;
}

std::vector<uint8_t> test_synthetic_cart_updates_raster_and_semantic_stream()
{
    const std::string source = read_fixture();
    std::array<uint8_t, P8_ROM_SIZE> rom{};
    rom[4] = 0x21;
    rom[0x2000] = 1;

    p8_core *core = p8_core_create();
    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    p8_vm *vm = p8_vm_create(core);
    assert(vm);
    assert(p8_vm_load_source(vm, source.data(), source.size(), "@synthetic"));
    p8_core_poke32(core, kPersistentBase, 5u << 16);
    assert(p8_vm_call(vm, "_init"));

    int32_t x = 0;
    assert(p8_vm_get_global_raw(vm, "x", &x));
    assert(x == 5 << 16);
    p8_core_set_buttons(core, 0, 1u << 1);
    assert(p8_vm_update(vm));
    assert(p8_vm_get_global_raw(vm, "x", &x));
    assert(x == 7 << 16);

    assert(p8_vm_draw(vm));
    assert(p8_gfx_pget(core, 0, 0) == 9);
    assert(p8_gfx_pget(core, 1, 0) == 2);
    assert(p8_gfx_pget(core, 16, 0) == 9);
    assert(p8_gfx_pget(core, 24, 0) == 7);
    assert(p8_gfx_pget(core, 26, 0) == 6);
    assert(p8_gfx_pget(core, 31, 1) == 5);
    assert(p8_core_draw_count(core) == 9);
    assert(p8_core_draw_payload_size(core) == 2);

    std::vector<uint8_t> checkpoint = canonical_checkpoint(core);
    p8_vm_destroy(vm);
    p8_core_destroy(core);
    return checkpoint;
}

} // namespace

int main(int argc, char **argv)
{
    const std::vector<uint8_t> checkpoint = test_synthetic_cart_updates_raster_and_semantic_stream();
    if (argc == 2 && std::string(argv[1]) == "--checkpoint") {
        for (uint8_t byte : checkpoint) std::printf("%02x", byte);
        std::putchar('\n');
    } else {
        std::puts("p8 VM tests: ok");
    }
    return 0;
}
