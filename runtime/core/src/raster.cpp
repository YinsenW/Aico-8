#include "p8/raster.h"

#include <algorithm>
#include <cstdint>

namespace {

constexpr uint16_t kDrawPalette = 0x5f00;
constexpr uint16_t kDisplayPalette = 0x5f10;
constexpr uint16_t kClipX = 0x5f20;
constexpr uint16_t kClipY = 0x5f21;
constexpr uint16_t kClipWidth = 0x5f22;
constexpr uint16_t kClipHeight = 0x5f23;
constexpr uint16_t kCameraX = 0x5f28;
constexpr uint16_t kCameraY = 0x5f2a;
constexpr uint16_t kGfxBase = 0x0000;
constexpr uint16_t kSpriteFlagsBase = 0x3000;
constexpr uint16_t kScreenBase = 0x6000;
constexpr uint8_t kColorMask = 0x0f;
constexpr uint8_t kTransparentBit = 0x10;

int bounded_coordinate(int value)
{
    return std::max(-32768, std::min(32767, value));
}

int signed_word(const p8_core *core, uint16_t address)
{
    const uint16_t raw = p8_core_peek16(core, address);
    return raw <= 0x7fff ? static_cast<int>(raw) : static_cast<int>(raw) - 0x10000;
}

uint16_t pixel_address(uint16_t base, int x, int y)
{
    return static_cast<uint16_t>(base + y * (P8_SCREEN_WIDTH / 2) + x / 2);
}

uint8_t raw_pixel(const p8_core *core, uint16_t base, int x, int y)
{
    if (!core || x < 0 || y < 0 || x >= P8_SCREEN_WIDTH || y >= P8_SCREEN_HEIGHT) {
        return 0;
    }
    const uint8_t packed = p8_core_peek(core, pixel_address(base, x, y));
    return static_cast<uint8_t>((packed >> ((x & 1) * 4)) & kColorMask);
}

void raw_set_pixel(p8_core *core, uint16_t base, int x, int y, uint8_t color)
{
    if (!core || x < 0 || y < 0 || x >= P8_SCREEN_WIDTH || y >= P8_SCREEN_HEIGHT) {
        return;
    }
    const uint16_t address = pixel_address(base, x, y);
    const unsigned shift = static_cast<unsigned>((x & 1) * 4);
    const uint8_t mask = static_cast<uint8_t>(kColorMask << shift);
    const uint8_t old_value = p8_core_peek(core, address);
    const uint8_t value = static_cast<uint8_t>((old_value & ~mask) |
                                                ((color & kColorMask) << shift));
    p8_core_poke(core, address, value);
}

uint8_t mapped_color(const p8_core *core, uint8_t color)
{
    return static_cast<uint8_t>(
        p8_core_peek(core, static_cast<uint16_t>(kDrawPalette + (color & kColorMask))) &
        kColorMask);
}

bool inside_clip(const p8_core *core, int screen_x, int screen_y)
{
    const int x = p8_core_peek(core, kClipX);
    const int y = p8_core_peek(core, kClipY);
    const int width = p8_core_peek(core, kClipWidth);
    const int height = p8_core_peek(core, kClipHeight);
    return screen_x >= x && screen_y >= y && screen_x < x + width &&
           screen_y < y + height;
}

void draw_mapped_pixel(p8_core *core, int64_t world_x, int64_t world_y, uint8_t color)
{
    if (!core) {
        return;
    }
    const int64_t screen_x = world_x - signed_word(core, kCameraX);
    const int64_t screen_y = world_y - signed_word(core, kCameraY);
    if (screen_x < 0 || screen_y < 0 || screen_x >= P8_SCREEN_WIDTH ||
        screen_y >= P8_SCREEN_HEIGHT) {
        return;
    }
    const int x = static_cast<int>(screen_x);
    const int y = static_cast<int>(screen_y);
    if (inside_clip(core, x, y)) {
        raw_set_pixel(core, kScreenBase, x, y, color);
    }
}

void draw_mapped_span(p8_core *core, int64_t world_x0, int64_t world_x1,
                      int64_t world_y, uint8_t color)
{
    if (!core) {
        return;
    }
    if (world_x0 > world_x1) {
        std::swap(world_x0, world_x1);
    }
    const int64_t screen_y = world_y - signed_word(core, kCameraY);
    const int clip_y = p8_core_peek(core, kClipY);
    const int clip_height = p8_core_peek(core, kClipHeight);
    if (screen_y < clip_y || screen_y >= clip_y + clip_height || screen_y < 0 ||
        screen_y >= P8_SCREEN_HEIGHT) {
        return;
    }

    const int camera_x = signed_word(core, kCameraX);
    int64_t screen_x0 = world_x0 - camera_x;
    int64_t screen_x1 = world_x1 - camera_x;
    const int clip_x = p8_core_peek(core, kClipX);
    const int clip_width = p8_core_peek(core, kClipWidth);
    screen_x0 = std::max<int64_t>(screen_x0, std::max(0, clip_x));
    screen_x1 = std::min<int64_t>(screen_x1,
                                  std::min(P8_SCREEN_WIDTH - 1, clip_x + clip_width - 1));
    for (int64_t x = screen_x0; x <= screen_x1; ++x) {
        raw_set_pixel(core, kScreenBase, static_cast<int>(x), static_cast<int>(screen_y),
                      color);
    }
}

void circle_octants(p8_core *core, int64_t cx, int64_t cy, int x, int y,
                    uint8_t color)
{
    draw_mapped_pixel(core, cx + x, cy + y, color);
    draw_mapped_pixel(core, cx + y, cy + x, color);
    draw_mapped_pixel(core, cx - y, cy + x, color);
    draw_mapped_pixel(core, cx - x, cy + y, color);
    draw_mapped_pixel(core, cx - x, cy - y, color);
    draw_mapped_pixel(core, cx - y, cy - x, color);
    draw_mapped_pixel(core, cx + y, cy - x, color);
    draw_mapped_pixel(core, cx + x, cy - y, color);
}

void circle_spans(p8_core *core, int64_t cx, int64_t cy, int x, int y,
                  uint8_t color)
{
    draw_mapped_span(core, cx - x, cx + x, cy + y, color);
    draw_mapped_span(core, cx - x, cx + x, cy - y, color);
    draw_mapped_span(core, cx - y, cx + y, cy + x, color);
    draw_mapped_span(core, cx - y, cx + y, cy - x, color);
}

template <typename Plot>
void raster_circle(p8_core *core, int center_x, int center_y, int radius,
                   uint8_t color, Plot plot)
{
    if (!core || radius < 0) {
        return;
    }
    const int64_t cx = bounded_coordinate(center_x);
    const int64_t cy = bounded_coordinate(center_y);
    int x = std::min(radius, 32767);
    int y = 0;
    int error = 1 - x;
    while (x >= y) {
        plot(core, cx, cy, x, y, color);
        ++y;
        if (error < 0) {
            error += 2 * y + 1;
        } else {
            --x;
            error += 2 * (y - x) + 1;
        }
    }
}

int clamp_to_screen_edge(int64_t value)
{
    return static_cast<int>(std::max<int64_t>(0, std::min<int64_t>(P8_SCREEN_WIDTH, value)));
}

} // namespace

extern "C" {

void p8_raster_reset(p8_core *core)
{
    if (!core) {
        return;
    }
    p8_gfx_pal_reset(core);
    p8_gfx_clip_reset(core);
    p8_gfx_camera_reset(core);
}

uint8_t p8_gfx_pget(const p8_core *core, int x, int y)
{
    return raw_pixel(core, kScreenBase, x, y);
}

void p8_gfx_pset(p8_core *core, int x, int y, uint8_t color)
{
    draw_mapped_pixel(core, bounded_coordinate(x), bounded_coordinate(y),
                      mapped_color(core, color));
}

uint8_t p8_gfx_sget(const p8_core *core, int x, int y)
{
    return raw_pixel(core, kGfxBase, x, y);
}

void p8_gfx_sset(p8_core *core, int x, int y, uint8_t color)
{
    raw_set_pixel(core, kGfxBase, x, y, color);
}

void p8_gfx_cls(p8_core *core, uint8_t color)
{
    if (!core) {
        return;
    }
    const uint8_t mapped = mapped_color(core, color);
    p8_core_memset(core, kScreenBase, static_cast<uint8_t>(mapped | (mapped << 4)),
                   P8_SCREEN_PIXELS / 2);
    p8_gfx_clip_reset(core);
}

void p8_gfx_camera(p8_core *core, int x, int y)
{
    if (!core) {
        return;
    }
    p8_core_poke16(core, kCameraX, static_cast<uint16_t>(bounded_coordinate(x)));
    p8_core_poke16(core, kCameraY, static_cast<uint16_t>(bounded_coordinate(y)));
}

void p8_gfx_camera_reset(p8_core *core)
{
    p8_gfx_camera(core, 0, 0);
}

void p8_gfx_clip(p8_core *core, int x, int y, int width, int height,
                 int intersect_previous)
{
    if (!core) {
        return;
    }
    const int64_t right_value = static_cast<int64_t>(x) + std::max(0, width);
    const int64_t bottom_value = static_cast<int64_t>(y) + std::max(0, height);
    int left = clamp_to_screen_edge(x);
    int top = clamp_to_screen_edge(y);
    int right = clamp_to_screen_edge(right_value);
    int bottom = clamp_to_screen_edge(bottom_value);
    right = std::max(left, right);
    bottom = std::max(top, bottom);

    if (intersect_previous) {
        const int old_left = p8_core_peek(core, kClipX);
        const int old_top = p8_core_peek(core, kClipY);
        const int old_right = old_left + p8_core_peek(core, kClipWidth);
        const int old_bottom = old_top + p8_core_peek(core, kClipHeight);
        left = std::max(left, old_left);
        top = std::max(top, old_top);
        right = std::max(left, std::min(right, old_right));
        bottom = std::max(top, std::min(bottom, old_bottom));
    }

    p8_core_poke(core, kClipX, static_cast<uint8_t>(left));
    p8_core_poke(core, kClipY, static_cast<uint8_t>(top));
    p8_core_poke(core, kClipWidth, static_cast<uint8_t>(right - left));
    p8_core_poke(core, kClipHeight, static_cast<uint8_t>(bottom - top));
}

void p8_gfx_clip_reset(p8_core *core)
{
    p8_gfx_clip(core, 0, 0, P8_SCREEN_WIDTH, P8_SCREEN_HEIGHT, 0);
}

void p8_gfx_pal(p8_core *core, uint8_t source, uint8_t target)
{
    if (!core) {
        return;
    }
    const uint16_t address =
        static_cast<uint16_t>(kDrawPalette + (source & kColorMask));
    const uint8_t transparency = p8_core_peek(core, address) & kTransparentBit;
    p8_core_poke(core, address,
                 static_cast<uint8_t>(transparency | (target & kColorMask)));
}

void p8_gfx_pal_reset(p8_core *core)
{
    if (!core) {
        return;
    }
    for (uint8_t color = 0; color <= kColorMask; ++color) {
        const uint8_t draw = static_cast<uint8_t>(color | (color == 0 ? kTransparentBit : 0));
        p8_core_poke(core, static_cast<uint16_t>(kDrawPalette + color), draw);
        p8_core_poke(core, static_cast<uint16_t>(kDisplayPalette + color), color);
    }
}

void p8_gfx_palt(p8_core *core, uint8_t color, int transparent)
{
    if (!core) {
        return;
    }
    const uint16_t address =
        static_cast<uint16_t>(kDrawPalette + (color & kColorMask));
    uint8_t value = p8_core_peek(core, address);
    value = transparent ? static_cast<uint8_t>(value | kTransparentBit)
                        : static_cast<uint8_t>(value & ~kTransparentBit);
    p8_core_poke(core, address, value);
}

void p8_gfx_palt_reset(p8_core *core)
{
    if (!core) {
        return;
    }
    for (uint8_t color = 0; color <= kColorMask; ++color) {
        p8_gfx_palt(core, color, color == 0);
    }
}

int p8_gfx_is_transparent(const p8_core *core, uint8_t color)
{
    return core &&
           (p8_core_peek(core,
                         static_cast<uint16_t>(kDrawPalette + (color & kColorMask))) &
            kTransparentBit) != 0;
}

void p8_gfx_line(p8_core *core, int x0, int y0, int x1, int y1, uint8_t color)
{
    if (!core) {
        return;
    }
    int x = bounded_coordinate(x0);
    int y = bounded_coordinate(y0);
    const int target_x = bounded_coordinate(x1);
    const int target_y = bounded_coordinate(y1);
    const int delta_x = target_x >= x ? target_x - x : x - target_x;
    const int step_x = x < target_x ? 1 : -1;
    const int delta_y = -(target_y >= y ? target_y - y : y - target_y);
    const int step_y = y < target_y ? 1 : -1;
    int error = delta_x + delta_y;
    const uint8_t mapped = mapped_color(core, color);
    for (;;) {
        draw_mapped_pixel(core, x, y, mapped);
        if (x == target_x && y == target_y) {
            break;
        }
        const int twice_error = 2 * error;
        if (twice_error >= delta_y) {
            error += delta_y;
            x += step_x;
        }
        if (twice_error <= delta_x) {
            error += delta_x;
            y += step_y;
        }
    }
}

void p8_gfx_rect(p8_core *core, int x0, int y0, int x1, int y1, uint8_t color)
{
    if (!core) {
        return;
    }
    const int left = std::min(bounded_coordinate(x0), bounded_coordinate(x1));
    const int right = std::max(bounded_coordinate(x0), bounded_coordinate(x1));
    const int top = std::min(bounded_coordinate(y0), bounded_coordinate(y1));
    const int bottom = std::max(bounded_coordinate(y0), bounded_coordinate(y1));
    const uint8_t mapped = mapped_color(core, color);
    draw_mapped_span(core, left, right, top, mapped);
    if (bottom != top) {
        draw_mapped_span(core, left, right, bottom, mapped);
    }
    for (int y = top + 1; y < bottom; ++y) {
        draw_mapped_pixel(core, left, y, mapped);
        if (right != left) {
            draw_mapped_pixel(core, right, y, mapped);
        }
    }
}

void p8_gfx_rectfill(p8_core *core, int x0, int y0, int x1, int y1, uint8_t color)
{
    if (!core) {
        return;
    }
    const int left = std::min(bounded_coordinate(x0), bounded_coordinate(x1));
    const int right = std::max(bounded_coordinate(x0), bounded_coordinate(x1));
    const int top = std::min(bounded_coordinate(y0), bounded_coordinate(y1));
    const int bottom = std::max(bounded_coordinate(y0), bounded_coordinate(y1));
    const uint8_t mapped = mapped_color(core, color);
    for (int y = top; y <= bottom; ++y) {
        draw_mapped_span(core, left, right, y, mapped);
    }
}

void p8_gfx_circ(p8_core *core, int center_x, int center_y, int radius, uint8_t color)
{
    raster_circle(core, center_x, center_y, radius, mapped_color(core, color),
                  circle_octants);
}

void p8_gfx_circfill(p8_core *core, int center_x, int center_y, int radius,
                     uint8_t color)
{
    raster_circle(core, center_x, center_y, radius, mapped_color(core, color),
                  circle_spans);
}

void p8_gfx_spr(p8_core *core, int sprite, int x, int y, int width, int height,
                int flip_x, int flip_y)
{
    if (!core || width <= 0 || height <= 0) {
        return;
    }
    const int sprite_index = sprite & 0xff;
    const int source_x = (sprite_index & 0x0f) * 8;
    const int source_y = ((sprite_index >> 4) & 0x0f) * 8;
    const int pixel_width = std::min(width, 16) * 8;
    const int pixel_height = std::min(height, 16) * 8;
    for (int destination_y = 0; destination_y < pixel_height; ++destination_y) {
        const int sample_y = flip_y ? pixel_height - destination_y - 1 : destination_y;
        for (int destination_x = 0; destination_x < pixel_width; ++destination_x) {
            const int sample_x = flip_x ? pixel_width - destination_x - 1 : destination_x;
            const uint8_t color = p8_gfx_sget(core, source_x + sample_x, source_y + sample_y);
            if (!p8_gfx_is_transparent(core, color)) {
                draw_mapped_pixel(core, static_cast<int64_t>(x) + destination_x,
                                  static_cast<int64_t>(y) + destination_y,
                                  mapped_color(core, color));
            }
        }
    }
}

void p8_gfx_map(p8_core *core, int cell_x, int cell_y, int screen_x, int screen_y,
                int cell_width, int cell_height, uint8_t layer)
{
    if (!core || cell_width <= 0 || cell_height <= 0) {
        return;
    }
    for (int y = 0; y < cell_height; ++y) {
        for (int x = 0; x < cell_width; ++x) {
            const uint8_t sprite = p8_core_mget(core, cell_x + x, cell_y + y);
            const uint8_t flags = p8_core_peek(core,
                static_cast<uint16_t>(kSpriteFlagsBase + sprite));
            if (layer == 0 || (flags & layer) != 0) {
                p8_gfx_spr(core, sprite, screen_x + x * 8, screen_y + y * 8,
                           1, 1, 0, 0);
            }
        }
    }
}

size_t p8_gfx_copy_framebuffer_indexed(const p8_core *core, uint8_t *destination,
                                       size_t capacity)
{
    if (!core || !destination || capacity < P8_SCREEN_PIXELS) {
        return 0;
    }
    for (int y = 0; y < P8_SCREEN_HEIGHT; ++y) {
        for (int x = 0; x < P8_SCREEN_WIDTH; ++x) {
            destination[y * P8_SCREEN_WIDTH + x] = raw_pixel(core, kScreenBase, x, y);
        }
    }
    return P8_SCREEN_PIXELS;
}

} // extern "C"
