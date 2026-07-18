#include "p8/core.h"
#include "p8/audio.h"
#include "p8/raster.h"
#include "p8/text.h"
#include "p8/vm.h"

#include <algorithm>
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

std::string read_fixture(const char *name = "synthetic_cart.lua")
{
    std::ifstream input(std::string("tests/fixtures/") + name, std::ios::binary);
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
    append_u32(checkpoint, p8_audio_diagnostic_flags(core));
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

std::vector<uint8_t> test_custom_audio_fixture_is_explicit_and_hashable()
{
    const std::string source = read_fixture("custom_audio_cart.lua");
    std::array<uint8_t, P8_ROM_SIZE> rom{};
    p8_core *core = p8_core_create();
    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    assert(p8_audio_set_diagnostic_mask(core, P8_AUDIO_DIAGNOSTIC_CUSTOM_INSTRUMENT));
    p8_vm *vm = p8_vm_create(core);
    assert(vm);
    assert(p8_vm_load_source(vm, source.data(), source.size(), "@custom-audio-fixture"));
    assert(p8_vm_call(vm, "_init"));
    assert(p8_core_host_tick60(core, 1) == 1);

    std::vector<uint8_t> checkpoint;
    std::array<int16_t, 367> audio{};
    const size_t count = p8_audio_read(core, audio.data(), audio.size());
    append_u32(checkpoint, static_cast<uint32_t>(count));
    for (size_t index = 0; index < count; ++index) {
        append_u16(checkpoint, static_cast<uint16_t>(audio[index]));
    }
    append_u32(checkpoint, p8_audio_capabilities(core));
    append_u32(checkpoint, p8_audio_diagnostic_flags(core));
    std::array<p8_audio_event, 8> events{};
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
    assert(count == audio.size());
    assert(std::any_of(audio.begin(), audio.end(), [](int16_t sample) { return sample != 0; }));
    assert(p8_audio_diagnostic_flags(core) == P8_AUDIO_DIAGNOSTIC_CUSTOM_INSTRUMENT);
    assert(event_count >= 2 && events[0].kind == P8_AUDIO_EVENT_DIAGNOSTIC_CUSTOM_AUDIO);
    p8_vm_destroy(vm);
    p8_core_destroy(core);
    return checkpoint;
}

std::vector<uint8_t> test_text_ir_fixture_is_canonical_and_hashable()
{
    constexpr char source[] =
        "function _init() local s=chr(6) local g=s..':ff818181818181ff' "
        "print(g,0,0,7) poke(0x5600,8,8,8,0,0,0,4,0) "
        "poke(0x5680,1,2,4,8,16,32,64,128) "
        "print(chr(14)..chr(16)..chr(15),30,0,6) end "
        "function _update() print('u',1,10,7) end "
        "function _draw() print('d',2,10,7) end\n";
    std::array<uint8_t, P8_ROM_SIZE> rom{};
    p8_core *core = p8_core_create();
    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    p8_vm *vm = p8_vm_create(core);
    assert(vm);
    assert(p8_vm_load_source(vm, source, sizeof(source) - 1, "@text-ir-fixture"));
    assert(p8_vm_call(vm, "_init"));
    const uint8_t *stream = p8_core_text_ir_data(core);
    const size_t size = p8_core_text_ir_size(core);
    assert(stream && size > 12 && stream[0] == 'A' && stream[1] == '8'
           && stream[2] == 'T' && stream[3] == 'R');
    assert(stream[8] == 2 && stream[9] == 0 && stream[10] == 0 && stream[11] == 0);
    std::vector<uint8_t> checkpoint(stream, stream + size);
    assert(p8_core_host_tick60(core, 1) == 1);
    stream = p8_core_text_ir_data(core);
    assert(stream[8] == 2 && stream[9] == 0 && stream[10] == 0 && stream[11] == 0);
    p8_vm_destroy(vm);
    p8_core_destroy(core);
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

void test_sub_ignores_a_non_numeric_end_position()
{
    constexpr char source[] = R"p8lua(
function _init()
 local explicit_range=sub("abcd",2,2)
 local truthy_end=sub("abcd",2,true)
 local falsey_end=sub("abcd",2,false)
 explicit_range_length=#explicit_range
 truthy_end_length=#truthy_end
 falsey_end_length=#falsey_end
 truthy_end_last=ord(truthy_end,3)
 falsey_end_last=ord(falsey_end,3)
end
)p8lua";
    p8_core *core = p8_core_create();
    p8_vm *vm = p8_vm_create(core);
    assert(vm);
    assert(p8_vm_load_source(vm, source, sizeof(source) - 1, "@sub-end-test"));
    assert(p8_vm_call(vm, "_init"));

    int32_t value = 0;
    assert(p8_vm_get_global_raw(vm, "explicit_range_length", &value) && value == 1 << 16);
    assert(p8_vm_get_global_raw(vm, "truthy_end_length", &value) && value == 3 << 16);
    assert(p8_vm_get_global_raw(vm, "falsey_end_length", &value) && value == 3 << 16);
    assert(p8_vm_get_global_raw(vm, "truthy_end_last", &value) && value == ('d' << 16));
    assert(p8_vm_get_global_raw(vm, "falsey_end_last", &value) && value == ('d' << 16));

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
 extcmd("set_filename","host-api-test")
 extcmd("screen",1,1)
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
           == "boot 0\n"
              "extcmd(rec): recording is unavailable in this host; gameplay continued\n"
              "extcmd(set_filename): host capture is unavailable; compatibility state continued\n"
              "extcmd(screen): host capture is unavailable; compatibility state continued\n");
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
 print("a",0,-20)
 print("b",1,-20,12)
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

void test_tline_api_tracks_precision_and_draws_from_map_samples()
{
    constexpr char source[] = R"p8lua(
function draw_tlines()
 tline(0,30,7,30,0,0)
 poke(0x5f38,1) poke(0x5f3a,1)
 tline(0,31,7,31,0,0)
 poke(0x5f38,0) poke(0x5f3a,0)
 tline(16)
 tline(0,32,7,32,0,0,1,0)
end
)p8lua";
    std::array<uint8_t, P8_ROM_SIZE> rom{};
    p8_core *core = p8_core_create();
    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    for (int pixel = 0; pixel < 8; ++pixel) {
        p8_gfx_sset(core, 8 + pixel, 0, static_cast<uint8_t>(pixel + 1));
        p8_gfx_sset(core, 16 + pixel, 0, static_cast<uint8_t>(pixel + 8));
    }
    p8_core_mset(core, 0, 0, 1);
    p8_core_mset(core, 1, 0, 2);
    p8_vm *vm = p8_vm_create(core);
    assert(vm);
    assert(p8_vm_load_source(vm, source, sizeof(source) - 1, "@tline-test"));
    p8_core_begin_draw_stream(core);
    assert(p8_vm_call(vm, "draw_tlines"));
    for (int pixel = 0; pixel < 8; ++pixel) {
        assert(p8_gfx_pget(core, pixel, 30) == pixel + 1);
        assert(p8_gfx_pget(core, pixel, 31) == ((pixel + 8) & 0x0f));
        assert(p8_gfx_pget(core, pixel, 32) == pixel + 1);
    }
    const p8_draw_command *commands = p8_core_draw_data(core);
    assert(p8_core_draw_count(core) == 4);
    assert(commands[0].opcode == P8_DRAW_TLINE && commands[0].args[6] == 0x2000);
    assert(commands[0].args[9] == 13 << 16);
    assert(commands[2].flags == 1 && commands[2].args[0] == 16 << 16);
    assert(commands[3].args[6] == 1 << 16 && commands[3].args[9] == 16 << 16);
    p8_vm_destroy(vm);
    p8_core_destroy(core);
}

void test_static_p8scii_executes_pixels_metrics_memory_and_custom_fonts()
{
    constexpr char source[] = R"p8lua(
function verify_p8scii()
 local special=chr(6)
 local glyph=special..":ff818181818181ff"
 cls(0)
 inline_width=print(glyph,0,0,7)
 inline_00=pget(0,0) inline_11=pget(1,1)
 repeat_width=print(chr(1).."3".."a",0,10,7)
 terminate_width=print(glyph..chr(0)..glyph,0,20,7)
 print(chr(12).."8"..glyph,10,0,7)
 foreground_pixel=pget(10,0) foreground_state=peek(0x5f25)
 print(chr(2).."4"..glyph,20,0,7)
 background_on=pget(20,0) background_off=pget(21,1)
 absolute_width=print(special.."j23"..glyph,0,0,7)
 absolute_pixel=pget(8,12)
 print(special.."@43000004".."abcd",0,-20,7)
 memory_0=peek(0x4300) memory_1=peek(0x4301)
 memory_2=peek(0x4302) memory_3=peek(0x4303)
 poke(0x5600,8,8,8,0,0,0,4,0)
 poke(0x5680,1,2,4,8,16,32,64,128)
 custom_width=print(chr(14)..chr(16)..chr(15),30,0,6)
 custom_00=pget(30,0) custom_10=pget(31,0) custom_77=pget(37,7)
 print(special.."o8ff"..":",50,1,3)
 outline_outer=pget(50,1) outline_inner=pget(51,2)
 print(special.."u"..":",60,1,3)
 underline_pixel=pget(59,7)
end
)p8lua";
    std::array<uint8_t, P8_ROM_SIZE> rom{};
    p8_core *core = p8_core_create();
    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    p8_vm *vm = p8_vm_create(core);
    assert(vm && p8_vm_load_source(vm, source, sizeof(source) - 1, "@p8scii-static"));
    assert(p8_vm_call(vm, "verify_p8scii"));
    const auto raw = [vm](const char *name) {
        int32_t value = 0;
        assert(p8_vm_get_global_raw(vm, name, &value));
        return value >> 16;
    };
    assert(raw("inline_width") == 8 && raw("inline_00") == 7 && raw("inline_11") == 0);
    assert(raw("repeat_width") == 12 && raw("terminate_width") == 8);
    assert(raw("foreground_pixel") == 8 && raw("foreground_state") == 8);
    assert(raw("background_on") == 7 && raw("background_off") == 4);
    assert(raw("absolute_width") == 16 && raw("absolute_pixel") == 7);
    assert(raw("memory_0") == 97 && raw("memory_1") == 98
           && raw("memory_2") == 99 && raw("memory_3") == 100);
    assert(raw("custom_width") == 38 && raw("custom_00") == 6
           && raw("custom_10") == 0 && raw("custom_77") == 6);
    assert(raw("outline_outer") == 8 && raw("outline_inner") == 3);
    assert(raw("underline_pixel") == 3);
    p8_vm_destroy(vm);
    p8_core_destroy(core);

    constexpr char unsupported_source[] = R"p8lua(
function reject_audio_text() print(chr(7).."12",0,0,7) end
)p8lua";
    core = p8_core_create();
    vm = p8_vm_create(core);
    assert(vm && p8_vm_load_source(vm, unsupported_source,
        sizeof(unsupported_source) - 1, "@p8scii-unsupported"));
    p8_gfx_pset(core, 0, 0, 5);
    assert(!p8_vm_call(vm, "reject_audio_text"));
    assert(std::strstr(p8_vm_last_error(vm), "not conformance-qualified") != nullptr);
    assert(p8_gfx_pget(core, 0, 0) == 5);
    p8_vm_destroy(vm);
    p8_core_destroy(core);

    constexpr char top_level_delay_source[] = R"p8lua(
local special=chr(6)
print(special.."d1"..special..":ff818181818181ff",0,0,7)
)p8lua";
    core = p8_core_create();
    vm = p8_vm_create(core);
    p8_gfx_pset(core, 0, 0, 5);
    assert(vm && !p8_vm_load_source(vm, top_level_delay_source,
        sizeof(top_level_delay_source) - 1, "@p8scii-top-level-delay"));
    assert(std::strstr(p8_vm_last_error(vm),
                       "requires the host-resumable cart callback")
           != nullptr);
    assert(p8_gfx_pget(core, 0, 0) == 5);
    p8_vm_destroy(vm);
    p8_core_destroy(core);

    constexpr char nested_delay_source[] = R"p8lua(
local special=chr(6)
local worker=cocreate(function()
 print(special.."d1"..special..":ff818181818181ff",0,0,7)
end)
function reject_nested_delay()
 nested_ok,nested_error=coresume(worker)
end
)p8lua";
    core = p8_core_create();
    vm = p8_vm_create(core);
    p8_gfx_pset(core, 0, 0, 5);
    assert(vm && p8_vm_load_source(vm, nested_delay_source,
        sizeof(nested_delay_source) - 1, "@p8scii-nested-delay"));
    assert(p8_vm_call(vm, "reject_nested_delay"));
    int nested_ok = 1;
    assert(p8_vm_get_global_boolean(vm, "nested_ok", &nested_ok) && !nested_ok);
    std::array<char, 160> nested_error{};
    assert(p8_vm_copy_global_string(vm, "nested_error", nested_error.data(),
                                    nested_error.size()) > 0);
    assert(std::strstr(nested_error.data(), "host-resumable cart callback") != nullptr);
    assert(p8_gfx_pget(core, 0, 0) == 5);
    p8_vm_destroy(vm);
    p8_core_destroy(core);
}

void test_p8scii_delay_controls_resume_on_exact_frame_boundaries()
{
    constexpr char source[] = R"p8lua(
local special=chr(6)
local glyph=special..":ff818181818181ff"
phase=0
function delayed_characters()
 cls(0)
 phase=1
 delayed_width=print(special.."d1"..glyph..glyph,0,0,7)
 phase=2
end
function skipped_frames()
 cls(0)
 phase=3
 skipped_width=print(glyph..special.."2"..glyph,0,12,7)
 phase=4
end
)p8lua";
    std::array<uint8_t, P8_ROM_SIZE> rom{};
    p8_core *core = p8_core_create();
    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    p8_vm *vm = p8_vm_create(core);
    assert(vm && p8_vm_load_source(vm, source, sizeof(source) - 1,
                                   "@p8scii-delay"));

    int32_t value = 0;
    p8_core_begin_draw_stream(core);
    assert(p8_vm_call(vm, "delayed_characters"));
    assert(p8_vm_call_pending(vm));
    assert(p8_core_draw_count(core) == 2);
    assert(p8_vm_get_global_raw(vm, "phase", &value) && value == 1 << 16);
    assert(p8_gfx_pget(core, 0, 0) == 7);
    assert(p8_gfx_pget(core, 8, 0) == 0);

    assert(p8_vm_update(vm));
    assert(p8_vm_call_pending(vm));
    assert(p8_core_draw_count(core) == 1);
    assert(p8_vm_get_global_raw(vm, "phase", &value) && value == 1 << 16);
    assert(p8_gfx_pget(core, 8, 0) == 7);

    assert(p8_vm_update(vm));
    assert(!p8_vm_call_pending(vm));
    assert(p8_core_draw_count(core) == 1);
    assert(p8_vm_get_global_raw(vm, "phase", &value) && value == 2 << 16);
    assert(p8_vm_get_global_raw(vm, "delayed_width", &value) && value == 16 << 16);

    p8_core_begin_draw_stream(core);
    assert(p8_vm_call(vm, "skipped_frames"));
    assert(p8_vm_call_pending(vm));
    assert(p8_gfx_pget(core, 0, 12) == 7);
    assert(p8_gfx_pget(core, 8, 12) == 0);
    assert(p8_vm_update(vm));
    assert(p8_vm_call_pending(vm));
    assert(p8_gfx_pget(core, 8, 12) == 0);
    assert(p8_vm_update(vm));
    assert(!p8_vm_call_pending(vm));
    assert(p8_gfx_pget(core, 8, 12) == 7);
    assert(p8_vm_get_global_raw(vm, "phase", &value) && value == 4 << 16);
    assert(p8_vm_get_global_raw(vm, "skipped_width", &value) && value == 16 << 16);

    p8_vm_destroy(vm);
    p8_core_destroy(core);
}

void test_secondary_palette_reaches_sprite_and_global_raster_through_lua()
{
    constexpr char source[] = R"p8lua(
function verify_secondary_palette()
 cls(0)
 fillp()
 pal()
 palt()
 for i=0,15 do pal(i,i+i*16,2) end
 pal(12,0x87,2)
 sset(0,0,12)
 sset(1,0,12)
 fillp(32768.25)
 spr(0,12,0)
 sprite_high=pget(12,0)
 sprite_low=pget(13,0)
 fillp(32768.125)
 rectfill(20,0,21,0,12)
 global_high=pget(20,0)
 global_low=pget(21,0)
 pal(3,12)
 rectfill(24,0,25,0,3)
 remapped_high=pget(24,0)
 remapped_low=pget(25,0)
 pal(2)
 rectfill(28,0,29,0,3)
 reset_high=pget(28,0)
 reset_low=pget(29,0)
end
)p8lua";
    std::array<uint8_t, P8_ROM_SIZE> rom{};
    p8_core *core = p8_core_create();
    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    p8_vm *vm = p8_vm_create(core);
    assert(vm && p8_vm_load_source(vm, source, sizeof(source) - 1,
                                   "@secondary-palette"));
    assert(p8_vm_call(vm, "verify_secondary_palette"));
    const auto integer_global = [vm](const char *name) {
        int32_t raw = 0;
        assert(p8_vm_get_global_raw(vm, name, &raw));
        return raw >> 16;
    };
    assert(integer_global("sprite_high") == 8);
    assert(integer_global("sprite_low") == 7);
    assert(integer_global("global_high") == 8);
    assert(integer_global("global_low") == 7);
    assert(integer_global("remapped_high") == 8);
    assert(integer_global("remapped_low") == 7);
    assert(integer_global("reset_high") == 12);
    assert(integer_global("reset_low") == 12);
    p8_vm_destroy(vm);
    p8_core_destroy(core);
}

void test_embedded_colour_patterns_and_inversion_reach_raster_through_lua()
{
    constexpr char source[] = R"p8lua(
function verify_embedded_fill()
 pal() fillp() cls(0)
 poke(0x5f34,1)
 rectfill(0,10,3,13,0x104e.abcd)
 reg_low=peek(0x5f31) reg_high=peek(0x5f32) reg_flags=peek(0x5f33)
 row_0=pget(0,10) row_1=pget(1,10) row_2=pget(2,10) row_3=pget(3,10)
 fillp() color(0x104e.abcd) rectfill(0,14,3,14)
 current_color=peek(0x5f25) current_0=pget(0,14) current_1=pget(1,14)
 fillp() cls(1) clip(0,20,8,8) poke(0x5f34,2)
 circfill(3,23,1,0x1808.0000)
 outside=pget(0,20) inside=pget(3,23)
 clip() poke(0x5f34,1) cls(1)
 rectfill(2,2,3,3,0x1808.0000)
 embedded_outside=pget(0,0) embedded_inside=pget(2,2)
 setting_after=peek(0x5f34)
end
)p8lua";
    std::array<uint8_t, P8_ROM_SIZE> rom{};
    p8_core *core = p8_core_create();
    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    p8_vm *vm = p8_vm_create(core);
    assert(vm && p8_vm_load_source(vm, source, sizeof(source) - 1,
                                   "@embedded-fill"));
    assert(p8_vm_call(vm, "verify_embedded_fill"));
    const auto integer_global = [vm](const char *name) {
        int32_t raw = 0;
        assert(p8_vm_get_global_raw(vm, name, &raw));
        return raw >> 16;
    };
    assert(integer_global("reg_low") == 0xcd);
    assert(integer_global("reg_high") == 0xab);
    assert(integer_global("reg_flags") == 0);
    assert(integer_global("row_0") == 4 && integer_global("row_1") == 4);
    assert(integer_global("row_2") == 14 && integer_global("row_3") == 14);
    assert(integer_global("current_color") == 0x4e);
    assert(integer_global("current_0") == 4 && integer_global("current_1") == 4);
    assert(integer_global("outside") == 8 && integer_global("inside") == 1);
    assert(integer_global("embedded_outside") == 8);
    assert(integer_global("embedded_inside") == 1);
    assert(integer_global("setting_after") == 1);
    p8_vm_destroy(vm);
    p8_core_destroy(core);
}

void test_map_sprite_zero_read_overrides_and_extended_display_palette_reach_lua()
{
    constexpr char source[] = R"p8lua(
function verify_raster_register_modes()
 sset(0,0,7) mset(0,0,0) cls(6)
 map(0,0,0,0,1,1) skipped=pget(0,0)
 poke(0x5f36,8) map(0,0,0,0,1,1) drawn=pget(0,0)
 poke(0x5f59,9) poke(0x5f5a,10) poke(0x5f5b,11) poke(0x5f36,0x18)
 sget_oob=sget(-1,0) mget_oob=mget(-1,0) pget_oob=pget(-1,0)
 pal(7,143,1)
end
)p8lua";
    std::array<uint8_t, P8_ROM_SIZE> rom{};
    p8_core *core = p8_core_create();
    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    p8_vm *vm = p8_vm_create(core);
    assert(vm && p8_vm_load_source(vm, source, sizeof(source) - 1,
                                   "@raster-register-modes"));
    assert(p8_vm_call(vm, "verify_raster_register_modes"));
    const auto integer_global = [vm](const char *name) {
        int32_t raw = 0;
        assert(p8_vm_get_global_raw(vm, name, &raw));
        return raw >> 16;
    };
    assert(integer_global("skipped") == 6);
    assert(integer_global("drawn") == 7);
    assert(integer_global("sget_oob") == 9);
    assert(integer_global("mget_oob") == 10);
    assert(integer_global("pget_oob") == 11);
    assert(p8_core_peek(core, 0x5f17) == 143);
    p8_vm_destroy(vm);
    p8_core_destroy(core);
}

void test_ellipse_and_rounded_rectangle_apis_reach_raster_and_draw_stream()
{
    constexpr char source[] = R"p8lua(
function verify_curved_primitives()
 cls(0)
 oval(10,10,14,12,8) oval_top=pget(12,10)
 ovalfill(20,20,26,24,9) oval_center=pget(23,22)
 rrectfill(30,30,6,4,2,10) rounded_corner=pget(30,30) rounded_top=pget(32,30)
 rrect(40,30,6,4,99,11) outline_side=pget(40,31) outline_center=pget(42,31)
 poke(0x5f34,3) cls(1) clip(0,0,8,8)
 ovalfill(2,2,5,5,0x1808.0000)
 oval_inverted_inside=pget(3,3) oval_inverted_outside=pget(0,0)
 cls(1) clip(0,0,8,8)
 rrectfill(2,2,4,4,1,0x1809.0000)
 rounded_inverted_inside=pget(3,3) rounded_inverted_outside=pget(0,0)
end
)p8lua";
    std::array<uint8_t, P8_ROM_SIZE> rom{};
    p8_core *core = p8_core_create();
    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    p8_vm *vm = p8_vm_create(core);
    assert(vm && p8_vm_load_source(vm, source, sizeof(source) - 1,
                                   "@curved-primitives"));
    assert(p8_vm_call(vm, "verify_curved_primitives"));
    const auto integer_global = [vm](const char *name) {
        int32_t raw = 0;
        assert(p8_vm_get_global_raw(vm, name, &raw));
        return raw >> 16;
    };
    assert(integer_global("oval_top") == 8);
    assert(integer_global("oval_center") == 9);
    assert(integer_global("rounded_corner") == 0);
    assert(integer_global("rounded_top") == 10);
    assert(integer_global("outline_side") == 11);
    assert(integer_global("outline_center") == 0);
    assert(integer_global("oval_inverted_inside") == 1);
    assert(integer_global("oval_inverted_outside") == 8);
    assert(integer_global("rounded_inverted_inside") == 1);
    assert(integer_global("rounded_inverted_outside") == 9);

    bool saw_oval = false;
    bool saw_ovalfill = false;
    bool saw_rrect = false;
    bool saw_rrectfill = false;
    const p8_draw_command *commands = p8_core_draw_data(core);
    for (size_t index = 0; index < p8_core_draw_count(core); ++index) {
        saw_oval |= commands[index].opcode == P8_DRAW_OVAL;
        saw_ovalfill |= commands[index].opcode == P8_DRAW_OVALFILL;
        saw_rrect |= commands[index].opcode == P8_DRAW_RRECT;
        saw_rrectfill |= commands[index].opcode == P8_DRAW_RRECTFILL;
    }
    assert(saw_oval && saw_ovalfill && saw_rrect && saw_rrectfill);
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

void test_audio_stat_exposes_current_pattern_but_keeps_tick_history_fail_closed()
{
    constexpr char music_state_source[] = R"p8lua(
function _init()
 pattern_before_legacy=stat(24)
 pattern_before_current=stat(54)
 before=stat(57)
 music(0)
 pattern_during_legacy=stat(24)
 pattern_during_current=stat(54)
 during=stat(57)
 music(-1)
 pattern_after_legacy=stat(24)
 pattern_after_current=stat(54)
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
    int32_t raw = 0;
    assert(p8_vm_get_global_raw(vm, "pattern_before_legacy", &raw) && raw == -65536);
    assert(p8_vm_get_global_raw(vm, "pattern_before_current", &raw) && raw == -65536);
    assert(p8_vm_get_global_raw(vm, "pattern_during_legacy", &raw) && raw == 0);
    assert(p8_vm_get_global_raw(vm, "pattern_during_current", &raw) && raw == 0);
    assert(p8_vm_get_global_raw(vm, "pattern_after_legacy", &raw) && raw == -65536);
    assert(p8_vm_get_global_raw(vm, "pattern_after_current", &raw) && raw == -65536);
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
    const std::vector<uint8_t> custom_audio_checkpoint =
        test_custom_audio_fixture_is_explicit_and_hashable();
    const std::vector<uint8_t> text_ir_checkpoint =
        test_text_ir_fixture_is_canonical_and_hashable();
    test_pico_button_glyph_constants_map_to_all_six_buttons();
    test_unicode_source_glyphs_execute_as_p8scii_byte_strings();
    test_sub_ignores_a_non_numeric_end_position();
    test_holdframe_defers_presentation_until_the_next_host_frame();
    test_flip_suspends_and_resumes_initialization_at_frame_boundaries();
    test_menu_items_register_filter_invoke_update_and_remove();
    test_palette_transparency_diagnostics_and_deterministic_time();
    test_current_draw_color_is_shared_by_primitives_print_and_sprite_sheet();
    test_tline_api_tracks_precision_and_draws_from_map_samples();
    test_static_p8scii_executes_pixels_metrics_memory_and_custom_fonts();
    test_p8scii_delay_controls_resume_on_exact_frame_boundaries();
    test_secondary_palette_reaches_sprite_and_global_raster_through_lua();
    test_embedded_colour_patterns_and_inversion_reach_raster_through_lua();
    test_map_sprite_zero_read_overrides_and_extended_display_palette_reach_lua();
    test_ellipse_and_rounded_rectangle_apis_reach_raster_and_draw_stream();
    test_update_error_is_sticky_and_draw_is_skipped();
    test_audio_stat_exposes_current_pattern_but_keeps_tick_history_fail_closed();
    if (argc == 2 && (std::string(argv[1]) == "--checkpoint"
                       || std::string(argv[1]) == "--custom-audio-checkpoint"
                       || std::string(argv[1]) == "--text-ir-checkpoint")) {
        const std::string selector = argv[1];
        const std::vector<uint8_t> &selected = selector == "--checkpoint" ? checkpoint
            : selector == "--custom-audio-checkpoint" ? custom_audio_checkpoint
                                                       : text_ir_checkpoint;
        for (uint8_t byte : selected) std::printf("%02x", byte);
        std::putchar('\n');
    } else {
        std::puts("p8 VM tests: ok");
    }
    return 0;
}
