#ifndef P8_RASTER_H
#define P8_RASTER_H

#include "p8/core.h"

#ifdef __cplusplus
extern "C" {
#endif

enum {
    P8_SCREEN_WIDTH = 128,
    P8_SCREEN_HEIGHT = 128,
    P8_SCREEN_PIXELS = P8_SCREEN_WIDTH * P8_SCREEN_HEIGHT,
};

/* Restores the PICO-8 draw palette, transparency, clip, and camera defaults. */
void p8_raster_reset(p8_core *core);

/* Screen and sprite-sheet pixel access. Read functions return stored colours. */
uint8_t p8_gfx_pget(const p8_core *core, int x, int y);
void p8_gfx_pset(p8_core *core, int x, int y, uint8_t color);
uint8_t p8_gfx_sget(const p8_core *core, int x, int y);
void p8_gfx_sset(p8_core *core, int x, int y, uint8_t color);

void p8_gfx_cls(p8_core *core, uint8_t color);
void p8_gfx_camera(p8_core *core, int x, int y);
void p8_gfx_camera_reset(p8_core *core);
void p8_gfx_clip(p8_core *core, int x, int y, int width, int height,
                 int intersect_previous);
void p8_gfx_clip_reset(p8_core *core);

void p8_gfx_pal(p8_core *core, uint8_t source, uint8_t target);
void p8_gfx_pal_reset(p8_core *core);
void p8_gfx_palt(p8_core *core, uint8_t color, int transparent);
void p8_gfx_palt_reset(p8_core *core);
int p8_gfx_is_transparent(const p8_core *core, uint8_t color);
int32_t p8_gfx_fillp(p8_core *core, int32_t raw_pattern);

void p8_gfx_line(p8_core *core, int x0, int y0, int x1, int y1, uint8_t color);
void p8_gfx_rect(p8_core *core, int x0, int y0, int x1, int y1, uint8_t color);
void p8_gfx_rectfill(p8_core *core, int x0, int y0, int x1, int y1, uint8_t color);
void p8_gfx_circ(p8_core *core, int center_x, int center_y, int radius, uint8_t color);
void p8_gfx_circfill(p8_core *core, int center_x, int center_y, int radius,
                     uint8_t color);
void p8_gfx_spr(p8_core *core, int sprite, int x, int y, int width, int height,
                int flip_x, int flip_y);
void p8_gfx_sspr(p8_core *core, int source_x, int source_y, int source_width,
                 int source_height, int destination_x, int destination_y,
                 int destination_width, int destination_height,
                 int flip_x, int flip_y);
void p8_gfx_map(p8_core *core, int cell_x, int cell_y, int screen_x, int screen_y,
                int cell_width, int cell_height, uint8_t layer);
void p8_gfx_tline(p8_core *core, int x0, int y0, int x1, int y1,
                  int32_t map_x_raw, int32_t map_y_raw,
                  int32_t map_dx_raw, int32_t map_dy_raw,
                  uint8_t layer, unsigned fractional_bits);

/* Expands packed screen RAM to one 0..15 palette index per pixel. */
size_t p8_gfx_copy_framebuffer_indexed(const p8_core *core, uint8_t *destination,
                                       size_t capacity);

#ifdef __cplusplus
}
#endif

#endif
