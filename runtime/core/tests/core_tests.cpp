#include "p8/core.h"
#include "p8/raster.h"

#include <array>
#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstdio>

namespace {

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

    p8_core_set_update_rate(core, 60);
    for (unsigned i = 0; i < 6; ++i) {
        p8_core_host_tick60(core, i != 2);
    }
    assert(trace.updates == 3 && trace.updates60 == 6 && trace.draws == 8);
    assert(p8_core_get_update_count(core) == 9);
    assert(std::abs(p8_core_time(core) - 0.15) < 1e-12);
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
    test_raster_pixel_layout_and_draw_state();
    test_raster_sprite_alias_and_primitives();
    std::puts("p8 core tests: ok");
    return 0;
}
