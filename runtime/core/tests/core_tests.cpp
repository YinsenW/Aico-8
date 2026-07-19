#include "p8/core.h"
#include "p8/audio.h"
#include "p8/raster.h"
#include "p8/text.h"

#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <cstdio>
#include <initializer_list>
#include <limits>

namespace {

uint16_t read_u16(const uint8_t *bytes, size_t offset)
{
    return static_cast<uint16_t>(bytes[offset]
        | (static_cast<uint16_t>(bytes[offset + 1]) << 8u));
}

uint32_t read_u32(const uint8_t *bytes, size_t offset)
{
    return static_cast<uint32_t>(bytes[offset])
        | (static_cast<uint32_t>(bytes[offset + 1]) << 8u)
        | (static_cast<uint32_t>(bytes[offset + 2]) << 16u)
        | (static_cast<uint32_t>(bytes[offset + 3]) << 24u);
}

void write_sfx_note(std::array<uint8_t, P8_ROM_SIZE> &rom, unsigned sfx,
                    unsigned note, uint8_t key, uint8_t waveform,
                    uint8_t volume, uint8_t effect, bool custom = false)
{
    const size_t address = 0x3200 + sfx * 68 + note * 2;
    rom[address] = static_cast<uint8_t>((key & 0x3f) | ((waveform & 0x03) << 6));
    rom[address + 1] = static_cast<uint8_t>(((waveform >> 2) & 0x01)
        | ((volume & 0x07) << 1) | ((effect & 0x07) << 4)
        | (custom ? 0x80 : 0));
}

struct callback_trace {
    int updates = 0;
    int updates60 = 0;
    int draws = 0;
};

void update(void *userdata) { ++static_cast<callback_trace *>(userdata)->updates; }
void update60(void *userdata) { ++static_cast<callback_trace *>(userdata)->updates60; }
void draw(void *userdata) { ++static_cast<callback_trace *>(userdata)->draws; }

void test_rom_reset_and_memory_alias()
{
    std::array<uint8_t, P8_ROM_SIZE> rom{};
    rom[0x0000] = 0x12;
    rom[0x1000] = 0x34;
    rom[0x2000] = 0x56;
    rom[0x42ff] = 0x78;
    rom[0x4300] = 0x9a;

    p8_core *core = p8_core_create();
    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    assert(p8_core_peek(core, 0x0000) == 0x12);
    assert(p8_core_peek(core, 0x1000) == 0x34);
    assert(p8_core_peek(core, 0x2000) == 0x56);
    assert(p8_core_peek(core, 0x42ff) == 0x78);
    assert(p8_core_peek(core, 0x4300) == 0x00);

    p8_core_poke(core, 0x1000, 0xab);
    assert(p8_core_debug_peek_physical(core, 0x1000) == 0xab);
    p8_core_poke(core, 0x2000, 0xaa);
    p8_core_clear_dirty(core);
    assert(p8_core_reload(core, 0x2000, 0x1000, 2));
    assert(p8_core_peek(core, 0x2000) == 0x34);
    assert(p8_core_peek(core, 0x2001) == 0x00);
    assert(p8_core_is_dirty(core, 0x2000, 2));
    p8_core_poke(core, 0x2000, 0xbb);
    assert(!p8_core_reload(core, 0x2000, 0x42ff, 2));
    assert(p8_core_peek(core, 0x2000) == 0xbb);
    assert(p8_core_reload(core, 0x2000, 0x4300, 0));
    p8_core_reset(core);
    assert(p8_core_peek(core, 0x1000) == 0x34);
    p8_core_destroy(core);
}

void test_video_mapping_and_dirty_tracking()
{
    p8_core *core = p8_core_create();
    p8_core_poke(core, 0x0001, 0x11);
    p8_core_poke(core, 0x6001, 0x66);
    p8_core_clear_dirty(core);

    p8_core_poke(core, 0x5f54, 0x60);
    p8_core_poke(core, 0x5f55, 0x00);
    assert(p8_core_peek(core, 0x0001) == 0x66);
    assert(p8_core_peek(core, 0x6001) == 0x11);

    p8_core_poke(core, 0x0001, 0xa6);
    assert(p8_core_debug_peek_physical(core, 0x6001) == 0xa6);
    assert(p8_core_is_dirty(core, 0x0001, 1));
    p8_core_clear_dirty(core);
    assert(!p8_core_is_dirty(core, 0x0001, 1));
    p8_core_destroy(core);
}

void test_map_mapping_and_shared_gfx_alias()
{
    p8_core *core = p8_core_create();
    p8_core_poke(core, 0x2000, 0x20);
    p8_core_poke(core, 0x2fff, 0x2f);
    p8_core_poke(core, 0x1000, 0x10);
    assert(p8_core_mget(core, 0, 0) == 0x20);
    assert(p8_core_mget(core, 127, 31) == 0x2f);
    assert(p8_core_mget(core, 0, 32) == 0x10);

    p8_core_mset(core, 5, 32, 0xa5);
    assert(p8_core_peek(core, 0x1005) == 0xa5);
    assert(!p8_core_mset(core, 128, 0, 1));
    assert(p8_core_mget(core, -1, 0) == 0);

    p8_core_poke(core, 0x5f5a, 10);
    p8_core_poke(core, 0x5f36, 0x10);
    assert(p8_core_mget(core, -1, 0) == 10);
    assert(p8_core_mget(core, 0, 0) == 0x20); // in-range reads ignore the override
    p8_core_poke(core, 0x5f36, 0);
    assert(p8_core_mget(core, -1, 0) == 0);

    p8_core_poke(core, 0x5f56, 0x10);
    p8_core_poke(core, 0x5f57, 0); // 256 cells wide
    p8_core_mset(core, 255, 31, 0x31);
    assert(p8_core_debug_peek_physical(core, 0x2fff) == 0x31);
    assert(p8_core_mget(core, 0, 32) == 0); // largest map is 256x32

    p8_core_poke(core, 0x5f56, 0x80);
    p8_core_poke(core, 0x5f57, 128);
    p8_core_mset(core, 3, 1, 0x81);
    assert(p8_core_debug_peek_physical(core, 0x8083) == 0x81);
    assert(p8_core_mget(core, 3, 1) == 0x81);
    p8_core_destroy(core);
}

void test_little_endian_wrap_and_overlap()
{
    p8_core *core = p8_core_create();
    p8_core_poke32(core, 0x4301, 0x78563412u);
    assert(p8_core_peek32(core, 0x4301) == 0x78563412u);

    p8_core_poke16(core, 0xffff, 0xbeefu);
    assert(p8_core_peek(core, 0xffff) == 0xef);
    assert(p8_core_peek(core, 0x0000) == 0xbe);

    for (unsigned i = 0; i < 6; ++i) {
        p8_core_poke(core, static_cast<uint16_t>(0x4400 + i), static_cast<uint8_t>(i + 1));
    }
    p8_core_memcpy(core, 0x4402, 0x4400, 4);
    const uint8_t expected[] = {1, 2, 1, 2, 3, 4};
    for (unsigned i = 0; i < 6; ++i) {
        assert(p8_core_peek(core, static_cast<uint16_t>(0x4400 + i)) == expected[i]);
    }
    p8_core_destroy(core);
}

void test_btnp_is_latched_and_repeats()
{
    p8_core *core = p8_core_create();
    p8_core_set_buttons(core, 0, 1);
    p8_core_set_buttons(core, 1, 1u << 5);
    p8_core_set_buttons(core, 7, 1u << 2);
    for (unsigned tick = 1; tick <= 20; ++tick) {
        p8_core_begin_update(core);
        const bool expected = tick == 1 || tick == 16 || tick == 20;
        assert(static_cast<bool>(p8_core_btnp(core, 0, 0)) == expected);
        assert(static_cast<bool>(p8_core_btnp(core, 0, 0)) == expected);
        assert(p8_core_btn(core, 0, 0));
        assert(p8_core_btn_combined(core) == static_cast<uint16_t>(1u | (1u << 13)));
        assert(p8_core_peek(core, 0x5f53) == 1u << 2);
    }

    p8_core_set_buttons(core, 0, 0);
    p8_core_begin_update(core);
    assert(!p8_core_btn(core, 0, 0));
    p8_core_poke(core, 0x5f5c, 3);
    p8_core_poke(core, 0x5f5d, 2);
    p8_core_set_buttons(core, 0, 1);
    for (unsigned tick = 1; tick <= 8; ++tick) {
        p8_core_begin_update(core);
        const bool expected = tick == 1 || tick == 4 || tick == 6 || tick == 8;
        assert(static_cast<bool>(p8_core_btnp(core, 0, 0)) == expected);
    }
    p8_core_destroy(core);
}

void test_scheduler()
{
    p8_core *core = p8_core_create();
    callback_trace trace;
    const p8_core_callbacks callbacks{update, update60, draw, &trace};
    p8_core_set_callbacks(core, &callbacks);

    for (unsigned i = 0; i < 6; ++i) {
        p8_core_host_tick60(core, 1);
    }
    assert(trace.updates == 3 && trace.updates60 == 0 && trace.draws == 3);
    assert(p8_core_get_update_count(core) == 3);
    assert(std::abs(p8_core_time(core) - 0.1) < 1e-12);

    p8_core_set_time_origin_ticks60(core, 2);
    assert(p8_core_get_update_count(core) == 3);
    assert(std::abs(p8_core_time(core) - (0.1 + 1.0 / 30.0)) < 1e-12);
    assert(p8_core_time_raw(core) == static_cast<int32_t>((3ull * 0x10000ull) / 30
        + (2ull * 0x10000ull) / 60));

    p8_core_set_update_rate(core, 60);
    for (unsigned i = 0; i < 6; ++i) {
        p8_core_host_tick60(core, i != 2);
    }
    assert(trace.updates == 3 && trace.updates60 == 6 && trace.draws == 8);
    assert(p8_core_get_update_count(core) == 9);
    assert(std::abs(p8_core_time(core) - (0.15 + 1.0 / 30.0)) < 1e-12);
    p8_core_destroy(core);
}

void test_draw_stream()
{
    p8_core *core = p8_core_create();
    p8_draw_command command{};
    command.opcode = P8_DRAW_SPR;
    command.state_revision = 7;
    command.args[0] = 3 << 16;
    assert(p8_core_emit_draw(core, &command));
    const char text[] = "dust";
    assert(p8_core_emit_draw_payload(core, &command, text, 4));
    assert(p8_core_draw_count(core) == 2);
    assert(p8_core_draw_data(core)[0].sequence == 0);
    assert(p8_core_draw_data(core)[1].sequence == 1);
    assert(p8_core_draw_data(core)[1].payload_offset == 0);
    assert(p8_core_draw_data(core)[1].payload_size == 4);
    assert(p8_core_draw_payload_size(core) == 4);
    assert(p8_core_draw_payload_data(core)[2] == 's');
    p8_core_begin_draw_stream(core);
    assert(p8_core_draw_count(core) == 0);
    assert(p8_core_draw_payload_size(core) == 0);
    p8_core_destroy(core);
}

void test_text_ir_is_versioned_lossless_and_conservative()
{
    p8_core *core = p8_core_create();
    p8_core_begin_update(core);
    assert(p8_core_text_ir_size(core) == 12);
    const uint8_t *stream = p8_core_text_ir_data(core);
    assert(std::memcmp(stream, "A8TR", 4) == 0);
    assert(read_u16(stream, 4) == P8_TEXT_IR_SCHEMA_VERSION);
    assert(read_u16(stream, 6) == 12);
    assert(read_u32(stream, 8) == 0);

    constexpr uint8_t plain[] = {'d', 'u', 's', 't'};
    p8_text_result result{};
    assert(p8_text_print(core, plain, sizeof(plain), 4, 5, 8, 0, &result));
    stream = p8_core_text_ir_data(core);
    assert(read_u32(stream, 8) == 1);
    const size_t first = 12;
    assert(read_u16(stream, first + 4) == 112);
    assert(read_u16(stream, first + 6) == 1);
    assert(read_u32(stream, first + 8) == 0);
    assert(read_u32(stream, first + 20) == P8_TEXT_CLASS_SAFE_MODERN);
    assert(read_u32(stream, first + 24) == P8_TEXT_REASON_NONE);
    assert(read_u32(stream, first + 28) == P8_TEXT_EFFECT_CURSOR);
    assert(read_u32(stream, first + 32) == P8_TEXT_UNSUPPORTED_NONE);
    assert(static_cast<int32_t>(read_u32(stream, first + 36)) == 4);
    assert(static_cast<int32_t>(read_u32(stream, first + 40)) == 5);
    assert(static_cast<int32_t>(read_u32(stream, first + 52)) == result.cursor_x);
    assert(static_cast<int32_t>(read_u32(stream, first + 60)) == result.rightmost_x);
    assert(read_u32(stream, first + 72) > 0);
    assert(read_u32(stream, first + 76) > 0);
    assert(read_u32(stream, first + 108) == sizeof(plain));
    assert(read_u32(stream, first + 112) == 0);
    assert(read_u32(stream, first + 116) == sizeof(plain));
    assert(read_u32(stream, first + 120) == P8_TEXT_SPAN_VISUAL);
    assert(std::memcmp(stream + first + 132, plain, sizeof(plain)) == 0);

    constexpr uint8_t custom[] = {14, 'a', 15};
    assert(p8_text_print(core, custom, sizeof(custom), 20, 5, 6, 0, &result));
    stream = p8_core_text_ir_data(core);
    assert(read_u32(stream, 8) == 2);
    const size_t second = first + read_u32(stream, first);
    assert(read_u32(stream, second + 8) == 1);
    assert(read_u32(stream, second + 20) == P8_TEXT_CLASS_REVIEW_REQUIRED);
    assert((read_u32(stream, second + 24) & P8_TEXT_REASON_CUSTOM_FONT) != 0);
    assert((read_u32(stream, second + 28) & P8_TEXT_EFFECT_CUSTOM_FONT_STATE) != 0);
    assert(read_u32(stream, second + 92) != 0);
    assert(read_u32(stream, second + 96) == 0x5600);
    assert(read_u32(stream, second + 100) == 256);

    p8_core_begin_update(core);
    constexpr uint8_t delayed[] = {6, '1'};
    assert(p8_text_print(core, delayed, sizeof(delayed), 0, 0, 7, 0, &result));
    assert(result.unsupported == P8_TEXT_UNSUPPORTED_DELAY);
    stream = p8_core_text_ir_data(core);
    assert(read_u32(stream, 8) == 1);
    assert(read_u32(stream, 12 + 20) == P8_TEXT_CLASS_REFERENCE_ONLY);
    assert((read_u32(stream, 12 + 24) & P8_TEXT_REASON_UNSUPPORTED) != 0);
    assert((read_u32(stream, 12 + 28) & P8_TEXT_EFFECT_TIMING) != 0);
    assert(read_u32(stream, 12 + 32) == P8_TEXT_UNSUPPORTED_DELAY);
    assert(std::memcmp(stream + 12 + 112 + 20, delayed, sizeof(delayed)) == 0);
    p8_core_destroy(core);
}

void test_resumable_text_jobs_expose_exact_delay_budgets()
{
    p8_core *core = p8_core_create();
    for (uint8_t command = '1'; command <= '9'; ++command) {
        const uint8_t bytes[] = {6, command};
        p8_text_job *job = p8_text_job_create(core, bytes, sizeof(bytes),
                                               0, 0, 7, 0);
        assert(job);
        assert(p8_text_job_requires_frames(job));
        assert(p8_text_job_unsupported(job) == P8_TEXT_UNSUPPORTED_NONE);
        uint32_t wait_frames = 0;
        p8_text_result result{};
        assert(p8_text_job_step(job, &wait_frames, &result) == P8_TEXT_STEP_WAIT);
        assert(wait_frames == (1u << static_cast<unsigned>(command - '1')));
        assert(p8_text_job_step(job, &wait_frames, &result) == P8_TEXT_STEP_COMPLETE);
        assert(wait_frames == 0);
        p8_text_job_destroy(job);
    }

    constexpr uint8_t audio[] = {7, '1', '2'};
    p8_core_poke(core, 0x5f25, 3);
    p8_core_poke(core, 0x5f26, 9);
    p8_core_poke(core, 0x5f27, 10);
    p8_text_job *audio_job = p8_text_job_create(core, audio, sizeof(audio),
                                                 0, 0, 7, 0);
    assert(audio_job);
    assert(!p8_text_job_requires_frames(audio_job));
    assert(p8_text_job_unsupported(audio_job) == P8_TEXT_UNSUPPORTED_NONE);
    uint32_t wait_frames = 0;
    p8_text_result result{};
    assert(p8_text_job_step(audio_job, &wait_frames, &result) == P8_TEXT_STEP_COMPLETE);
    assert(result.unsupported == P8_TEXT_UNSUPPORTED_NONE);
    bool played_sfx_12 = false;
    for (unsigned channel = 0; channel < 4; ++channel) {
        played_sfx_12 |= p8_audio_current_sfx(core, channel) == 12;
    }
    assert(played_sfx_12);
    assert(p8_core_peek(core, 0x5f25) == 7);
    assert(p8_core_peek(core, 0x5f26) == 0);
    assert(p8_core_peek(core, 0x5f27) == 6);
    p8_text_job_destroy(audio_job);

    constexpr uint8_t generated[] = {7, 's', '4', 'x', '5', 'c', '1', 'e', 'g'};
    p8_text_result generated_result{};
    assert(p8_text_print(core, generated, sizeof(generated), 0, 0, 7, 0,
                         &generated_result));
    assert(generated_result.unsupported == P8_TEXT_UNSUPPORTED_NONE);
    int generated_sfx = -1;
    for (unsigned channel = 0; channel < 4; ++channel) {
        const int current = p8_audio_current_sfx(core, channel);
        if (current >= 60) generated_sfx = current;
    }
    assert(generated_sfx >= 60 && generated_sfx <= 63);
    const size_t generated_address = 0x3200 + static_cast<size_t>(generated_sfx) * 68;
    assert(p8_core_peek(core, static_cast<uint16_t>(generated_address + 65)) == 4);
    assert((p8_core_peek(core, static_cast<uint16_t>(generated_address)) & 0x3f) == 12);
    assert(((p8_core_peek(core, static_cast<uint16_t>(generated_address + 1)) >> 4)
            & 0x07) == 5);

    constexpr uint8_t malformed[] = {7, 's'};
    p8_core_poke(core, 0x5f25, 3);
    p8_text_result malformed_result{};
    assert(p8_text_print(core, malformed, sizeof(malformed), 0, 0, 7, 0,
                         &malformed_result));
    assert(malformed_result.unsupported == P8_TEXT_UNSUPPORTED_AUDIO);
    assert(p8_core_peek(core, 0x5f25) == 3);
    p8_core_destroy(core);
}

void test_raster_pixel_layout_and_draw_state()
{
    p8_core *core = p8_core_create();
    assert(p8_core_peek(core, 0x5f00) == 0x10); // colour 0 is transparent to sprites
    assert(p8_core_peek(core, 0x5f01) == 0x01);
    assert(p8_core_peek(core, 0x5f10) == 0x00);
    assert(p8_core_peek(core, 0x5f22) == P8_SCREEN_WIDTH);
    assert(p8_core_peek(core, 0x5f23) == P8_SCREEN_HEIGHT);

    p8_gfx_pset(core, 2, 3, 9);
    p8_gfx_pset(core, 3, 3, 10);
    assert(p8_gfx_pget(core, 2, 3) == 9);
    assert(p8_gfx_pget(core, 3, 3) == 10);
    assert(p8_core_debug_peek_physical(core, 0x6000 + 3 * 64 + 1) == 0xa9);
    assert(p8_gfx_pget(core, -1, 0) == 0);

    p8_gfx_pal(core, 9, 12);
    p8_gfx_pset(core, 4, 3, 9);
    assert(p8_gfx_pget(core, 4, 3) == 12);
    p8_gfx_palt(core, 9, 1);
    assert(p8_gfx_is_transparent(core, 9));
    p8_gfx_pset(core, 5, 3, 9); // palt is only observed by sprite-like operations
    assert(p8_gfx_pget(core, 5, 3) == 12);
    p8_gfx_palt_reset(core);
    assert(p8_gfx_is_transparent(core, 0));
    assert(!p8_gfx_is_transparent(core, 9));
    p8_gfx_pal(core, 2, 4);
    p8_gfx_cls(core, 2);
    assert(p8_gfx_pget(core, 100, 100) == 4);
    p8_gfx_pal_reset(core);
    p8_gfx_cls(core, 0);

    p8_gfx_camera(core, 10, 20);
    p8_gfx_pset(core, 10, 20, 7);
    p8_gfx_camera_reset(core);
    assert(p8_gfx_pget(core, 0, 0) == 7);

    p8_gfx_clip(core, 4, 4, 3, 3, 0);
    p8_gfx_pset(core, 3, 4, 8);
    p8_gfx_pset(core, 4, 4, 8);
    p8_gfx_pset(core, 6, 6, 8);
    p8_gfx_pset(core, 7, 6, 8);
    assert(p8_gfx_pget(core, 3, 4) == 0);
    assert(p8_gfx_pget(core, 4, 4) == 8);
    assert(p8_gfx_pget(core, 6, 6) == 8);
    assert(p8_gfx_pget(core, 7, 6) == 0);

    p8_gfx_clip(core, 5, 3, 4, 2, 1);
    assert(p8_core_peek(core, 0x5f20) == 5);
    assert(p8_core_peek(core, 0x5f21) == 4);
    assert(p8_core_peek(core, 0x5f22) == 2);
    assert(p8_core_peek(core, 0x5f23) == 1);
    p8_gfx_cls(core, 2);
    assert(p8_gfx_pget(core, 127, 127) == 2);
    p8_gfx_pset(core, 127, 127, 3); // cls resets clipping
    assert(p8_gfx_pget(core, 127, 127) == 3);
    p8_core_destroy(core);
}

void test_raster_sprite_alias_and_primitives()
{
    p8_core *core = p8_core_create();
    p8_gfx_sset(core, 8, 9, 13);
    assert(p8_gfx_sget(core, 8, 9) == 13);
    assert(p8_core_debug_peek_physical(core, 9 * 64 + 4) == 0x0d);

    p8_core_poke(core, 0x5f54, 0x60);
    assert(p8_gfx_sget(core, 0, 0) == p8_gfx_pget(core, 0, 0));
    p8_gfx_sset(core, 1, 0, 11);
    assert(p8_gfx_pget(core, 1, 0) == 11);
    p8_core_poke(core, 0x5f54, 0x00);

    p8_core_poke(core, 0x5f55, 0x00);
    assert(p8_gfx_pget(core, 8, 9) == 13);
    p8_gfx_pset(core, 9, 9, 12);
    assert(p8_gfx_sget(core, 9, 9) == 12);
    p8_core_poke(core, 0x5f55, 0x60);

    p8_gfx_cls(core, 0);
    p8_gfx_line(core, 1, 1, 4, 4, 5);
    for (int i = 1; i <= 4; ++i) {
        assert(p8_gfx_pget(core, i, i) == 5);
    }

    p8_gfx_rect(core, 10, 10, 12, 12, 6);
    assert(p8_gfx_pget(core, 10, 10) == 6);
    assert(p8_gfx_pget(core, 11, 10) == 6);
    assert(p8_gfx_pget(core, 12, 12) == 6);
    assert(p8_gfx_pget(core, 11, 11) == 0);
    p8_gfx_rectfill(core, 20, 22, 22, 20, 7);
    for (int y = 20; y <= 22; ++y) {
        for (int x = 20; x <= 22; ++x) {
            assert(p8_gfx_pget(core, x, y) == 7);
        }
    }

    p8_gfx_circ(core, 40, 40, 3, 8);
    assert(p8_gfx_pget(core, 43, 40) == 8);
    assert(p8_gfx_pget(core, 37, 40) == 8);
    assert(p8_gfx_pget(core, 40, 43) == 8);
    assert(p8_gfx_pget(core, 40, 37) == 8);
    p8_gfx_circfill(core, 50, 50, 3, 9);
    assert(p8_gfx_pget(core, 50, 50) == 9);
    assert(p8_gfx_pget(core, 53, 50) == 9);
    assert(p8_gfx_pget(core, 47, 50) == 9);
    p8_gfx_circfill(core, 60, 60, -1, 10);
    assert(p8_gfx_pget(core, 60, 60) == 0);

    std::array<uint8_t, P8_SCREEN_PIXELS> frame{};
    assert(p8_gfx_copy_framebuffer_indexed(core, frame.data(), frame.size()) ==
           P8_SCREEN_PIXELS);
    assert(frame[50 * P8_SCREEN_WIDTH + 50] == 9);
    assert(p8_gfx_copy_framebuffer_indexed(core, frame.data(), frame.size() - 1) == 0);

    p8_gfx_cls(core, 0);
    assert(p8_gfx_fillp(core, 0x01370000) == 0);
    p8_gfx_rectfill(core, 0, 0, 3, 3, 0xe8);
    const std::array<std::array<uint8_t, 4>, 4> patterned = {{{8, 8, 8, 8},
                                                               {8, 8, 8, 14},
                                                               {8, 8, 14, 14},
                                                               {8, 14, 14, 14}}};
    for (int y = 0; y < 4; ++y) {
        for (int x = 0; x < 4; ++x) assert(p8_gfx_pget(core, x, y) == patterned[y][x]);
    }
    p8_gfx_cls(core, 3);
    assert(p8_gfx_fillp(core, 0x5a5a8000) == 0x01370000);
    p8_gfx_rectfill(core, 0, 0, 3, 0, 11);
    assert(p8_gfx_pget(core, 0, 0) == 11);
    assert(p8_gfx_pget(core, 1, 0) == 3);
    assert(p8_gfx_pget(core, 2, 0) == 11);
    assert(p8_gfx_pget(core, 3, 0) == 3);
    assert(p8_gfx_fillp(core, 0) == static_cast<int32_t>(0x5a5a8000u));

    p8_core_destroy(core);
}

void test_raster_sprite_map_palette_and_flip()
{
    p8_core *core = p8_core_create();
    p8_gfx_sset(core, 8, 0, 1);
    p8_gfx_sset(core, 15, 0, 2);
    p8_gfx_sset(core, 8, 7, 3);
    p8_gfx_sset(core, 15, 7, 0);
    p8_gfx_pal(core, 1, 9);

    p8_gfx_spr(core, 1, 10, 20, 1, 1, 0, 0);
    assert(p8_gfx_pget(core, 10, 20) == 9);
    assert(p8_gfx_pget(core, 17, 20) == 2);
    assert(p8_gfx_pget(core, 10, 27) == 3);
    assert(p8_gfx_pget(core, 17, 27) == 0); // transparent source colour

    p8_gfx_cls(core, 0);
    p8_gfx_spr(core, 1, 30, 40, 1, 1, 1, 1);
    assert(p8_gfx_pget(core, 30, 40) == 0);
    assert(p8_gfx_pget(core, 37, 40) == 3);
    assert(p8_gfx_pget(core, 30, 47) == 2);
    assert(p8_gfx_pget(core, 37, 47) == 9);

    p8_gfx_cls(core, 0);
    p8_core_mset(core, 2, 3, 1);
    p8_gfx_map(core, 2, 3, 50, 60, 1, 1, 0);
    assert(p8_gfx_pget(core, 50, 60) == 9);
    assert(p8_gfx_pget(core, 57, 60) == 2);

    p8_gfx_cls(core, 0);
    p8_core_poke(core, 0x3001, 1u << 2);
    p8_gfx_map(core, 2, 3, 70, 80, 1, 1, 1u << 1);
    assert(p8_gfx_pget(core, 70, 80) == 0);
    p8_gfx_map(core, 2, 3, 70, 80, 1, 1, 1u << 2);
    assert(p8_gfx_pget(core, 70, 80) == 9);

    // A zero map cell is an empty sentinel, not an instruction to draw sprite
    // zero. Keep this independent of sprite-zero pixels and palt state.
    p8_gfx_cls(core, 6);
    p8_gfx_sset(core, 0, 0, 7);
    p8_core_mset(core, 4, 5, 0);
    p8_gfx_map(core, 4, 5, 90, 100, 1, 1, 0);
    assert(p8_gfx_pget(core, 90, 100) == 6);

    p8_core_poke(core, 0x5f36, 0x08);
    p8_gfx_map(core, 4, 5, 90, 100, 1, 1, 0);
    assert(p8_gfx_pget(core, 90, 100) == 7);
    p8_gfx_palt(core, 7, 1);
    p8_gfx_cls(core, 6);
    p8_gfx_map(core, 4, 5, 90, 100, 1, 1, 0);
    assert(p8_gfx_pget(core, 90, 100) == 6);

    assert(p8_gfx_pget(core, -1, 0) == 0);
    assert(p8_gfx_sget(core, -1, 0) == 0);
    p8_core_poke(core, 0x5f59, 9);
    p8_core_poke(core, 0x5f5b, 11);
    p8_core_poke(core, 0x5f36, 0x18);
    assert(p8_gfx_sget(core, -1, 0) == 9);
    assert(p8_gfx_pget(core, -1, 0) == 11);
    assert(p8_gfx_sget(core, 0, 0) == 7); // in-range reads ignore the override

    p8_gfx_pal_mode(core, 7, 143, 1);
    assert(p8_core_peek(core, 0x5f17) == 143);
    p8_gfx_pal_reset_mode(core, 1);
    assert(p8_core_peek(core, 0x5f17) == 7);
    p8_core_destroy(core);
}

void test_raster_secondary_palette_patterns_sprite_and_global_draws()
{
    p8_core *core = p8_core_create();
    p8_gfx_sset(core, 0, 0, 12);
    p8_gfx_sset(core, 1, 0, 12);
    p8_gfx_pal_mode(core, 12, 0x87, 2);

    // Pattern bit 15 selects the high secondary colour at x%4 == 0;
    // the next pixel selects the low colour. Fractional flag .01 applies
    // the pattern to sprite-family calls.
    p8_gfx_fillp(core, static_cast<int32_t>(0x80004000u));
    p8_gfx_spr(core, 0, 12, 0, 1, 1, 0, 0);
    assert(p8_gfx_pget(core, 12, 0) == 8);
    assert(p8_gfx_pget(core, 13, 0) == 7);

    p8_gfx_sspr(core, 0, 0, 2, 1, 32, 0, 2, 1, 0, 0);
    assert(p8_gfx_pget(core, 32, 0) == 8);
    assert(p8_gfx_pget(core, 33, 0) == 7);

    p8_gfx_sset(core, 8, 0, 12);
    p8_gfx_sset(core, 9, 0, 12);
    p8_core_mset(core, 0, 0, 1);
    p8_gfx_map(core, 0, 0, 36, 0, 1, 1, 0);
    assert(p8_gfx_pget(core, 36, 0) == 8);
    assert(p8_gfx_pget(core, 37, 0) == 7);
    p8_gfx_tline(core, 40, 0, 41, 0, 0, 0, 0x2000, 0, 0, 13);
    assert(p8_gfx_pget(core, 40, 0) == 8);
    assert(p8_gfx_pget(core, 41, 0) == 7);

    // Fractional flag .001 applies the same secondary mapping globally.
    p8_gfx_fillp(core, static_cast<int32_t>(0x80002000u));
    p8_gfx_rectfill(core, 20, 0, 21, 0, 12);
    assert(p8_gfx_pget(core, 20, 0) == 8);
    assert(p8_gfx_pget(core, 21, 0) == 7);

    // The normal draw palette is resolved before the secondary palette.
    p8_gfx_pal_mode(core, 3, 12, 0);
    p8_gfx_rectfill(core, 24, 0, 25, 0, 3);
    assert(p8_gfx_pget(core, 24, 0) == 8);
    assert(p8_gfx_pget(core, 25, 0) == 7);

    p8_gfx_pal_reset_mode(core, 2);
    p8_gfx_rectfill(core, 28, 0, 29, 0, 3);
    assert(p8_gfx_pget(core, 28, 0) == 12);
    assert(p8_gfx_pget(core, 29, 0) == 12);
    p8_core_destroy(core);
}

void test_raster_embedded_colour_patterns_and_inverted_fills()
{
    p8_core *core = p8_core_create();
    p8_gfx_cls(core, 0);
    p8_core_poke(core, 0x5f34, 0x01);
    const int32_t embedded = static_cast<int32_t>(0x104eabcdu);
    assert(p8_gfx_apply_color_argument(core, embedded) == 0x4e);
    assert(p8_core_peek(core, 0x5f31) == 0xcd);
    assert(p8_core_peek(core, 0x5f32) == 0xab);
    assert(p8_core_peek(core, 0x5f33) == 0);
    p8_gfx_rectfill(core, 0, 10, 3, 13, 0x4e);
    assert(p8_gfx_pget(core, 0, 10) == 4);
    assert(p8_gfx_pget(core, 1, 10) == 4);
    assert(p8_gfx_pget(core, 2, 10) == 14);
    assert(p8_gfx_pget(core, 3, 10) == 14);

    // The embedded mode flags share the same bytes used by fillp(). Inversion
    // is a one-call request and therefore does not silently mutate 0x5f34.
    const int32_t embedded_modes = static_cast<int32_t>(0x1f08aaaau);
    assert(p8_gfx_color_argument_requests_inversion(core, embedded_modes));
    assert(p8_gfx_apply_color_argument(core, embedded_modes) == 8);
    assert(p8_core_peek(core, 0x5f33) == 0x07);
    assert(p8_core_peek(core, 0x5f34) == 0x01);

    p8_gfx_fillp(core, 0);
    p8_gfx_cls(core, 1);
    p8_gfx_clip(core, 0, 20, 8, 8, 0);
    p8_core_poke(core, 0x5f34, 0x02);
    p8_gfx_circfill(core, 3, 23, 1, 8);
    assert(p8_gfx_pget(core, 0, 20) == 8);
    assert(p8_gfx_pget(core, 3, 23) == 1);
    assert(p8_gfx_pget(core, 3, 22) == 1);
    assert(p8_gfx_pget(core, 7, 27) == 8);
    assert(p8_gfx_pget(core, 8, 20) == 1);

    // Rectangle inversion observes camera coordinates while remaining bounded
    // by the screen-space clip.
    p8_gfx_cls(core, 2);
    p8_gfx_clip(core, 10, 10, 4, 4, 0);
    p8_gfx_camera(core, 5, 6);
    p8_gfx_rectfill(core, 15, 16, 16, 17, 9);
    assert(p8_gfx_pget(core, 10, 10) == 2);
    assert(p8_gfx_pget(core, 11, 11) == 2);
    assert(p8_gfx_pget(core, 13, 13) == 9);
    assert(p8_gfx_pget(core, 9, 10) == 2);
    p8_core_destroy(core);
}

void test_raster_ellipse_and_rounded_rectangle_primitives()
{
    p8_core *core = p8_core_create();
    const auto assert_row = [core](int x, int y,
                                   std::initializer_list<uint8_t> expected) {
        size_t index = 0;
        for (const uint8_t color : expected) {
            assert(p8_gfx_pget(core, x + static_cast<int>(index), y) == color);
            ++index;
        }
    };
    p8_gfx_cls(core, 0);
    p8_gfx_oval(core, 0, 0, 6, 4, 8);
    assert_row(0, 0, {0, 0, 8, 8, 8, 0, 0});
    assert_row(0, 1, {8, 8, 0, 0, 0, 8, 8});
    assert_row(0, 2, {8, 0, 0, 0, 0, 0, 8});
    assert_row(0, 3, {8, 8, 0, 0, 0, 8, 8});
    assert_row(0, 4, {0, 0, 8, 8, 8, 0, 0});

    p8_gfx_cls(core, 0);
    p8_gfx_oval(core, 8, 8, 47, 35, 8);
    for (int x = 8; x <= 47; ++x) {
        assert(p8_gfx_pget(core, x, 8) == (x >= 22 && x <= 33 ? 8 : 0));
    }
    assert(p8_gfx_pget(core, 15, 11) == 8);
    assert(p8_gfx_pget(core, 40, 11) == 8);
    assert(p8_gfx_pget(core, 14, 11) == 0);
    assert(p8_gfx_pget(core, 16, 11) == 0);

    p8_gfx_cls(core, 0);
    p8_gfx_ovalfill(core, 0, 0, 6, 4, 10);
    assert_row(0, 0, {0, 0, 10, 10, 10, 0, 0});
    assert_row(0, 1, {10, 10, 10, 10, 10, 10, 10});
    assert_row(0, 2, {10, 10, 10, 10, 10, 10, 10});
    assert_row(0, 3, {10, 10, 10, 10, 10, 10, 10});
    assert_row(0, 4, {0, 0, 10, 10, 10, 0, 0});

    p8_gfx_cls(core, 0);
    p8_gfx_ovalfill(core, 56, 8, 95, 35, 10);
    for (int x = 56; x <= 95; ++x) {
        assert(p8_gfx_pget(core, x, 8) == (x >= 70 && x <= 81 ? 10 : 0));
        assert(p8_gfx_pget(core, x, 16) == (x >= 57 && x <= 94 ? 10 : 0));
    }

    p8_gfx_cls(core, 0);
    p8_gfx_rrectfill(core, 0, 0, 10, 8, 1, 12);
    assert_row(0, 0, {0, 12, 12, 12, 12, 12, 12, 12, 12, 0});
    p8_gfx_rrectfill(core, 12, 0, 10, 8, 2, 13);
    assert_row(12, 0, {0, 0, 13, 13, 13, 13, 13, 13, 0, 0});
    p8_gfx_rrectfill(core, 24, 0, 16, 16, 6, 14);
    assert_row(24, 0, {0, 0, 0, 0, 0, 14, 14, 14, 14, 14, 14, 0, 0, 0, 0, 0});
    assert_row(24, 1, {0, 0, 0, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 0, 0, 0});
    assert_row(24, 2, {0, 0, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 0, 0});
    assert_row(24, 4, {0, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 14, 0});

    p8_gfx_rrect(core, 42, 0, 10, 8, 99, 7); // radius clamps to 4
    assert_row(42, 0, {0, 0, 0, 7, 7, 7, 7, 0, 0, 0});
    assert_row(42, 1, {0, 7, 7, 0, 0, 0, 0, 7, 7, 0});
    assert_row(42, 2, {0, 7, 0, 0, 0, 0, 0, 0, 7, 0});
    assert_row(42, 3, {7, 0, 0, 0, 0, 0, 0, 0, 0, 7});

    // Direct C callers can supply values outside the VM's 16.16 domain. The
    // draw must stay bounded while retaining the same midpoint corner shape.
    p8_gfx_cls(core, 0);
    p8_gfx_rrectfill(core, -32768, 0, std::numeric_limits<int>::max(),
                     std::numeric_limits<int>::max(),
                     std::numeric_limits<int>::max(), 5);
    assert(p8_gfx_pget(core, 0, 0) == 5);
    p8_gfx_cls(core, 0);
    p8_gfx_rrectfill(core, 50, 30, 0, 4, 2, 12);
    assert(p8_gfx_pget(core, 50, 30) == 0);

    p8_gfx_cls(core, 1);
    p8_gfx_clip(core, 0, 0, 8, 8, 0);
    p8_core_poke(core, 0x5f34, 2);
    p8_gfx_ovalfill(core, 2, 2, 5, 5, 8);
    assert(p8_gfx_pget(core, 3, 3) == 1);
    assert(p8_gfx_pget(core, 0, 0) == 8);
    assert(p8_gfx_pget(core, 8, 0) == 1);
    p8_gfx_cls(core, 1);
    p8_gfx_clip(core, 0, 0, 8, 8, 0);
    p8_gfx_rrectfill(core, 2, 2, 4, 4, 1, 9);
    assert(p8_gfx_pget(core, 3, 3) == 1);
    assert(p8_gfx_pget(core, 0, 0) == 9);
    assert(p8_gfx_pget(core, 8, 0) == 1);
    p8_core_destroy(core);
}

void test_raster_tline_sampling_precision_masks_layers_and_transparency()
{
    p8_core *core = p8_core_create();
    for (int pixel = 0; pixel < 8; ++pixel) {
        p8_gfx_sset(core, 8 + pixel, 0, static_cast<uint8_t>(pixel + 1));
        p8_gfx_sset(core, 16 + pixel, 0, static_cast<uint8_t>(pixel + 8));
    }
    p8_core_mset(core, 0, 0, 1);
    p8_core_mset(core, 1, 0, 2);

    p8_gfx_tline(core, 0, 30, 7, 30, 0, 0, 0x2000, 0, 0, 13);
    for (int pixel = 0; pixel < 8; ++pixel) {
        assert(p8_gfx_pget(core, pixel, 30) == pixel + 1);
    }

    p8_core_poke(core, 0x5f38, 1);
    p8_core_poke(core, 0x5f3a, 1);
    p8_gfx_tline(core, 0, 31, 7, 31, 0, 0, 0x2000, 0, 0, 13);
    for (int pixel = 0; pixel < 8; ++pixel) {
        assert(p8_gfx_pget(core, pixel, 31) == ((pixel + 8) & 0x0f));
    }

    p8_core_poke(core, 0x5f38, 0);
    p8_core_poke(core, 0x5f3a, 0);
    p8_gfx_tline(core, 0, 32, 7, 32, 0, 0, 0x10000, 0, 0, 16);
    for (int pixel = 0; pixel < 8; ++pixel) {
        assert(p8_gfx_pget(core, pixel, 32) == pixel + 1);
    }

    p8_core_poke(core, 0x3001, 1u << 2);
    p8_gfx_cls(core, 6);
    p8_gfx_tline(core, 0, 33, 0, 33, 0, 0, 0, 0, 1u << 1, 13);
    assert(p8_gfx_pget(core, 0, 33) == 6);
    p8_gfx_tline(core, 0, 33, 0, 33, 0, 0, 0, 0, 1u << 2, 13);
    assert(p8_gfx_pget(core, 0, 33) == 1);
    p8_gfx_pal(core, 1, 9);
    p8_gfx_tline(core, 3, 33, 3, 33, 0, 0, 0, 0, 1u << 2, 13);
    assert(p8_gfx_pget(core, 3, 33) == 9);
    p8_gfx_pal_reset(core);

    p8_gfx_sset(core, 0, 0, 7);
    p8_core_mset(core, 0, 0, 0);
    p8_gfx_tline(core, 1, 33, 1, 33, 0, 0, 0, 0, 0, 13);
    assert(p8_gfx_pget(core, 1, 33) == 6);
    p8_core_poke(core, 0x5f36, 0x08);
    p8_gfx_tline(core, 1, 33, 1, 33, 0, 0, 0, 0, 0, 13);
    assert(p8_gfx_pget(core, 1, 33) == 7);
    p8_gfx_palt(core, 7, 1);
    p8_gfx_tline(core, 2, 33, 2, 33, 0, 0, 0, 0, 0, 13);
    assert(p8_gfx_pget(core, 2, 33) == 6);

    p8_core_destroy(core);
}

void test_audio_is_deterministic_and_rejects_unqualified_features()
{
    std::array<uint8_t, P8_ROM_SIZE> rom{};
    rom[0x3100] = 0x80; // pattern 0 begins a loop and plays sfx 0 on channel 0
    rom[0x3101] = 0x42;
    rom[0x3102] = 0x43;
    rom[0x3103] = 0x44;
    rom[0x3200] = static_cast<uint8_t>(33 | (3 << 6)); // A, square
    rom[0x3201] = static_cast<uint8_t>(7 << 1); // full volume, no effect
    rom[0x3240] = 1; // editor mode only; no filters
    rom[0x3241] = 2; // speed

    p8_core *core = p8_core_create();
    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    const uint32_t capabilities = p8_audio_capabilities(core);
    assert((capabilities & P8_AUDIO_CAP_EVENT_LEDGER) != 0);
    assert((capabilities & P8_AUDIO_CAP_CHANNEL_STATUS) != 0);
    assert((capabilities & P8_AUDIO_CAP_STAT_57) != 0);
    assert((capabilities & P8_AUDIO_CAP_CURRENT_MUSIC_PATTERN) != 0);
    assert((capabilities & P8_AUDIO_CAP_STAT_46_56) == 0);
    assert((capabilities & P8_AUDIO_CAP_FILTERS) == 0);
    assert((capabilities & P8_AUDIO_CAP_CUSTOM_INSTRUMENTS) == 0);
    assert((capabilities & P8_AUDIO_CAP_CUSTOM_WAVEFORMS) == 0);
    int32_t music_active = -1;
    assert(p8_audio_stat(core, 57, &music_active));
    assert(music_active == 0);
    int32_t current_pattern = 123;
    assert(p8_audio_stat(core, 24, &current_pattern) && current_pattern == -1);
    assert(p8_audio_stat(core, 54, &current_pattern) && current_pattern == -1);
    assert(p8_audio_music(core, 0, 0, 0x0f));
    assert(p8_audio_stat(core, 57, &music_active));
    assert(music_active == 1);
    assert(p8_audio_current_music(core) == 0);
    assert(p8_audio_stat(core, 24, &current_pattern) && current_pattern == 0);
    assert(p8_audio_stat(core, 54, &current_pattern) && current_pattern == 0);
    assert(p8_audio_current_sfx(core, 0) == 0);
    p8_audio_channel_status status{};
    assert(p8_audio_get_channel_status(core, 0, &status));
    assert(status.sfx == 0 && status.note == 0 && status.is_music == 1);
    int32_t stat_value = 123;
    assert(!p8_audio_stat(core, 46, &stat_value));
    assert(stat_value == 123); // unsupported status must not manufacture a value
    std::array<p8_audio_event, 8> events{};
    assert(p8_audio_copy_events(core, events.data(), events.size()) == 2);
    assert(events[0].kind == P8_AUDIO_EVENT_MUSIC_PATTERN);
    assert(events[0].music_pattern == 0);
    assert(events[1].kind == P8_AUDIO_EVENT_CHANNEL_START);
    assert(events[1].channel == 0 && events[1].sfx == 0 && events[1].note == 0);
    assert(p8_core_host_tick60(core, 1) == 1);
    assert(p8_audio_get_channel_status(core, 0, &status));
    assert(status.sfx == 0 && status.note == 1);
    assert(p8_audio_copy_events(core, events.data(), events.size()) == 3);
    assert(events[2].kind == P8_AUDIO_EVENT_NOTE);
    assert(events[2].sample_low == 367 && events[2].sample_high == 0);
    assert(events[2].note == 1);
    assert(p8_audio_available(core) == 367);
    std::array<int16_t, 367> first{};
    assert(p8_audio_read(core, first.data(), first.size()) == first.size());
    assert(std::any_of(first.begin(), first.end(), [](int16_t sample) { return sample != 0; }));

    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    assert(p8_audio_sfx(core, 0, 0, 0, 0) == 0);
    assert(p8_core_host_tick60(core, 1) == 1);
    std::array<int16_t, 367> builtin_non_music{};
    assert(p8_audio_read(core, builtin_non_music.data(), builtin_non_music.size())
           == builtin_non_music.size());
    assert(first == builtin_non_music); // full-volume music and standalone paths share gain

    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    assert(p8_audio_music(core, 0, 0, 0x0f));
    assert(p8_core_host_tick60(core, 1) == 1);
    std::array<int16_t, 367> second{};
    assert(p8_audio_read(core, second.data(), second.size()) == second.size());
    assert(first == second);

    rom[0x3101] = 0; // the second song channel also references sfx 0
    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    assert(p8_audio_music(core, 0, 0, 0x01));
    assert(p8_audio_current_sfx(core, 0) == 0);
    assert(p8_audio_current_sfx(core, 1) == -1); // channel mask reserves only channel 0

    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    assert(p8_audio_sfx(core, 0, 0, 0, 0) == 0);
    assert(p8_audio_sfx(core, -2, 0, 0, 0) == -1);
    assert(p8_audio_get_channel_status(core, 0, &status));
    assert(status.sfx == 0 && status.is_releasing == 1);
    assert(p8_audio_sfx(core, -1, 0, 0, 0) == -1);
    assert(p8_audio_get_channel_status(core, 0, &status));
    assert(status.sfx == -1 && status.note == -1);
    assert(status.is_music == 0 && status.is_releasing == 0);
    assert(p8_audio_copy_events(core, events.data(), events.size()) == 3);
    assert(events[0].kind == P8_AUDIO_EVENT_CHANNEL_START);
    assert(events[1].kind == P8_AUDIO_EVENT_CHANNEL_RELEASE);
    assert(events[2].kind == P8_AUDIO_EVENT_CHANNEL_STOP);

    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    assert(p8_audio_music(core, 0, 0, 0x0f));
    assert(p8_audio_stat(core, 57, &music_active) && music_active == 1);
    assert(p8_audio_music(core, -1, 0, 0x0f));
    assert(p8_audio_stat(core, 57, &music_active) && music_active == 0);
    assert(p8_audio_stat(core, 24, &current_pattern) && current_pattern == -1);
    assert(p8_audio_stat(core, 54, &current_pattern) && current_pattern == -1);

    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    assert(p8_audio_music(core, 0, 0, 0x0f));
    assert(p8_audio_music(core, -1, 500, 0x0f));
    for (int tick = 0; tick < 29; ++tick) p8_audio_host_tick60(core);
    assert(p8_audio_stat(core, 57, &music_active) && music_active == 1);
    p8_audio_host_tick60(core);
    assert(p8_audio_stat(core, 57, &music_active) && music_active == 0);

    rom[0x3240] = 3; // editor flag plus noiz filter
    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    assert(p8_audio_sfx(core, 0, 0, 0, 0) == -1);
    assert(std::strstr(p8_audio_last_error(core), "filters") != nullptr);

    rom[0x3240] = 1;
    rom[0x3201] = static_cast<uint8_t>((7 << 1) | 0x80); // active custom instrument
    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    assert(p8_audio_sfx(core, 0, 0, 0, 0) == -1);
    assert(std::strstr(p8_audio_last_error(core), "diagnostic opt-in") != nullptr);
    assert(p8_audio_diagnostic_flags(core) == 0);
    assert(p8_audio_copy_events(core, events.data(), events.size()) == 0);
    p8_core_destroy(core);
}

void test_custom_audio_diagnostic_subset_is_explicit_bounded_and_deterministic()
{
    std::array<uint8_t, P8_ROM_SIZE> rom{};
    // Public synthetic analogue of PICO-8 custom SFX instruments: outer SFX 8
    // references instrument SFX 1, whose notes use only built-in waveforms.
    write_sfx_note(rom, 1, 0, 24, 5, 7, 1);
    write_sfx_note(rom, 1, 1, 28, 5, 4, 1);
    rom[0x3200 + 1 * 68 + 64] = 1;
    rom[0x3200 + 1 * 68 + 65] = 2;
    write_sfx_note(rom, 8, 0, 33, 1, 7, 0, true);
    write_sfx_note(rom, 8, 1, 33, 1, 7, 5, true);
    rom[0x3200 + 8 * 68 + 64] = 1;
    rom[0x3200 + 8 * 68 + 65] = 1;

    p8_core *core = p8_core_create();
    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    assert(p8_audio_sfx(core, 8, 0, 0, 0) == -1);
    assert(std::strstr(p8_audio_last_error(core), "diagnostic opt-in") != nullptr);
    assert(p8_audio_diagnostic_flags(core) == 0);

    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    assert(!p8_audio_set_diagnostic_mask(core, 0x80000000u));
    assert(p8_audio_set_diagnostic_mask(core, P8_AUDIO_DIAGNOSTIC_CUSTOM_INSTRUMENT));
    assert(p8_audio_sfx(core, 8, 0, 0, 0) == 0);
    assert(p8_audio_diagnostic_flags(core) == P8_AUDIO_DIAGNOSTIC_CUSTOM_INSTRUMENT);
    assert((p8_audio_capabilities(core) & P8_AUDIO_CAP_CUSTOM_INSTRUMENTS) == 0);
    std::array<p8_audio_event, 8> events{};
    assert(p8_audio_copy_events(core, events.data(), events.size()) == 2);
    assert(events[0].kind == P8_AUDIO_EVENT_DIAGNOSTIC_CUSTOM_AUDIO);
    assert(events[0].sfx == 8 && events[0].channel == 0);
    assert(events[1].kind == P8_AUDIO_EVENT_CHANNEL_START);
    assert(p8_core_host_tick60(core, 1) == 1);
    std::array<int16_t, 367> first{};
    assert(p8_audio_read(core, first.data(), first.size()) == first.size());
    assert(std::any_of(first.begin(), first.end(), [](int16_t sample) { return sample != 0; }));
    assert(!p8_audio_set_diagnostic_mask(core, 0)); // mode is immutable after execution begins

    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    assert(p8_audio_set_diagnostic_mask(core, P8_AUDIO_DIAGNOSTIC_CUSTOM_INSTRUMENT));
    assert(p8_audio_sfx(core, 8, 0, 0, 0) == 0);
    assert(p8_core_host_tick60(core, 1) == 1);
    std::array<int16_t, 367> second{};
    assert(p8_audio_read(core, second.data(), second.size()) == second.size());
    assert(first == second);

    // A 64-byte custom waveform uses a separate explicit diagnostic bit. The
    // two same-key outer notes intentionally continue phase rather than
    // retriggering; this is a deterministic assumption, not conformance proof.
    std::array<uint8_t, P8_ROM_SIZE> waveform_rom{};
    for (unsigned index = 0; index < 64; ++index) {
        waveform_rom[0x3200 + index] = static_cast<uint8_t>(static_cast<int>(index) - 32);
    }
    waveform_rom[0x3200 + 64] = 1;
    waveform_rom[0x3200 + 65] = 0;
    waveform_rom[0x3200 + 66] = 0x80;
    waveform_rom[0x3200 + 67] = 0;
    write_sfx_note(waveform_rom, 8, 0, 33, 0, 7, 0, true);
    write_sfx_note(waveform_rom, 8, 1, 33, 0, 7, 0, true);
    waveform_rom[0x3200 + 8 * 68 + 64] = 1;
    waveform_rom[0x3200 + 8 * 68 + 65] = 1;
    assert(p8_core_load_rom(core, waveform_rom.data(), waveform_rom.size()));
    assert(p8_audio_set_diagnostic_mask(core, P8_AUDIO_DIAGNOSTIC_CUSTOM_WAVEFORM));
    assert(p8_audio_sfx(core, 8, 0, 0, 0) == 0);
    assert(p8_core_host_tick60(core, 1) == 1);
    std::array<int16_t, 367> waveform_samples{};
    assert(p8_audio_read(core, waveform_samples.data(), waveform_samples.size())
           == waveform_samples.size());
    assert(std::any_of(waveform_samples.begin(), waveform_samples.end(),
                       [](int16_t sample) { return sample != 0; }));
    assert(waveform_samples[0] == -2976); // official-qualified shared 3/4 output gain
    assert(waveform_samples[0] != waveform_samples[183]);
    assert(p8_audio_diagnostic_flags(core) == P8_AUDIO_DIAGNOSTIC_CUSTOM_WAVEFORM);
    assert((p8_audio_capabilities(core) & P8_AUDIO_CAP_CUSTOM_WAVEFORMS) == 0);

    waveform_rom[0x3100] = 8;
    waveform_rom[0x3101] = 0x40;
    waveform_rom[0x3102] = 0x40;
    waveform_rom[0x3103] = 0x40;
    assert(p8_core_load_rom(core, waveform_rom.data(), waveform_rom.size()));
    assert(p8_audio_set_diagnostic_mask(core, P8_AUDIO_DIAGNOSTIC_CUSTOM_WAVEFORM));
    assert(p8_audio_music(core, 0, 0, 0x01));
    assert(p8_core_host_tick60(core, 1) == 1);
    std::array<int16_t, 367> waveform_music_samples{};
    assert(p8_audio_read(core, waveform_music_samples.data(), waveform_music_samples.size())
           == waveform_music_samples.size());
    assert(waveform_music_samples == waveform_samples);

    // Unsupported structure stays fail-closed even after diagnostic opt-in.
    const std::array<uint8_t, P8_ROM_SIZE> valid_instrument_rom = rom;
    rom[0x3200 + 1 * 68 + 1] |= 0x80; // nested custom reference
    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    assert(p8_audio_set_diagnostic_mask(core, P8_AUDIO_DIAGNOSTIC_CUSTOM_INSTRUMENT));
    assert(p8_audio_sfx(core, 8, 0, 0, 0) == -1);
    assert(std::strstr(p8_audio_last_error(core), "recursion") != nullptr);
    assert(p8_audio_diagnostic_flags(core) == 0);
    assert(p8_audio_copy_events(core, events.data(), events.size()) == 0);

    rom = valid_instrument_rom;
    rom[0x3200 + 1 * 68 + 64] = 3; // referenced noiz filter
    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    assert(p8_audio_set_diagnostic_mask(core, P8_AUDIO_DIAGNOSTIC_CUSTOM_INSTRUMENT));
    assert(p8_audio_sfx(core, 8, 0, 0, 0) == -1);
    assert(std::strstr(p8_audio_last_error(core), "filters") != nullptr);
    assert(p8_audio_diagnostic_flags(core) == 0);

    rom = valid_instrument_rom;
    rom[0x3200 + 8 * 68 + 1] |= 1u << 4; // unsupported outer slide effect
    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    assert(p8_audio_set_diagnostic_mask(core, P8_AUDIO_DIAGNOSTIC_CUSTOM_INSTRUMENT));
    assert(p8_audio_sfx(core, 8, 0, 0, 0) == -1);
    assert(std::strstr(p8_audio_last_error(core), "custom note effect") != nullptr);
    assert(p8_audio_diagnostic_flags(core) == 0);

    rom = valid_instrument_rom;
    write_sfx_note(rom, 1, 0, 63, 5, 7, 0);
    write_sfx_note(rom, 8, 0, 63, 1, 7, 0, true);
    write_sfx_note(rom, 8, 1, 63, 1, 7, 0, true);
    assert(p8_core_load_rom(core, rom.data(), rom.size()));
    assert(p8_audio_set_diagnostic_mask(core, P8_AUDIO_DIAGNOSTIC_CUSTOM_INSTRUMENT));
    assert(p8_audio_sfx(core, 8, 0, 0, 0) == -1);
    assert(std::strstr(p8_audio_last_error(core), "transposition") != nullptr);
    assert(p8_audio_diagnostic_flags(core) == 0);

    waveform_rom[0x3200 + 67] = 1; // reserved custom-waveform metadata
    assert(p8_core_load_rom(core, waveform_rom.data(), waveform_rom.size()));
    assert(p8_audio_set_diagnostic_mask(core, P8_AUDIO_DIAGNOSTIC_CUSTOM_WAVEFORM));
    assert(p8_audio_sfx(core, 8, 0, 0, 0) == -1);
    assert(std::strstr(p8_audio_last_error(core), "metadata") != nullptr);
    assert(p8_audio_diagnostic_flags(core) == 0);
    p8_core_destroy(core);
}

} // namespace

int main()
{
    test_rom_reset_and_memory_alias();
    test_video_mapping_and_dirty_tracking();
    test_map_mapping_and_shared_gfx_alias();
    test_little_endian_wrap_and_overlap();
    test_btnp_is_latched_and_repeats();
    test_scheduler();
    test_draw_stream();
    test_text_ir_is_versioned_lossless_and_conservative();
    test_resumable_text_jobs_expose_exact_delay_budgets();
    test_raster_pixel_layout_and_draw_state();
    test_raster_sprite_alias_and_primitives();
    test_raster_sprite_map_palette_and_flip();
    test_raster_secondary_palette_patterns_sprite_and_global_draws();
    test_raster_embedded_colour_patterns_and_inverted_fills();
    test_raster_ellipse_and_rounded_rectangle_primitives();
    test_raster_tline_sampling_precision_masks_layers_and_transparency();
    test_audio_is_deterministic_and_rejects_unqualified_features();
    test_custom_audio_diagnostic_subset_is_explicit_bounded_and_deterministic();
    std::puts("p8 core tests: ok");
    return 0;
}
