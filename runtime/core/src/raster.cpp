#include "p8/raster.h"

#include "core_internal.h"

#include <algorithm>
#include <array>
#include <cstdint>
#include <limits>

namespace {

constexpr uint16_t kDrawPalette = 0x5f00;
constexpr uint16_t kDisplayPalette = 0x5f10;
constexpr uint16_t kClipX = 0x5f20;
constexpr uint16_t kClipY = 0x5f21;
constexpr uint16_t kClipWidth = 0x5f22;
constexpr uint16_t kClipHeight = 0x5f23;
constexpr uint16_t kDrawColor = 0x5f25;
constexpr uint16_t kCursorX = 0x5f26;
constexpr uint16_t kCursorY = 0x5f27;
constexpr uint16_t kCameraX = 0x5f28;
constexpr uint16_t kCameraY = 0x5f2a;
constexpr uint16_t kFillPatternLow = 0x5f31;
constexpr uint16_t kFillPatternFlags = 0x5f33;
constexpr uint16_t kColorSettingFlags = 0x5f34;
constexpr uint16_t kMapSpriteZeroMode = 0x5f36;
constexpr uint16_t kSgetOutOfBoundsValue = 0x5f59;
constexpr uint16_t kPgetOutOfBoundsValue = 0x5f5b;
constexpr uint16_t kTlineMaskX = 0x5f38;
constexpr uint16_t kTlineMaskY = 0x5f39;
constexpr uint16_t kTlineOffsetX = 0x5f3a;
constexpr uint16_t kTlineOffsetY = 0x5f3b;
constexpr uint16_t kGfxBase = 0x0000;
constexpr uint16_t kSpriteFlagsBase = 0x3000;
constexpr uint16_t kScreenBase = 0x6000;
constexpr uint8_t kColorMask = 0x0f;
constexpr uint8_t kTransparentBit = 0x10;
constexpr uint8_t kFillTransparent = 1u << 0;
constexpr uint8_t kFillSprites = 1u << 1;
constexpr uint8_t kFillGlobal = 1u << 2;
constexpr uint8_t kColorEmbeddedPattern = 1u << 0;
constexpr uint8_t kColorInvertedFill = 1u << 1;

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

void draw_patterned_pixel(p8_core *core, int64_t world_x, int64_t world_y,
                          uint8_t color)
{
    if (!core) return;
    const int64_t screen_x = world_x - signed_word(core, kCameraX);
    const int64_t screen_y = world_y - signed_word(core, kCameraY);
    if (screen_x < 0 || screen_y < 0 || screen_x >= P8_SCREEN_WIDTH
        || screen_y >= P8_SCREEN_HEIGHT) return;
    const int x = static_cast<int>(screen_x);
    const int y = static_cast<int>(screen_y);
    if (!inside_clip(core, x, y)) return;
    const uint16_t pattern = p8_core_peek16(core, kFillPatternLow);
    const unsigned bit = static_cast<unsigned>((3 - (x & 3)) + (3 - (y & 3)) * 4);
    const bool secondary = (pattern & (1u << bit)) != 0;
    const uint8_t flags = p8_core_peek(core, kFillPatternFlags);
    if (secondary && (flags & kFillTransparent) != 0) return;
    uint8_t selected = 0;
    if ((flags & kFillGlobal) != 0) {
        const uint8_t mapped = mapped_color(core, color);
        const uint8_t pair = p8_core_secondary_palette_get(core, mapped);
        selected = secondary ? static_cast<uint8_t>(pair >> 4u)
                             : static_cast<uint8_t>(pair & kColorMask);
    } else {
        selected = mapped_color(core, secondary ? static_cast<uint8_t>(color >> 4u)
                                                : static_cast<uint8_t>(color & kColorMask));
    }
    raw_set_pixel(core, kScreenBase, x, y, selected);
}

void draw_sprite_pixel(p8_core *core, int64_t world_x, int64_t world_y,
                       uint8_t source_color)
{
    const uint8_t mapped = mapped_color(core, source_color);
    uint8_t selected = mapped;
    const uint8_t flags = p8_core_peek(core, kFillPatternFlags);
    if ((flags & kFillSprites) != 0) {
        const int64_t screen_x = world_x - signed_word(core, kCameraX);
        const int64_t screen_y = world_y - signed_word(core, kCameraY);
        const unsigned bit = static_cast<unsigned>((3 - (screen_x & 3))
                                                   + (3 - (screen_y & 3)) * 4);
        const bool secondary = (p8_core_peek16(core, kFillPatternLow)
                                & (1u << bit)) != 0;
        if (secondary && (flags & kFillTransparent) != 0) return;
        const uint8_t pair = p8_core_secondary_palette_get(core, mapped);
        selected = secondary ? static_cast<uint8_t>(pair >> 4u)
                             : static_cast<uint8_t>(pair & kColorMask);
    }
    draw_mapped_pixel(core, world_x, world_y, selected);
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
        draw_patterned_pixel(core, x + camera_x, world_y, color);
    }
}

void mark_mapped_span(const p8_core *core,
                      std::array<uint8_t, P8_SCREEN_PIXELS> &mask,
                      int64_t world_x0, int64_t world_x1, int64_t world_y)
{
    if (!core) return;
    if (world_x0 > world_x1) std::swap(world_x0, world_x1);
    const int64_t screen_y = world_y - signed_word(core, kCameraY);
    if (screen_y < 0 || screen_y >= P8_SCREEN_HEIGHT) return;
    const int camera_x = signed_word(core, kCameraX);
    int64_t screen_x0 = std::max<int64_t>(0, world_x0 - camera_x);
    int64_t screen_x1 = std::min<int64_t>(P8_SCREEN_WIDTH - 1, world_x1 - camera_x);
    for (int64_t screen_x = screen_x0; screen_x <= screen_x1; ++screen_x) {
        mask[static_cast<size_t>(screen_y) * P8_SCREEN_WIDTH
             + static_cast<size_t>(screen_x)] = 1;
    }
}

template <typename Inside>
void draw_inverted_clip(p8_core *core, uint8_t color, Inside inside)
{
    if (!core) return;
    const int clip_x = p8_core_peek(core, kClipX);
    const int clip_y = p8_core_peek(core, kClipY);
    const int clip_right = std::min(static_cast<int>(P8_SCREEN_WIDTH),
                                    clip_x + p8_core_peek(core, kClipWidth));
    const int clip_bottom = std::min(static_cast<int>(P8_SCREEN_HEIGHT),
                                     clip_y + p8_core_peek(core, kClipHeight));
    const int camera_x = signed_word(core, kCameraX);
    const int camera_y = signed_word(core, kCameraY);
    for (int screen_y = std::max(0, clip_y); screen_y < clip_bottom; ++screen_y) {
        for (int screen_x = std::max(0, clip_x); screen_x < clip_right; ++screen_x) {
            if (!inside(screen_x, screen_y)) {
                draw_patterned_pixel(core, screen_x + camera_x,
                                     screen_y + camera_y, color);
            }
        }
    }
}

void circle_octants(p8_core *core, int64_t cx, int64_t cy, int x, int y,
                    uint8_t color)
{
    draw_patterned_pixel(core, cx + x, cy + y, color);
    draw_patterned_pixel(core, cx + y, cy + x, color);
    draw_patterned_pixel(core, cx - y, cy + x, color);
    draw_patterned_pixel(core, cx - x, cy + y, color);
    draw_patterned_pixel(core, cx - x, cy - y, color);
    draw_patterned_pixel(core, cx - y, cy - x, color);
    draw_patterned_pixel(core, cx + y, cy - x, color);
    draw_patterned_pixel(core, cx + x, cy - y, color);
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

struct row_bounds {
    int64_t left = 1;
    int64_t right = 0;

    bool valid() const { return left <= right; }
    bool contains(int64_t x) const { return valid() && x >= left && x <= right; }
};

template <typename Plot>
void raster_ellipse_points(int x0, int y0, int x1, int y1, Plot plot)
{
    const int64_t left = std::min<int64_t>(bounded_coordinate(x0), bounded_coordinate(x1));
    const int64_t right = std::max<int64_t>(bounded_coordinate(x0), bounded_coordinate(x1));
    const int64_t top = std::min<int64_t>(bounded_coordinate(y0), bounded_coordinate(y1));
    const int64_t bottom = std::max<int64_t>(bounded_coordinate(y0), bounded_coordinate(y1));
    if (left == right || top == bottom || right - left < 2 || bottom - top < 2) {
        for (int64_t x = left; x <= right; ++x) {
            plot(x, top);
            plot(x, bottom);
        }
        for (int64_t y = top; y <= bottom; ++y) {
            plot(left, y);
            plot(right, y);
        }
        return;
    }

    // PICO-8 uses a two-region midpoint ellipse. Generate one upper-left
    // quadrant and reflect it across the exact doubled centre; this preserves
    // the half-pixel symmetry of even-sized bounding boxes without inventing
    // a second fill algorithm.
    const int64_t radius_x = (right - left) / 2;
    const int64_t radius_y = (bottom - top) / 2;
    const int64_t center_x = left + radius_x;
    const int64_t center_y = top + radius_y;
    const int64_t center_x2 = left + right;
    const int64_t center_y2 = top + bottom;
    const auto emit = [&](int64_t offset_x, int64_t offset_y) {
        const int64_t x_left = center_x - offset_x;
        const int64_t x_right = center_x2 - x_left;
        const int64_t y_top = center_y - offset_y;
        const int64_t y_bottom = center_y2 - y_top;
        plot(x_left, y_top);
        plot(x_right, y_top);
        plot(x_left, y_bottom);
        plot(x_right, y_bottom);
    };

    const int64_t a_squared = radius_x * radius_x;
    const int64_t b_squared = radius_y * radius_y;
    int64_t x = 0;
    int64_t y = radius_y;
    int64_t x_accumulator = 0;
    int64_t y_accumulator = a_squared * 2 * radius_y;
    int64_t threshold = a_squared / 4 - a_squared * radius_y;
    emit(0, radius_y);
    for (;;) {
        threshold += x_accumulator + b_squared;
        if (threshold >= 0) {
            y_accumulator -= a_squared * 2;
            threshold -= y_accumulator;
            --y;
        }
        x_accumulator += b_squared * 2;
        ++x;
        if (x_accumulator >= y_accumulator) break;
        emit(x, y);
    }

    emit(radius_x, 0);
    x = radius_x;
    y = 0;
    x_accumulator = b_squared * 2 * radius_x;
    y_accumulator = 0;
    threshold = b_squared / 4 - b_squared * radius_x;
    for (;;) {
        threshold += y_accumulator + a_squared;
        if (threshold >= 0) {
            x_accumulator -= b_squared * 2;
            threshold -= x_accumulator;
            --x;
        }
        y_accumulator += a_squared * 2;
        ++y;
        if (y_accumulator > x_accumulator
            || (y_accumulator == 0 && x_accumulator == 0)) break;
        emit(x, y);
    }
}

struct visible_row_extents {
    std::array<int64_t, P8_SCREEN_HEIGHT> left{};
    std::array<int64_t, P8_SCREEN_HEIGHT> right{};

    visible_row_extents()
    {
        left.fill(std::numeric_limits<int64_t>::max());
        right.fill(std::numeric_limits<int64_t>::min());
    }
};

visible_row_extents ellipse_extents(const p8_core *core, int x0, int y0, int x1, int y1)
{
    visible_row_extents extents;
    if (!core) return extents;
    const int camera_y = signed_word(core, kCameraY);
    raster_ellipse_points(x0, y0, x1, y1, [&](int64_t world_x, int64_t world_y) {
        const int64_t screen_y = world_y - camera_y;
        if (screen_y < 0 || screen_y >= P8_SCREEN_HEIGHT) return;
        const size_t row = static_cast<size_t>(screen_y);
        extents.left[row] = std::min(extents.left[row], world_x);
        extents.right[row] = std::max(extents.right[row], world_x);
    });
    return extents;
}

constexpr int kRoundedRectFirstScreenRow = -1;
constexpr int kRoundedRectLastScreenRow = P8_SCREEN_HEIGHT;
constexpr size_t kRoundedRectRowCount =
    static_cast<size_t>(kRoundedRectLastScreenRow - kRoundedRectFirstScreenRow + 1);
constexpr int64_t kPicoCoordinateSpan = 65536;

struct rounded_rect_geometry {
    std::array<row_bounds, kRoundedRectRowCount> rows{};

    const row_bounds &at(int screen_y) const
    {
        return rows[static_cast<size_t>(screen_y - kRoundedRectFirstScreenRow)];
    }
};

rounded_rect_geometry build_rounded_rect_geometry(const p8_core *core, int x, int y,
                                                  int width, int height, int radius)
{
    rounded_rect_geometry geometry;
    if (!core || width <= 0 || height <= 0) return geometry;
    const int64_t left = bounded_coordinate(x);
    const int64_t top = bounded_coordinate(y);
    // Public C callers are not constrained by the VM's 16.16 conversion.
    // Bounding dimensions to the PICO coordinate domain prevents an extreme
    // host integer from turning a single draw into unbounded work.
    const int64_t shape_width = std::min<int64_t>(width, kPicoCoordinateSpan);
    const int64_t shape_height = std::min<int64_t>(height, kPicoCoordinateSpan);
    const int64_t maximum_radius = std::min(shape_width, shape_height) / 2;
    const int64_t clamped_radius = std::max<int64_t>(0, std::min<int64_t>(
        radius, maximum_radius));
    const int64_t arc_radius = clamped_radius > 0
        ? std::min(clamped_radius + 1, maximum_radius)
        : 0;
    const int camera_y = signed_word(core, kCameraY);

    std::array<int64_t, kRoundedRectRowCount> cuts{};
    std::array<int64_t, kRoundedRectRowCount> target_by_row{};
    std::array<int64_t, kRoundedRectRowCount> unique_targets{};
    target_by_row.fill(-1);
    size_t target_count = 0;
    for (int screen_y = kRoundedRectFirstScreenRow;
         screen_y <= kRoundedRectLastScreenRow; ++screen_y) {
        const size_t index = static_cast<size_t>(screen_y - kRoundedRectFirstScreenRow);
        const int64_t world_y = static_cast<int64_t>(screen_y) + camera_y;
        const int64_t row = world_y - top;
        if (row < 0 || row >= shape_height) continue;
        const int64_t corner_row = std::min(row, shape_height - 1 - row);
        if (clamped_radius > 0 && corner_row < clamped_radius) {
            const int64_t target_y = arc_radius - corner_row;
            target_by_row[index] = target_y;
            unique_targets[target_count++] = target_y;
            cuts[index] = clamped_radius;
        }
        geometry.rows[index] = row_bounds{
            left + cuts[index], left + shape_width - 1 - cuts[index]};
    }

    if (target_count == 0) return geometry;
    std::sort(unique_targets.begin(), unique_targets.begin() + target_count);
    target_count = static_cast<size_t>(
        std::unique(unique_targets.begin(), unique_targets.begin() + target_count)
        - unique_targets.begin());
    std::array<int64_t, kRoundedRectRowCount> maximum_x{};
    maximum_x.fill(-1);
    const auto record = [&](int64_t target_y, int64_t candidate_x) {
        const auto begin = unique_targets.begin();
        const auto end = begin + target_count;
        const auto found = std::lower_bound(begin, end, target_y);
        if (found == end || *found != target_y) return;
        const size_t index = static_cast<size_t>(found - begin);
        maximum_x[index] = std::max(maximum_x[index], candidate_x);
    };

    // Generate the midpoint circle once per draw, then reuse its requested
    // scanlines for fill and outline. Work is O(radius + visible rows), not
    // O(radius * visible rows).
    int64_t circle_x = arc_radius;
    int64_t circle_y = 0;
    int64_t error = 1 - circle_x;
    while (circle_x >= circle_y) {
        record(circle_y, circle_x);
        record(circle_x, circle_y);
        ++circle_y;
        if (error < 0) {
            error += 2 * circle_y + 1;
        } else {
            --circle_x;
            error += 2 * (circle_y - circle_x) + 1;
        }
    }

    for (size_t index = 0; index < kRoundedRectRowCount; ++index) {
        const int64_t target_y = target_by_row[index];
        if (target_y < 0) continue;
        const auto begin = unique_targets.begin();
        const auto found = std::lower_bound(begin, begin + target_count, target_y);
        const size_t target_index = static_cast<size_t>(found - begin);
        if (found != begin + target_count && *found == target_y
            && maximum_x[target_index] >= 0) {
            cuts[index] = arc_radius - maximum_x[target_index];
        }
        geometry.rows[index] = row_bounds{
            left + cuts[index], left + shape_width - 1 - cuts[index]};
    }
    return geometry;
}

template <typename Span>
void rounded_rect_spans(const p8_core *core, int x, int y, int width, int height,
                        int radius, Span span)
{
    if (!core || width <= 0 || height <= 0) return;
    const rounded_rect_geometry geometry =
        build_rounded_rect_geometry(core, x, y, width, height, radius);
    const int camera_y = signed_word(core, kCameraY);
    const int first_screen_y = p8_core_peek(core, kClipY);
    const int last_screen_y = std::min(static_cast<int>(P8_SCREEN_HEIGHT),
        static_cast<int>(p8_core_peek(core, kClipY))
        + static_cast<int>(p8_core_peek(core, kClipHeight)));
    for (int screen_y = first_screen_y; screen_y < last_screen_y; ++screen_y) {
        const int64_t world_y = static_cast<int64_t>(screen_y) + camera_y;
        const row_bounds bounds = geometry.at(screen_y);
        if (!bounds.valid()) continue;
        span(bounds.left, bounds.right, world_y, false);
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
    p8_gfx_fillp(core, 0);
    p8_core_poke(core, kDrawColor, 6);
    p8_core_poke(core, kCursorX, 0);
    p8_core_poke(core, kCursorY, 0);
}

uint8_t p8_gfx_pget(const p8_core *core, int x, int y)
{
    if (core && (x < 0 || y < 0 || x >= P8_SCREEN_WIDTH || y >= P8_SCREEN_HEIGHT)
        && (p8_core_peek(core, kMapSpriteZeroMode) & 0x10u) != 0) {
        return p8_core_peek(core, kPgetOutOfBoundsValue);
    }
    return raw_pixel(core, kScreenBase, x, y);
}

void p8_gfx_pset(p8_core *core, int x, int y, uint8_t color)
{
    draw_patterned_pixel(core, bounded_coordinate(x), bounded_coordinate(y), color);
}

uint8_t p8_gfx_sget(const p8_core *core, int x, int y)
{
    if (core && (x < 0 || y < 0 || x >= P8_SCREEN_WIDTH || y >= P8_SCREEN_HEIGHT)
        && (p8_core_peek(core, kMapSpriteZeroMode) & 0x10u) != 0) {
        return p8_core_peek(core, kSgetOutOfBoundsValue);
    }
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
    p8_gfx_pal_mode(core, source, target, 0);
}

void p8_gfx_pal_mode(p8_core *core, uint8_t source, uint8_t target, uint8_t palette)
{
    if (!core) {
        return;
    }
    if (palette == 0) {
        const uint16_t address =
            static_cast<uint16_t>(kDrawPalette + (source & kColorMask));
        const uint8_t transparency = p8_core_peek(core, address) & kTransparentBit;
        p8_core_poke(core, address,
                     static_cast<uint8_t>(transparency | (target & kColorMask)));
    } else if (palette == 1) {
        p8_core_poke(core, static_cast<uint16_t>(kDisplayPalette + (source & kColorMask)),
                     static_cast<uint8_t>(target & 0x8f));
    } else if (palette == 2) {
        p8_core_secondary_palette_set(core, source, target);
    }
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
    p8_core_secondary_palette_reset(core);
}

void p8_gfx_pal_reset_mode(p8_core *core, uint8_t palette)
{
    if (!core) return;
    if (palette == 0) {
        for (uint8_t color = 0; color <= kColorMask; ++color) {
            const uint16_t address = static_cast<uint16_t>(kDrawPalette + color);
            const uint8_t transparency = p8_core_peek(core, address) & kTransparentBit;
            p8_core_poke(core, address, static_cast<uint8_t>(transparency | color));
        }
    } else if (palette == 1) {
        for (uint8_t color = 0; color <= kColorMask; ++color) {
            p8_core_poke(core, static_cast<uint16_t>(kDisplayPalette + color), color);
        }
    } else if (palette == 2) {
        p8_core_secondary_palette_reset(core);
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

int32_t p8_gfx_fillp(p8_core *core, int32_t raw_pattern)
{
    if (!core) return 0;
    const uint8_t previous_flags = p8_core_peek(core, kFillPatternFlags);
    const int32_t previous = static_cast<int32_t>(p8_core_peek16(core, kFillPatternLow)) << 16
        | ((previous_flags & kFillTransparent) != 0 ? 0x8000 : 0)
        | ((previous_flags & kFillSprites) != 0 ? 0x4000 : 0)
        | ((previous_flags & kFillGlobal) != 0 ? 0x2000 : 0);
    const uint16_t pattern = static_cast<uint16_t>(static_cast<uint32_t>(raw_pattern) >> 16);
    p8_core_poke16(core, kFillPatternLow, pattern);
    const uint32_t raw = static_cast<uint32_t>(raw_pattern);
    const uint8_t flags = static_cast<uint8_t>(
        ((raw & 0x8000u) != 0 ? kFillTransparent : 0)
        | ((raw & 0x4000u) != 0 ? kFillSprites : 0)
        | ((raw & 0x2000u) != 0 ? kFillGlobal : 0));
    p8_core_poke(core, kFillPatternFlags, flags);
    return previous;
}

uint8_t p8_gfx_apply_color_argument(p8_core *core, int32_t raw_color)
{
    const uint32_t raw = static_cast<uint32_t>(raw_color);
    if (core
        && (p8_core_peek(core, kColorSettingFlags) & kColorEmbeddedPattern) != 0
        && (raw & 0x10000000u) != 0) {
        p8_core_poke16(core, kFillPatternLow, static_cast<uint16_t>(raw));
        const uint8_t flags = static_cast<uint8_t>(
            ((raw & 0x01000000u) != 0 ? kFillTransparent : 0)
            | ((raw & 0x02000000u) != 0 ? kFillSprites : 0)
            | ((raw & 0x04000000u) != 0 ? kFillGlobal : 0));
        p8_core_poke(core, kFillPatternFlags, flags);
    }
    return static_cast<uint8_t>((raw >> 16u) & 0xffu);
}

int p8_gfx_color_argument_requests_inversion(const p8_core *core,
                                             int32_t raw_color)
{
    if (!core) return 0;
    const uint32_t raw = static_cast<uint32_t>(raw_color);
    return (p8_core_peek(core, kColorSettingFlags) & kColorEmbeddedPattern) != 0
        && (raw & 0x10000000u) != 0
        && (raw & 0x08000000u) != 0;
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
    for (;;) {
        draw_patterned_pixel(core, x, y, color);
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
    draw_mapped_span(core, left, right, top, color);
    if (bottom != top) {
        draw_mapped_span(core, left, right, bottom, color);
    }
    for (int y = top + 1; y < bottom; ++y) {
        draw_patterned_pixel(core, left, y, color);
        if (right != left) {
            draw_patterned_pixel(core, right, y, color);
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
    if ((p8_core_peek(core, kColorSettingFlags) & kColorInvertedFill) != 0) {
        const int camera_x = signed_word(core, kCameraX);
        const int camera_y = signed_word(core, kCameraY);
        draw_inverted_clip(core, color, [&](int screen_x, int screen_y) {
            const int64_t world_x = static_cast<int64_t>(screen_x) + camera_x;
            const int64_t world_y = static_cast<int64_t>(screen_y) + camera_y;
            return world_x >= left && world_x <= right
                && world_y >= top && world_y <= bottom;
        });
        return;
    }
    for (int y = top; y <= bottom; ++y) {
        draw_mapped_span(core, left, right, y, color);
    }
}

void p8_gfx_circ(p8_core *core, int center_x, int center_y, int radius, uint8_t color)
{
    raster_circle(core, center_x, center_y, radius, color,
                  circle_octants);
}

void p8_gfx_circfill(p8_core *core, int center_x, int center_y, int radius,
                     uint8_t color)
{
    if (!core || radius < 0) return;
    if ((p8_core_peek(core, kColorSettingFlags) & kColorInvertedFill) != 0) {
        std::array<uint8_t, P8_SCREEN_PIXELS> mask{};
        raster_circle(core, center_x, center_y, radius, 0,
                      [&](p8_core *circle_core, int64_t cx, int64_t cy,
                          int x, int y, uint8_t) {
            mark_mapped_span(circle_core, mask, cx - x, cx + x, cy + y);
            mark_mapped_span(circle_core, mask, cx - x, cx + x, cy - y);
            mark_mapped_span(circle_core, mask, cx - y, cx + y, cy + x);
            mark_mapped_span(circle_core, mask, cx - y, cx + y, cy - x);
        });
        draw_inverted_clip(core, color, [&](int screen_x, int screen_y) {
            return mask[static_cast<size_t>(screen_y) * P8_SCREEN_WIDTH
                        + static_cast<size_t>(screen_x)] != 0;
        });
        return;
    }
    raster_circle(core, center_x, center_y, radius, color,
                  circle_spans);
}

void p8_gfx_oval(p8_core *core, int x0, int y0, int x1, int y1, uint8_t color)
{
    if (!core) return;
    raster_ellipse_points(x0, y0, x1, y1, [&](int64_t world_x, int64_t world_y) {
        draw_patterned_pixel(core, world_x, world_y, color);
    });
}

void p8_gfx_ovalfill(p8_core *core, int x0, int y0, int x1, int y1, uint8_t color)
{
    if (!core) return;
    const visible_row_extents extents = ellipse_extents(core, x0, y0, x1, y1);
    const int camera_y = signed_word(core, kCameraY);
    if ((p8_core_peek(core, kColorSettingFlags) & kColorInvertedFill) != 0) {
        std::array<uint8_t, P8_SCREEN_PIXELS> mask{};
        for (int screen_y = 0; screen_y < P8_SCREEN_HEIGHT; ++screen_y) {
            if (extents.left[static_cast<size_t>(screen_y)]
                > extents.right[static_cast<size_t>(screen_y)]) continue;
            mark_mapped_span(core, mask,
                             extents.left[static_cast<size_t>(screen_y)],
                             extents.right[static_cast<size_t>(screen_y)],
                             static_cast<int64_t>(screen_y) + camera_y);
        }
        draw_inverted_clip(core, color, [&](int screen_x, int screen_y) {
            return mask[static_cast<size_t>(screen_y) * P8_SCREEN_WIDTH
                        + static_cast<size_t>(screen_x)] != 0;
        });
        return;
    }
    for (int screen_y = 0; screen_y < P8_SCREEN_HEIGHT; ++screen_y) {
        if (extents.left[static_cast<size_t>(screen_y)]
            > extents.right[static_cast<size_t>(screen_y)]) continue;
        draw_mapped_span(core,
                         extents.left[static_cast<size_t>(screen_y)],
                         extents.right[static_cast<size_t>(screen_y)],
                         static_cast<int64_t>(screen_y) + camera_y, color);
    }
}

void p8_gfx_rrect(p8_core *core, int x, int y, int width, int height, int radius,
                  uint8_t color)
{
    if (!core || width <= 0 || height <= 0) return;
    const rounded_rect_geometry geometry =
        build_rounded_rect_geometry(core, x, y, width, height, radius);
    const int camera_x = signed_word(core, kCameraX);
    const int camera_y = signed_word(core, kCameraY);
    for (int screen_y = 0; screen_y < P8_SCREEN_HEIGHT; ++screen_y) {
        const int64_t world_y = static_cast<int64_t>(screen_y) + camera_y;
        const row_bounds current = geometry.at(screen_y);
        if (!current.valid()) continue;
        const row_bounds previous = geometry.at(screen_y - 1);
        const row_bounds next = geometry.at(screen_y + 1);
        for (int screen_x = 0; screen_x < P8_SCREEN_WIDTH; ++screen_x) {
            const int64_t world_x = static_cast<int64_t>(screen_x) + camera_x;
            if (!current.contains(world_x)) continue;
            if (world_x == current.left || world_x == current.right
                || !previous.contains(world_x) || !next.contains(world_x)) {
                draw_patterned_pixel(core, world_x, world_y, color);
            }
        }
    }
}

void p8_gfx_rrectfill(p8_core *core, int x, int y, int width, int height, int radius,
                      uint8_t color)
{
    if (!core || width <= 0 || height <= 0) return;
    if ((p8_core_peek(core, kColorSettingFlags) & kColorInvertedFill) != 0) {
        std::array<uint8_t, P8_SCREEN_PIXELS> mask{};
        rounded_rect_spans(core, x, y, width, height, radius,
            [&](int64_t left, int64_t right, int64_t world_y, bool) {
                mark_mapped_span(core, mask, left, right, world_y);
            });
        draw_inverted_clip(core, color, [&](int screen_x, int screen_y) {
            return mask[static_cast<size_t>(screen_y) * P8_SCREEN_WIDTH
                        + static_cast<size_t>(screen_x)] != 0;
        });
        return;
    }
    rounded_rect_spans(core, x, y, width, height, radius,
        [&](int64_t left, int64_t right, int64_t world_y, bool) {
            draw_mapped_span(core, left, right, world_y, color);
        });
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
                draw_sprite_pixel(core, static_cast<int64_t>(x) + destination_x,
                                  static_cast<int64_t>(y) + destination_y, color);
            }
        }
    }
}

void p8_gfx_sspr(p8_core *core, int source_x, int source_y, int source_width,
                 int source_height, int destination_x, int destination_y,
                 int destination_width, int destination_height,
                 int flip_x, int flip_y)
{
    if (!core || source_width <= 0 || source_height <= 0
        || destination_width <= 0 || destination_height <= 0) {
        return;
    }
    for (int y = 0; y < destination_height; ++y) {
        int sample_y = static_cast<int>((static_cast<int64_t>(y) * source_height)
                                        / destination_height);
        if (flip_y) sample_y = source_height - sample_y - 1;
        for (int x = 0; x < destination_width; ++x) {
            int sample_x = static_cast<int>((static_cast<int64_t>(x) * source_width)
                                            / destination_width);
            if (flip_x) sample_x = source_width - sample_x - 1;
            const uint8_t color = p8_gfx_sget(core, source_x + sample_x,
                                              source_y + sample_y);
            if (!p8_gfx_is_transparent(core, color)) {
                draw_sprite_pixel(core, static_cast<int64_t>(destination_x) + x,
                                  static_cast<int64_t>(destination_y) + y, color);
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
            // Sprite zero is normally the map-level empty sentinel. The shared
            // 0x5f36 compatibility register can make it drawable without
            // changing sprite transparency or the stored map cell.
            if (sprite == 0 && (p8_core_peek(core, kMapSpriteZeroMode) & 0x08u) == 0) {
                continue;
            }
            const uint8_t flags = p8_core_peek(core,
                static_cast<uint16_t>(kSpriteFlagsBase + sprite));
            if (layer == 0 || (flags & layer) != 0) {
                p8_gfx_spr(core, sprite, screen_x + x * 8, screen_y + y * 8,
                           1, 1, 0, 0);
            }
        }
    }
}

void p8_gfx_tline(p8_core *core, int x0, int y0, int x1, int y1,
                  int32_t map_x_raw, int32_t map_y_raw,
                  int32_t map_dx_raw, int32_t map_dy_raw,
                  uint8_t layer, unsigned fractional_bits)
{
    if (!core) {
        return;
    }

    // TLINE's precision register moves the binary point used by map sampling.
    // 13 fractional bits means one numeric tile is eight sampled pixels; 16
    // means the coordinates are already expressed in sampled pixels.
    const unsigned bits = std::min(fractional_bits, 16u);
    const auto coordinate_mask = [bits](uint8_t register_value) {
        const uint32_t tiles = register_value == 0 ? 256u : register_value;
        return (tiles << (bits + 3u)) - 1u;
    };
    const uint32_t mask_x = coordinate_mask(p8_core_peek(core, kTlineMaskX));
    const uint32_t mask_y = coordinate_mask(p8_core_peek(core, kTlineMaskY));
    const uint32_t offset_x = static_cast<uint32_t>(p8_core_peek(core, kTlineOffsetX))
                              << (bits + 3u);
    const uint32_t offset_y = static_cast<uint32_t>(p8_core_peek(core, kTlineOffsetY))
                              << (bits + 3u);
    const bool draw_sprite_zero = (p8_core_peek(core, kMapSpriteZeroMode) & 0x08u) != 0;

    int x = bounded_coordinate(x0);
    int y = bounded_coordinate(y0);
    const int target_x = bounded_coordinate(x1);
    const int target_y = bounded_coordinate(y1);
    const int delta_x = target_x >= x ? target_x - x : x - target_x;
    const int step_x = x < target_x ? 1 : -1;
    const int delta_y = -(target_y >= y ? target_y - y : y - target_y);
    const int step_y = y < target_y ? 1 : -1;
    int error = delta_x + delta_y;
    uint32_t sample_x_raw = static_cast<uint32_t>(map_x_raw);
    uint32_t sample_y_raw = static_cast<uint32_t>(map_y_raw);

    for (;;) {
        const uint32_t sampled_x = ((sample_x_raw & mask_x) + offset_x) >> bits;
        const uint32_t sampled_y = ((sample_y_raw & mask_y) + offset_y) >> bits;
        const uint8_t sprite = p8_core_mget(core,
            static_cast<int>(sampled_x >> 3u), static_cast<int>(sampled_y >> 3u));
        const uint8_t flags = p8_core_peek(core,
            static_cast<uint16_t>(kSpriteFlagsBase + sprite));
        if ((sprite != 0 || draw_sprite_zero) && (layer == 0 || (flags & layer) != 0)) {
            const int sprite_x = (sprite & 0x0f) * 8 + static_cast<int>(sampled_x & 7u);
            const int sprite_y = ((sprite >> 4) & 0x0f) * 8
                                 + static_cast<int>(sampled_y & 7u);
            const uint8_t color = p8_gfx_sget(core, sprite_x, sprite_y);
            if (!p8_gfx_is_transparent(core, color)) {
                draw_sprite_pixel(core, x, y, color);
            }
        }

        if (x == target_x && y == target_y) {
            break;
        }
        sample_x_raw += static_cast<uint32_t>(map_dx_raw);
        sample_y_raw += static_cast<uint32_t>(map_dy_raw);
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

void p8_gfx_text_pixel(p8_core *core, int x, int y, uint8_t color)
{
    if (core) {
        draw_mapped_pixel(core, bounded_coordinate(x), bounded_coordinate(y),
                          mapped_color(core, color));
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
