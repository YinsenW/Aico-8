#include "p8/core.h"
#include "p8/audio.h"
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

std::vector<uint8_t> canonical_checkpoint(p8_core *core)
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
    std::array<int16_t, 512> audio{};
    const size_t audio_count = p8_audio_read(core, audio.data(), audio.size());
    append_u32(checkpoint, static_cast<uint32_t>(audio_count));
    for (size_t index = 0; index < audio_count; ++index) {
        append_u16(checkpoint, static_cast<uint16_t>(audio[index]));
    }
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
    rom[0x3200] = static_cast<uint8_t>(33 | (3 << 6));
    rom[0x3201] = static_cast<uint8_t>(7 << 1);
    rom[0x3240] = 1;
    rom[0x3241] = 2;

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
    int32_t flags = 0;
    assert(p8_vm_get_global_raw(vm, "flags", &flags));
    assert(flags == 4 << 16);
    int layer = 0;
    assert(p8_vm_get_global_boolean(vm, "layer", &layer));
    assert(layer);
    std::array<char, 16> mode{};
    assert(p8_vm_copy_global_string(vm, "mode", mode.data(), mode.size()) == 7);
    assert(std::string(mode.data()) == "fixture");
    size_t actor_count = 0;
    assert(p8_vm_get_table_length(vm, "actors", &actor_count) && actor_count == 2);
    int32_t table_value = 0;
    assert(p8_vm_get_table_value_raw(vm, "values", 2, &table_value));
    assert(table_value == 9 << 16);
    assert(!p8_vm_get_table_value_raw(vm, "values", 3, &table_value));
    int32_t actor_x = 0;
    assert(p8_vm_get_table_entry_raw(vm, "actors", 1, "x", &actor_x));
    assert(actor_x == 3 << 16);
    int actor_rock = 0;
    assert(p8_vm_get_table_entry_boolean(vm, "actors", 1, "rock", &actor_rock));
    assert(actor_rock == 1);
    assert(p8_vm_get_table_entry_boolean(vm, "actors", 2, "rock", &actor_rock));
    assert(actor_rock == 0);
    assert(p8_core_peek(core, 0x3001) == 4);
    p8_core_set_buttons(core, 0, 1u << 1);
    assert(p8_core_host_tick60(core, 1) == 1);
    assert(p8_vm_get_global_raw(vm, "x", &x));
    assert(x == 7 << 16);

    assert(p8_gfx_pget(core, 0, 0) == 9);
    assert(p8_gfx_pget(core, 1, 0) == 2);
    assert(p8_gfx_pget(core, 8, 1) == 0); // zero map cell skips visible sprite 0
    assert(p8_gfx_pget(core, 16, 0) == 9);
    assert(p8_gfx_pget(core, 24, 0) == 7);
    assert(p8_gfx_pget(core, 26, 0) == 6);
    assert(p8_gfx_pget(core, 31, 1) == 5);
    assert(p8_gfx_pget(core, 42, 0) == 8);
    assert(p8_gfx_pget(core, 48, 2) == 9);
    assert(p8_core_draw_count(core) == 11);
    assert(p8_core_draw_payload_size(core) == 2);

    std::vector<uint8_t> checkpoint = canonical_checkpoint(core);
    p8_vm_destroy(vm);
    p8_core_destroy(core);
    return checkpoint;
}

void test_pico_button_glyph_constants_map_to_all_six_buttons()
{
    p8_core *core = p8_core_create();
    p8_vm *vm = p8_vm_create(core);
    assert(vm);
    const std::array<const char *, 6> glyphs = {"⬅️", "➡️", "⬆️", "⬇️", "🅾️", "❎"};
    for (size_t index = 0; index < glyphs.size(); ++index) {
        int32_t value = -1;
        assert(p8_vm_get_global_raw(vm, glyphs[index], &value));
        assert(value == static_cast<int32_t>(index << 16));
    }
    p8_vm_destroy(vm);
    p8_core_destroy(core);
}

void test_flip_suspends_and_resumes_initialization_at_frame_boundaries()
{
    constexpr char source[] = R"p8lua(
phase=0
updates=0
draws=0
function _init()
 phase=1
 cls(1)
 flip()
 phase=2
 cls(2)
 flip()
 phase=3
end
function _update60() updates+=1 end
function _draw() draws+=1 end
)p8lua";
    std::array<uint8_t, P8_ROM_SIZE> rom{};
    p8_core *core = p8_core_create();
    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    p8_vm *vm = p8_vm_create(core);
    assert(vm);
    assert(p8_vm_load_source(vm, source, sizeof(source) - 1, "@flip-test"));

    int32_t value = 0;
    assert(p8_vm_call(vm, "_init"));
    assert(p8_vm_get_global_raw(vm, "phase", &value) && value == 1 << 16);
    assert(p8_gfx_pget(core, 0, 0) == 1);

    assert(p8_vm_update(vm));
    assert(p8_vm_get_global_raw(vm, "phase", &value) && value == 2 << 16);
    assert(p8_gfx_pget(core, 0, 0) == 2);
    assert(p8_vm_draw(vm));
    assert(p8_vm_get_global_raw(vm, "draws", &value) && value == 0);

    assert(p8_vm_update(vm));
    assert(p8_vm_get_global_raw(vm, "phase", &value) && value == 3 << 16);
    assert(p8_vm_draw(vm));
    assert(p8_vm_get_global_raw(vm, "draws", &value) && value == 0);

    assert(p8_vm_update(vm));
    assert(p8_vm_get_global_raw(vm, "updates", &value) && value == 1 << 16);
    assert(p8_vm_draw(vm));
    assert(p8_vm_get_global_raw(vm, "draws", &value) && value == 1 << 16);

    p8_vm_destroy(vm);
    p8_core_destroy(core);
}

void test_menu_items_register_filter_invoke_update_and_remove()
{
    constexpr char source[] = R"p8lua(
menu_buttons=-1
function _init()
 menuitem(0x301,"restart puzzle long",function(buttons)
  menu_buttons=buttons
  menuitem(nil,"stay open",function() return false end)
  return true
 end)
end
function remove_menu() menuitem(1) end
)p8lua";
    p8_core *core = p8_core_create();
    p8_vm *vm = p8_vm_create(core);
    assert(vm);
    assert(p8_vm_load_source(vm, source, sizeof(source) - 1, "@menu-test"));
    assert(p8_vm_call(vm, "_init"));
    assert(std::string(p8_vm_menu_item_label(vm, 1)) == "restart puzzle l");
    assert(p8_vm_menu_item_filter(vm, 1) == 3);

    int keep_open = 0;
    assert(p8_vm_invoke_menu_item(vm, 1, 7, &keep_open));
    assert(keep_open == 1);
    int32_t buttons = 0;
    assert(p8_vm_get_global_raw(vm, "menu_buttons", &buttons));
    assert(buttons == 4 << 16); // filtered L/R bits are excluded from the callback
    assert(std::string(p8_vm_menu_item_label(vm, 1)) == "stay open");

    assert(p8_vm_call(vm, "remove_menu"));
    assert(std::string(p8_vm_menu_item_label(vm, 1)).empty());
    assert(!p8_vm_invoke_menu_item(vm, 1, 0, &keep_open));
    p8_vm_destroy(vm);
    p8_core_destroy(core);
}

} // namespace

int main(int argc, char **argv)
{
    const std::vector<uint8_t> checkpoint = test_synthetic_cart_updates_raster_and_semantic_stream();
    test_pico_button_glyph_constants_map_to_all_six_buttons();
    test_flip_suspends_and_resumes_initialization_at_frame_boundaries();
    test_menu_items_register_filter_invoke_update_and_remove();
    if (argc == 2 && std::string(argv[1]) == "--checkpoint") {
        for (uint8_t byte : checkpoint) std::printf("%02x", byte);
        std::putchar('\n');
    } else {
        std::puts("p8 VM tests: ok");
    }
    return 0;
}
