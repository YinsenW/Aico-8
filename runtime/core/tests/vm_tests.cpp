#include "p8/core.h"
#include "p8/audio.h"
#include "p8/raster.h"
#include "p8/vm.h"

#include <array>
#include <cassert>
#include <cstring>
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <iterator>
#include <string>
#include <utility>
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
    append_u32(checkpoint, p8_audio_capabilities(core));
    p8_audio_channel_status channel{};
    assert(p8_audio_get_channel_status(core, 0, &channel));
    append_u32(checkpoint, static_cast<uint32_t>(channel.sfx));
    append_u32(checkpoint, static_cast<uint32_t>(channel.note));
    append_u32(checkpoint, static_cast<uint32_t>(channel.deferred_music_sfx));
    append_u32(checkpoint, static_cast<uint32_t>(channel.is_music));
    append_u32(checkpoint, static_cast<uint32_t>(channel.is_releasing));
    std::array<p8_audio_event, 16> events{};
    const size_t event_count = p8_audio_copy_events(core, events.data(), events.size());
    append_u32(checkpoint, static_cast<uint32_t>(event_count));
    for (size_t index = 0; index < event_count; ++index) {
        append_u32(checkpoint, events[index].sequence);
        append_u32(checkpoint, events[index].sample_low);
        append_u32(checkpoint, events[index].sample_high);
        append_u32(checkpoint, static_cast<uint32_t>(events[index].kind));
        append_u32(checkpoint, static_cast<uint32_t>(events[index].channel));
        append_u32(checkpoint, static_cast<uint32_t>(events[index].sfx));
        append_u32(checkpoint, static_cast<uint32_t>(events[index].note));
        append_u32(checkpoint, static_cast<uint32_t>(events[index].music_pattern));
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
    int32_t player_x = 0;
    assert(p8_vm_get_table_field_raw(vm, "player", "x", &player_x));
    assert(player_x == 11 << 16);
    assert(!p8_vm_get_table_field_raw(vm, "player", "active", &player_x));
    int player_active = 0;
    assert(p8_vm_get_table_field_boolean(vm, "player", "active", &player_active));
    assert(player_active == 1);
    assert(!p8_vm_get_table_field_boolean(vm, "player", "x", &player_active));
    int32_t actor_x = 0;
    assert(p8_vm_get_table_entry_raw(vm, "actors", 1, "x", &actor_x));
    assert(actor_x == 3 << 16);
    int actor_rock = 0;
    assert(p8_vm_get_table_entry_boolean(vm, "actors", 1, "rock", &actor_rock));
    assert(actor_rock == 1);
    assert(p8_vm_get_table_entry_boolean(vm, "actors", 2, "rock", &actor_rock));
    assert(actor_rock == 0);
    int32_t restored = 0;
    assert(p8_vm_get_global_raw(vm, "restored", &restored));
    assert(restored == 1 << 16);
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

void test_unicode_source_glyphs_execute_as_p8scii_byte_strings()
{
    constexpr char source[] = u8R"p8lua(
sample="¹。▮○█🐱⬇️🅾️❎あョ◝"
long_sample=[[²●ア]]
-- 。 inside a comment is not executable text
function _init()
 sample_length=#sample
 long_length=#long_sample
 first=ord(sample,1)
 punctuation=ord(sample,2)
 control=ord(sample,3)
 circle=ord(sample,4)
 block=ord(sample,5)
 cat=ord(sample,6)
 down=ord(sample,7)
 button=ord(sample,8)
 cross=ord(sample,9)
 hiragana=ord(sample,10)
 katakana=ord(sample,11)
 last=ord(sample,12)
 sub_value=ord(sub(sample,2,2))
end
)p8lua";
    p8_core *core = p8_core_create();
    p8_vm *vm = p8_vm_create(core);
    assert(vm);
    assert(p8_vm_load_source(vm, source, sizeof(source) - 1, "@p8scii-source-test"));
    assert(p8_vm_call(vm, "_init"));

    const std::array<std::pair<const char *, int32_t>, 15> expected = {{
        {"sample_length", 12}, {"long_length", 3}, {"first", 0x01},
        {"punctuation", 0x1d}, {"control", 0x10}, {"circle", 0x7f},
        {"block", 0x80}, {"cat", 0x82}, {"down", 0x83}, {"button", 0x8e},
        {"cross", 0x97}, {"hiragana", 0x9a}, {"katakana", 0xfd},
        {"last", 0xff}, {"sub_value", 0x1d},
    }};
    for (const auto &[name, value] : expected) {
        int32_t actual = -1;
        assert(p8_vm_get_global_raw(vm, name, &actual));
        assert(actual == value << 16);
    }
    p8_vm_destroy(vm);
    p8_core_destroy(core);
}

void test_holdframe_defers_presentation_until_the_next_host_frame()
{
    constexpr char source[] = R"p8lua(
holdframe()
function _update() pset(4,4,9) end
)p8lua";
    p8_core *core = p8_core_create();
    p8_vm *vm = p8_vm_create(core);
    assert(vm);
    assert(p8_vm_load_source(vm, source, sizeof(source) - 1, "@holdframe-test"));
    assert(p8_vm_frame_held(vm));
    assert(p8_core_host_tick60(core, 1) == 1);
    assert(!p8_vm_frame_held(vm));
    assert(p8_gfx_pget(core, 4, 4) == 9);
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

void test_palette_transparency_diagnostics_and_deterministic_time()
{
    constexpr char source[] = R"p8lua(
initial_time=-1
clock=-1
alias_clock=-1
unpacked_a=-1
unpacked_b=-1
peek_a=-1
peek_b=-1
peek_c=-1
peek_word=-1
peek_fixed=-1
copied_a=-1
copied_b=-1
filled_a=-1
reload_a=-1
reload_b=-1
screen_pixel=-1
sprite_pixel=-1
count_all=-1
count_ones=-1
stat_rate=-1
stat_key=true
function _init()
 initial_time=time()
 printh("boot "..initial_time)
 unpacked_a,unpacked_b=unpack({4,5})
 poke(0x3200,1,2,3)
 peek_a,peek_b,peek_c=peek(0x3200,3)
 poke2(0x3204,0xabcd)
 peek_word=peek2(0x3204)
 poke4(0x3210,0x1234.5678)
 peek_fixed=peek4(0x3210)
 poke(0x3220,1,2,3,4)
 memcpy(0x3221,0x3220,3)
 copied_a,copied_b=peek(0x3221,2)
 memset(0x3230,7,3)
 filled_a=peek(0x3232)
 poke(0x2000,99,98)
 reload(0x2000,0x1000,2)
 reload_a,reload_b=peek(0x2000,2)
 cls(3)
 camera(2,1)
 pset(22,21,9)
 camera()
 palt(0,false)
 spr(0,0,0)
 palt()
 spr(0,8,0)
 pset(1,1,8)
 screen_pixel=pget(1,1)
 sset(20,20,15)
 sprite_pixel=sget(20,20)
 count_all=count({1,2,1})
 count_ones=count({1,2,1},1)
 stat_rate=stat(8)
 stat_key=stat(30)
 extcmd("rec")
 line()
 line(30,30,10)
 line(32,30,10)
 line(40,40,42,40,11)
 clip(50,50,2,2)
 pset(49,49,12)
 pset(50,50,12)
 clip()
 sspr(16,16,2,1,60,60,4,2)
 sspr(16,16,2,1,64,60,4,2,true)
 palt(0xc000)
end
function denied_reload_code() reload(0,0x42ff,2) end
function denied_reload_external() reload(0,0,1,"other.p8") end
function _update()
 clock=time()
 alias_clock=t()
end
function denied_file_output() printh("unsafe","log.txt") end
)p8lua";
    std::array<uint8_t, P8_ROM_SIZE> rom{};
    rom[0x1000] = 21;
    rom[0x1001] = 22;
    p8_core *core = p8_core_create();
    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    p8_vm *vm = p8_vm_create(core);
    assert(vm);
    p8_gfx_sset(core, 16, 16, 13);
    p8_gfx_sset(core, 17, 16, 14);
    assert(p8_vm_load_source(vm, source, sizeof(source) - 1, "@host-api-test"));
    assert(p8_vm_call(vm, "_init"));

    int32_t value = -1;
    assert(p8_vm_get_global_raw(vm, "initial_time", &value) && value == 0);
    assert(std::string(p8_vm_diagnostic_output(vm))
           == "boot 0\nextcmd(rec): recording is unavailable in this host; gameplay continued\n");
    assert(p8_vm_get_global_raw(vm, "unpacked_a", &value) && value == 4 << 16);
    assert(p8_vm_get_global_raw(vm, "unpacked_b", &value) && value == 5 << 16);
    assert(p8_vm_get_global_raw(vm, "peek_a", &value) && value == 1 << 16);
    assert(p8_vm_get_global_raw(vm, "peek_b", &value) && value == 2 << 16);
    assert(p8_vm_get_global_raw(vm, "peek_c", &value) && value == 3 << 16);
    assert(p8_vm_get_global_raw(vm, "peek_word", &value)
           && static_cast<uint32_t>(value) == 0xabcd0000u);
    assert(p8_vm_get_global_raw(vm, "peek_fixed", &value)
           && static_cast<uint32_t>(value) == 0x12345678u);
    assert(p8_vm_get_global_raw(vm, "copied_a", &value) && value == 1 << 16);
    assert(p8_vm_get_global_raw(vm, "copied_b", &value) && value == 2 << 16);
    assert(p8_vm_get_global_raw(vm, "filled_a", &value) && value == 7 << 16);
    assert(p8_vm_get_global_raw(vm, "reload_a", &value) && value == 21 << 16);
    assert(p8_vm_get_global_raw(vm, "reload_b", &value) && value == 22 << 16);
    assert(p8_vm_get_global_raw(vm, "screen_pixel", &value) && value == 8 << 16);
    assert(p8_vm_get_global_raw(vm, "sprite_pixel", &value) && value == 15 << 16);
    assert(p8_vm_get_global_raw(vm, "count_all", &value) && value == 3 << 16);
    assert(p8_vm_get_global_raw(vm, "count_ones", &value) && value == 2 << 16);
    assert(p8_vm_get_global_raw(vm, "stat_rate", &value) && value == 30 << 16);
    int boolean = 1;
    assert(p8_vm_get_global_boolean(vm, "stat_key", &boolean) && boolean == 0);
    assert(p8_gfx_pget(core, 20, 20) == 9);
    assert(p8_gfx_pget(core, 1, 1) == 8);
    assert(p8_gfx_pget(core, 0, 0) == 0); // palt(0,false) makes sprite color zero visible
    assert(p8_gfx_pget(core, 8, 0) == 3); // palt() restores color-zero transparency
    assert(p8_gfx_pget(core, 30, 30) == 10);
    assert(p8_gfx_pget(core, 31, 30) == 10);
    assert(p8_gfx_pget(core, 42, 40) == 11);
    assert(p8_gfx_pget(core, 49, 49) == 3);
    assert(p8_gfx_pget(core, 50, 50) == 12);
    assert(p8_gfx_pget(core, 60, 60) == 13);
    assert(p8_gfx_pget(core, 61, 61) == 13);
    assert(p8_gfx_pget(core, 62, 60) == 14);
    assert(p8_gfx_pget(core, 64, 60) == 14);
    assert(p8_gfx_pget(core, 66, 60) == 13);
    assert(p8_gfx_is_transparent(core, 0));
    assert(p8_gfx_is_transparent(core, 1));
    assert(!p8_gfx_is_transparent(core, 2));

    assert(p8_core_host_tick60(core, 1) == 1);
    constexpr int32_t one_thirtieth = 0x10000 / 30;
    assert(p8_vm_get_global_raw(vm, "clock", &value) && value == one_thirtieth);
    assert(p8_vm_get_global_raw(vm, "alias_clock", &value) && value == one_thirtieth);

    assert(!p8_vm_call(vm, "denied_reload_code"));
    assert(std::string(p8_vm_last_error(vm)).find("protected cart code") != std::string::npos);
    assert(!p8_vm_call(vm, "denied_reload_external"));
    assert(std::string(p8_vm_last_error(vm)).find("external cartridge") != std::string::npos);
    assert(!p8_vm_call(vm, "denied_file_output"));
    assert(std::strstr(p8_vm_last_error(vm), "file output is disabled") != nullptr);
    p8_vm_destroy(vm);
    p8_core_destroy(core);
}

void test_current_draw_color_is_shared_by_primitives_print_and_sprite_sheet()
{
    constexpr char source[] = R"p8lua(
function verify_current_color()
 color(8)
 line(1,1,3,1)
 pset(4,1,9)
 pset(5,1)
 rect(6,1,7,2)
 circfill(9,2,1)
 sset(9,9)
 print("a",0,0)
 print("b",1,1,12)
 pset(11,1)
 print("c",13)
 pset(12,1)
 color()
 pset(13,1)
end
function leave_non_default_color() color(14) end
)p8lua";
    std::array<uint8_t, P8_ROM_SIZE> rom{};
    p8_core *core = p8_core_create();
    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    p8_vm *vm = p8_vm_create(core);
    assert(vm);
    assert(p8_vm_load_source(vm, source, sizeof(source) - 1, "@draw-color-test"));
    p8_core_begin_draw_stream(core);
    assert(p8_vm_call(vm, "verify_current_color"));

    assert(p8_gfx_pget(core, 1, 1) == 8);
    assert(p8_gfx_pget(core, 3, 1) == 8);
    assert(p8_gfx_pget(core, 4, 1) == 9); // explicit primitive colour is not sticky
    assert(p8_gfx_pget(core, 5, 1) == 8);
    assert(p8_gfx_pget(core, 6, 1) == 8);
    assert(p8_gfx_pget(core, 9, 2) == 8);
    assert(p8_gfx_sget(core, 9, 9) == 8);
    assert(p8_gfx_pget(core, 11, 1) == 12); // print(str,x,y,col) sets current
    assert(p8_gfx_pget(core, 12, 1) == 13); // print(str,col) sets current
    assert(p8_gfx_pget(core, 13, 1) == 6);  // color() restores the default

    const p8_draw_command *commands = p8_core_draw_data(core);
    assert(p8_core_draw_count(core) == 11);
    assert(commands[0].opcode == P8_DRAW_LINE && commands[0].args[4] == 8 << 16);
    assert(commands[1].opcode == P8_DRAW_PSET && commands[1].args[2] == 9 << 16);
    assert(commands[2].opcode == P8_DRAW_PSET && commands[2].args[2] == 8 << 16);
    assert(commands[3].opcode == P8_DRAW_RECT && commands[3].args[4] == 8 << 16);
    assert(commands[4].opcode == P8_DRAW_CIRCFILL && commands[4].args[3] == 8 << 16);
    assert(commands[5].opcode == P8_DRAW_PRINT && commands[5].args[2] == 8 << 16);
    assert(commands[6].opcode == P8_DRAW_PRINT && commands[6].args[2] == 12 << 16);
    assert(commands[7].opcode == P8_DRAW_PSET && commands[7].args[2] == 12 << 16);
    assert(commands[8].opcode == P8_DRAW_PRINT && commands[8].args[2] == 13 << 16);
    assert(commands[9].opcode == P8_DRAW_PSET && commands[9].args[2] == 13 << 16);
    assert(commands[10].opcode == P8_DRAW_PSET && commands[10].args[2] == 6 << 16);

    assert(p8_vm_call(vm, "leave_non_default_color"));
    constexpr char reload_source[] = R"p8lua(
function verify_reload_default() pset(20,20) end
)p8lua";
    assert(p8_vm_load_source(vm, reload_source, sizeof(reload_source) - 1,
                             "@draw-color-reload-test"));
    assert(p8_vm_call(vm, "verify_reload_default"));
    assert(p8_gfx_pget(core, 20, 20) == 6);

    p8_vm_destroy(vm);
    p8_core_destroy(core);
}

void test_update_error_is_sticky_and_draw_is_skipped()
{
    constexpr char source[] = R"p8lua(
drawn=0
function _update() missing_runtime_api() end
function _draw() drawn+=1 end
)p8lua";
    std::array<uint8_t, P8_ROM_SIZE> rom{};
    p8_core *core = p8_core_create();
    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    p8_vm *vm = p8_vm_create(core);
    assert(vm);
    assert(p8_vm_load_source(vm, source, sizeof(source) - 1, "@sticky-error-test"));
    assert(p8_core_host_tick60(core, 1) == 1);
    const std::string first_error = p8_vm_last_error(vm);
    assert(first_error.find("missing_runtime_api") != std::string::npos);
    int32_t drawn = -1;
    assert(p8_vm_get_global_raw(vm, "drawn", &drawn) && drawn == 0);
    assert(p8_core_host_tick60(core, 1) == 0);
    assert(p8_core_host_tick60(core, 1) == 1);
    assert(std::string(p8_vm_last_error(vm)) == first_error);
    assert(p8_vm_get_global_raw(vm, "drawn", &drawn) && drawn == 0);
    p8_vm_destroy(vm);
    p8_core_destroy(core);
}

void test_audio_stat_routes_fail_closed_until_official_tick_history_is_qualified()
{
    constexpr char music_state_source[] = R"p8lua(
function _init()
 before=stat(57)
 music(0)
 during=stat(57)
 music(-1)
 after=stat(57)
end
)p8lua";
    std::array<uint8_t, P8_ROM_SIZE> rom{};
    p8_core *core = p8_core_create();
    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    p8_vm *vm = p8_vm_create(core);
    assert(vm);
    assert(p8_vm_load_source(vm, music_state_source, sizeof(music_state_source) - 1,
                             "@audio-music-state"));
    assert(p8_vm_call(vm, "_init"));
    int value = -1;
    assert(p8_vm_get_global_boolean(vm, "before", &value) && value == 0);
    assert(p8_vm_get_global_boolean(vm, "during", &value) && value == 1);
    assert(p8_vm_get_global_boolean(vm, "after", &value) && value == 0);
    p8_vm_destroy(vm);
    p8_core_destroy(core);

    constexpr char source[] = R"p8lua(
function _init() observed=stat(46) end
)p8lua";
    core = p8_core_create();
    vm = p8_vm_create(core);
    assert(vm);
    assert(p8_vm_load_source(vm, source, sizeof(source) - 1, "@audio-stat-gate"));
    assert(!p8_vm_call(vm, "_init"));
    assert(std::strstr(p8_vm_last_error(vm),
                       "audio selector 46 is not conformance-qualified") != nullptr);
    p8_vm_destroy(vm);
    p8_core_destroy(core);
}

} // namespace

int main(int argc, char **argv)
{
    const std::vector<uint8_t> checkpoint = test_synthetic_cart_updates_raster_and_semantic_stream();
    test_pico_button_glyph_constants_map_to_all_six_buttons();
    test_unicode_source_glyphs_execute_as_p8scii_byte_strings();
    test_holdframe_defers_presentation_until_the_next_host_frame();
    test_flip_suspends_and_resumes_initialization_at_frame_boundaries();
    test_menu_items_register_filter_invoke_update_and_remove();
    test_palette_transparency_diagnostics_and_deterministic_time();
    test_current_draw_color_is_shared_by_primitives_print_and_sprite_sheet();
    test_update_error_is_sticky_and_draw_is_skipped();
    test_audio_stat_routes_fail_closed_until_official_tick_history_is_qualified();
    if (argc == 2 && std::string(argv[1]) == "--checkpoint") {
        for (uint8_t byte : checkpoint) std::printf("%02x", byte);
        std::putchar('\n');
    } else {
        std::puts("p8 VM tests: ok");
    }
    return 0;
}
