#include "p8/text.h"

#include "p8/raster.h"

#include "core_internal.h"

#include <algorithm>
#include <array>
#include <cstdint>
#include <limits>
#include <new>
#include <vector>

namespace {

constexpr uint16_t kDrawColor = 0x5f25;
constexpr uint16_t kCursorX = 0x5f26;
constexpr uint16_t kCursorY = 0x5f27;
constexpr uint16_t kPrintAttributes = 0x5f58;
constexpr uint16_t kCustomFont = 0x5600;

enum print_mode : uint8_t {
    mode_wide = 1u << 0,
    mode_tall = 1u << 1,
    mode_stripe = 1u << 2,
    mode_invert = 1u << 3,
    mode_solid = 1u << 4,
    mode_custom = 1u << 5,
};

// The byte table is the MIT-licensed FAKE-08/tac08 compatibility font, stored
// as hex to keep the generated data auditable and independent of host fonts.
constexpr char kBuiltinFontHex[] =
    "040805000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000007070707070000000007070700000000000705070000000000050205000000000005000500000000000505050000000004060706040000000103070301000000070101010000000000040404070000000507020702000000000002000000000000000001020000000000000303000000050500000000000002050200000000000000000000000000020202000200000005050000000000000507050705000000070306070200000005040201050000000303030507000000020100000000000002010101020000000204040402000000050207020500000000020702000000000000000201000000000007000000000000000000020000000402020201000000070505050700000003020202070000000704070107000000070406040700000005050704040000000701070407000000010107050700000007040404040000000705070507000000070507040400000000020002000000000002000201000000040201020400000000070007000000000102040201000000070406000200000002050501060000000007050705000000000303050700000000070101070000000003050503000000000703010700000000070301010000000007010507000000000505070500000000070202070000000007020203000000000503050500000000010101070000000007070505000000000305050500000000060505030000000007050701000000000205030600000000070503050000000006010403000000000702020200000000050505060000000005050702000000000505070700000000050205050000000005070407000000000704010700000003010101030000000102020204000000060404040600000002050000000000000000000007000000020400000000000007050705050000000705030507000000060101010600000003050505070000000701030107000000070103010100000006010105070000000505070505000000070202020700000007020202030000000505030505000000010101010700000007070505050000000305050505000000060505050300000007050701010000000205050306000000070503050500000006010704030000000702020202000000050505050600000005050507020000000505050707000000050502050500000005050704070000000704020107000000060203020600000002020202020000000302060203000000000407010000000000020505070000007f7f7f7f7f000000552a552a55000000417f5d5d3e0000003e6363773e0000001144114411000000043c1c1e100000001c2e3e3e1c000000363e3e1c080000001c3677361c0000001c1c3e1c140000001c3e7f2a3a0000003e6763673e0000007f5d7f417f0000003808080e0e0000003e636b633e000000081c3e1c0800000000005500000000003e7363733e000000081c7f3e220000003e1c081c3e0000003e7763633e000000000552200000000000112a44000000003e6b776b3e0000007f007f007f00000055555555550000000e041e2d2600000001112125020000001c003e2018000000081e08241a0000004e043e4526000000225f12120a0000001c3e1c021c000000300c020c30000000227a2222120000000e1000023c0000003e080e011e000000020202221c000000083e080c08000000123e12021c0000003c107e0870000000040e340272000000043f1c301e0000003c434020180000003e10080810000000083804023c000000620f2239580000007a42020a72000000093e4b6d66000000324b4663620000003c4a494926000000123a123a5a000000236222221c0000000c00082a4d000000000c1221400000003d113d196d0000001c3e081e2c00000006247e2610000000244e04463c0000000a3c5a46300000001e041e4438000000247e6408080000003a565230080000000838081e2600000008023e201c00000002222224100000003c107c723000000004362c26640000003c107c4230000000324b4623120000000e641c2878000000020e12513100000000000e1008000000000a1f1a0400000000040f150d00000000020e021d0000003e20140402000000300e080808000000083e20100c0000001c0808083e000000107e181618000000043e242232000000041e083e08000000043c221008000000047c1210080000003e2020203e000000247e242010000000081204601c0000003e20101826000000047e24043800000022242010080000007c445260100000001c083e08040000004a4a20100c0000001c003e080400000004041c2404000000083e080804000000001c00003e0000003e2028300c000000083e205f080000002020100806000000102424424200000002320e023c0000003e2020100c0000000c12214000000000083e082a4d0000003e201408100000003c003e001e000000080424625e00000040281068060000003e087e0870000000744e240808000000784020207c0000001e103e101e0000001c003e201800000024242420180000001414145432000000020202320e0000007e4242427e0000003e222010080000003e203e20180000000102100807000000001510080600000000021f120400000000000e081e000000000e1e080e00000008046310080000000810630408000000";
static_assert(sizeof(kBuiltinFontHex) == 2048u * 2u + 1u,
              "compatibility font table must contain exactly 2 KiB");

uint8_t hex_nibble(char value)
{
    if (value >= '0' && value <= '9') return static_cast<uint8_t>(value - '0');
    if (value >= 'a' && value <= 'f') return static_cast<uint8_t>(value - 'a' + 10);
    if (value >= 'A' && value <= 'F') return static_cast<uint8_t>(value - 'A' + 10);
    return 0;
}

uint8_t builtin_font_byte(uint8_t character, int row)
{
    const size_t byte_index = static_cast<size_t>(character) * 8u
                              + static_cast<size_t>(row);
    return static_cast<uint8_t>((hex_nibble(kBuiltinFontHex[byte_index * 2u]) << 4u)
                                | hex_nibble(kBuiltinFontHex[byte_index * 2u + 1u]));
}

int parameter(uint8_t value)
{
    if (value >= '0' && value <= '9') return value - '0';
    if (value >= 'a' && value <= 'z') return value - 'a' + 10;
    if (value >= 'A' && value <= 'Z') return value - 'A' + 10;
    return 0;
}

struct text_state {
    p8_core *core;
    int x;
    int y;
    int home_x;
    int home_y;
    int previous_x;
    int previous_y;
    int max_x;
    int line_height = 6;
    int forced_width = -1;
    int forced_height = -1;
    int tab_width = 4;
    int rhs = -1;
    uint8_t foreground;
    uint8_t background = 0;
    uint8_t outline_color = 0;
    uint8_t outline_neighbors = 0;
    uint8_t mode = 0;
    bool background_enabled = false;
    bool underline = false;
    bool outline_skip_interior = false;
    bool has_bounds = false;
    int min_x = 0;
    int min_y = 0;
    int max_draw_x = 0;
    int max_draw_y = 0;
    uint32_t unsupported = 0;
};

} // namespace

struct p8_text_job {
    std::vector<uint8_t> bytes;
    text_state state;
    size_t index = 0;
    int anchor_x = 0;
    int anchor_y = 0;
    uint8_t foreground_in = 0;
    uint8_t print_attributes = 0;
    bool append_newline = false;
    bool terminated = false;
    bool completed = false;
    uint16_t repeated_character = 0;
    unsigned repeat_remaining = 0;
    uint32_t character_delay = 0;
    bool requires_frames = false;
};

namespace {

void include_pixel(text_state &state, int x, int y)
{
    if (!state.has_bounds) {
        state.min_x = state.max_draw_x = x;
        state.min_y = state.max_draw_y = y;
        state.has_bounds = true;
        return;
    }
    state.min_x = std::min(state.min_x, x);
    state.min_y = std::min(state.min_y, y);
    state.max_draw_x = std::max(state.max_draw_x, x);
    state.max_draw_y = std::max(state.max_draw_y, y);
}

std::array<uint8_t, 8> character_rows(const text_state &state, uint8_t character)
{
    std::array<uint8_t, 8> rows{};
    if ((state.mode & mode_custom) != 0) {
        const uint16_t base = static_cast<uint16_t>(kCustomFont + character * 8u);
        for (int row = 0; row < 8; ++row) {
            rows[row] = p8_core_peek(state.core, static_cast<uint16_t>(base + row));
        }
    } else {
        for (int row = 0; row < 8; ++row) rows[row] = builtin_font_byte(character, row);
    }
    return rows;
}

void draw_rows(text_state &state, const std::array<uint8_t, 8> &rows,
               int x, int y, int render_width, int render_height,
               uint8_t foreground, bool draw_background)
{
    const int scale_x = (state.mode & mode_wide) != 0 ? 2 : 1;
    const int scale_y = (state.mode & mode_tall) != 0 ? 2 : 1;
    for (int source_y = 0; source_y < std::min(render_height, 8); ++source_y) {
        for (int source_x = 0; source_x < std::min(render_width, 8); ++source_x) {
            bool on = (rows[source_y] & (1u << source_x)) != 0;
            if ((state.mode & mode_invert) != 0) on = !on;
            for (int sy = 0; sy < scale_y; ++sy) {
                for (int sx = 0; sx < scale_x; ++sx) {
                    if ((state.mode & mode_stripe) != 0 && (sx != 0 || sy != 0)) continue;
                    if (on || draw_background) {
                        const int pixel_x = x + source_x * scale_x + sx;
                        const int pixel_y = y + source_y * scale_y + sy;
                        include_pixel(state, pixel_x, pixel_y);
                        p8_gfx_text_pixel(state.core, pixel_x, pixel_y,
                                          on ? foreground : state.background);
                    }
                }
            }
        }
    }
}

int custom_width_adjustment(const text_state &state, uint8_t character, int &y_offset)
{
    y_offset = 0;
    if ((state.mode & mode_custom) == 0 || (p8_core_peek(state.core, 0x5605) & 1u) == 0
        || character < 16) return 0;
    const unsigned index = character - 16u;
    const uint8_t packed = p8_core_peek(state.core,
        static_cast<uint16_t>(0x5608 + index / 2u));
    const uint8_t nibble = static_cast<uint8_t>((index & 1u) ? packed >> 4u : packed & 0x0fu);
    y_offset = (nibble & 8u) != 0 ? -1 : 0;
    const int width = nibble & 7u;
    return width >= 4 ? width - 8 : width;
}

int draw_character(text_state &state, uint8_t character,
                   const std::array<uint8_t, 8> *inline_rows = nullptr)
{
    const bool custom = (state.mode & mode_custom) != 0;
    const int base_width = inline_rows ? 8 : custom
        ? p8_core_peek(state.core, character < 0x80 ? 0x5600 : 0x5601)
        : (character < 0x80 ? 4 : 8);
    const int base_height = inline_rows ? 8 : custom ? p8_core_peek(state.core, 0x5602) : 5;
    const int render_width = inline_rows ? 8 : custom ? 8
        : (state.forced_width >= 0 ? state.forced_width + (character >= 0x80 ? 4 : 0)
                                   : base_width);
    const int render_height = state.forced_height >= 0 ? state.forced_height : base_height;
    int y_adjustment = 0;
    const int width_adjustment = inline_rows ? 0
        : custom_width_adjustment(state, character, y_adjustment);
    const int offset_x = custom ? static_cast<int8_t>(p8_core_peek(state.core, 0x5603)) : 0;
    const int offset_y = custom ? static_cast<int8_t>(p8_core_peek(state.core, 0x5604)) : 0;
    const std::array<uint8_t, 8> rows = inline_rows ? *inline_rows
                                                    : character_rows(state, character);
    const int draw_x = state.x + offset_x;
    const int draw_y = state.y + offset_y + y_adjustment;
    constexpr int neighbor_x[8] = {-1, 0, 1, -1, 1, -1, 0, 1};
    constexpr int neighbor_y[8] = {-1, -1, -1, 0, 0, 1, 1, 1};
    if (state.outline_neighbors != 0) {
        for (int neighbor = 0; neighbor < 8; ++neighbor) {
            if ((state.outline_neighbors & (1u << neighbor)) != 0) {
                draw_rows(state, rows, draw_x + neighbor_x[neighbor],
                          draw_y + neighbor_y[neighbor], render_width, render_height,
                          state.outline_color, false);
            }
        }
    }
    if (!state.outline_skip_interior) {
        draw_rows(state, rows, draw_x, draw_y, render_width, render_height,
                  state.foreground, state.background_enabled);
    }
    const int scale_x = (state.mode & mode_wide) != 0 ? 2 : 1;
    const int scale_y = (state.mode & mode_tall) != 0 ? 2 : 1;
    const int advance = (state.forced_width >= 0 ? state.forced_width : base_width)
                        * scale_x + width_adjustment;
    state.line_height = std::max(state.line_height, base_height * scale_y + 1);
    if (state.underline) {
        for (int px = -1; px < advance; ++px) {
            include_pixel(state, state.x + px, state.y + state.line_height);
            p8_gfx_text_pixel(state.core, state.x + px, state.y + state.line_height,
                              state.foreground);
        }
    }
    state.previous_x = state.x;
    state.previous_y = state.y;
    state.x += advance;
    state.max_x = std::max(state.max_x, state.x);
    return advance;
}

void apply_wrap(text_state &state)
{
    if (state.rhs > 0 && state.x >= state.rhs) {
        state.x = state.home_x;
        state.y += state.line_height;
        state.line_height = 6;
    }
}

uint32_t unsupported_controls(const uint8_t *bytes, size_t size)
{
    uint32_t unsupported = 0;
    for (size_t index = 0; index < size; ++index) {
        const uint8_t character = bytes[index];
        if (character == 0) break;
        if (character == 1) {
            index = std::min(size, index + 2u);
        } else if (character == 2 || character == 3 || character == 4
                   || character == 12) {
            index = std::min(size, index + 1u);
        } else if (character == 5 || character == 11) {
            index = std::min(size, index + 2u);
        } else if (character == 7) {
            unsupported |= P8_TEXT_UNSUPPORTED_AUDIO;
        } else if (character == 6 && index + 1u < size) {
            const uint8_t command = bytes[++index];
            if (command >= '1' && command <= '9') {
                unsupported |= P8_TEXT_UNSUPPORTED_DELAY;
            } else if (command == 'd') {
                unsupported |= P8_TEXT_UNSUPPORTED_DELAY;
                index = std::min(size, index + 1u);
            } else if (command == ':' || command == ';') {
                index = std::min(size, index + 16u);
            } else if (command == '.' || command == ',') {
                index = std::min(size, index + 8u);
            } else if (command == 'o') {
                index = std::min(size, index + 3u);
            } else if (command == 'j') {
                index = std::min(size, index + 2u);
            } else if (command == 'c' || command == 'r' || command == 's'
                       || command == 'x' || command == 'y') {
                index = std::min(size, index + 1u);
            } else if (command == '-') {
                if (index + 1u < size && bytes[index + 1u] == 'b') {
                    unsupported |= P8_TEXT_UNSUPPORTED_RENDER_MODE;
                }
                index = std::min(size, index + 1u);
            } else if (command == '@') {
                if (index + 8u >= size) break;
                size_t count = 0;
                for (size_t digit = 5; digit <= 8; ++digit) {
                    count = (count << 4u)
                        | hex_nibble(static_cast<char>(bytes[index + digit]));
                }
                index = std::min(size, index + 8u + count);
            } else if (command == '!') {
                break;
            } else if (command != 'g' && command != 'h' && command != 'w'
                       && command != 't' && command != '=' && command != 'p'
                       && command != 'i' && command != '#'
                       && command != 'u') {
                unsupported |= P8_TEXT_UNSUPPORTED_RENDER_MODE;
            }
        }
    }
    return unsupported;
}

struct text_span {
    uint32_t offset;
    uint32_t length;
    uint32_t kind;
    uint32_t reasons;
    uint32_t effects;
};

struct token_description {
    size_t length = 1;
    uint32_t kind = P8_TEXT_SPAN_VISUAL;
    uint32_t reasons = P8_TEXT_REASON_NONE;
    uint32_t effects = P8_TEXT_EFFECT_NONE;
    bool terminates = false;
};

size_t bounded_token_size(size_t requested, size_t remaining)
{
    return std::max<size_t>(1, std::min(requested, remaining));
}

token_description describe_token(const uint8_t *bytes, size_t size, size_t index)
{
    token_description token{};
    const size_t remaining = size - index;
    const uint8_t character = bytes[index];
    if (character == 0) {
        token.length = remaining;
        token.kind = P8_TEXT_SPAN_TERMINATOR;
        token.reasons = P8_TEXT_REASON_VISUAL_CONTROL
            | P8_TEXT_REASON_AMBIGUOUS_MAPPING;
        token.terminates = true;
        return token;
    }
    if (character >= 16) {
        if (character < 32 || character >= 127) {
            token.reasons = P8_TEXT_REASON_NON_ASCII | P8_TEXT_REASON_AMBIGUOUS_MAPPING;
        }
        token.effects = P8_TEXT_EFFECT_CURSOR;
        return token;
    }

    token.kind = P8_TEXT_SPAN_CONTROL;
    token.reasons = P8_TEXT_REASON_VISUAL_CONTROL | P8_TEXT_REASON_SIDE_EFFECT;
    token.effects = P8_TEXT_EFFECT_CURSOR;
    if (character == 1) {
        token.length = bounded_token_size(3, remaining);
    } else if (character == 2) {
        token.length = bounded_token_size(2, remaining);
        token.effects = P8_TEXT_EFFECT_RENDER_STATE;
    } else if (character >= 3 && character <= 5) {
        token.length = bounded_token_size(character == 5 ? 3 : 2, remaining);
    } else if (character == 6) {
        if (remaining < 2) {
            token.reasons |= P8_TEXT_REASON_UNSUPPORTED;
            token.effects = P8_TEXT_EFFECT_RENDER_STATE;
            return token;
        }
        const uint8_t command = bytes[index + 1];
        if (command >= '1' && command <= '9') {
            token.length = 2;
            token.effects = P8_TEXT_EFFECT_TIMING;
        } else if (command == 'd') {
            token.length = bounded_token_size(3, remaining);
            token.effects = P8_TEXT_EFFECT_TIMING;
        } else if (command == 'c') {
            token.length = bounded_token_size(3, remaining);
            token.effects = P8_TEXT_EFFECT_SCREEN_CLEAR | P8_TEXT_EFFECT_CURSOR;
        } else if (command == 'j') {
            token.length = bounded_token_size(4, remaining);
        } else if (command == 'r' || command == 's') {
            token.length = bounded_token_size(3, remaining);
        } else if (command == 'x' || command == 'y' || command == '-') {
            token.length = bounded_token_size(3, remaining);
            token.effects = P8_TEXT_EFFECT_RENDER_STATE;
            if (command == '-' && token.length >= 3 && bytes[index + 2] == 'b') {
                token.reasons |= P8_TEXT_REASON_UNSUPPORTED;
            }
        } else if (command == 'o') {
            token.length = bounded_token_size(5, remaining);
            token.effects = P8_TEXT_EFFECT_RENDER_STATE;
        } else if (command == ':' || command == ';' || command == '.' || command == ',') {
            token.length = bounded_token_size(command == ':' || command == ';' ? 18 : 10,
                                              remaining);
            token.kind = P8_TEXT_SPAN_INLINE_GLYPH;
            token.reasons = P8_TEXT_REASON_INLINE_GLYPH
                | P8_TEXT_REASON_AMBIGUOUS_MAPPING;
            token.effects = P8_TEXT_EFFECT_CURSOR;
        } else if (command == '@') {
            size_t count = 0;
            if (remaining >= 10) {
                for (size_t digit = 6; digit <= 9; ++digit) {
                    count = (count << 4u)
                        | hex_nibble(static_cast<char>(bytes[index + digit]));
                }
            }
            token.length = bounded_token_size(10 + count, remaining);
            token.effects = P8_TEXT_EFFECT_RAM_WRITE;
        } else if (command == '!') {
            token.length = remaining;
            token.effects = P8_TEXT_EFFECT_RAM_WRITE;
            token.terminates = true;
        } else if (command == 'g' || command == 'h') {
            token.length = 2;
        } else if (command == 'w' || command == 't' || command == '='
                   || command == 'p' || command == 'i' || command == '#'
                   || command == 'u') {
            token.length = 2;
            token.effects = P8_TEXT_EFFECT_RENDER_STATE;
        } else {
            token.length = 2;
            token.reasons |= P8_TEXT_REASON_UNSUPPORTED;
            token.effects = P8_TEXT_EFFECT_RENDER_STATE;
        }
    } else if (character == 7) {
        token.reasons |= P8_TEXT_REASON_UNSUPPORTED;
        token.effects = P8_TEXT_EFFECT_AUDIO;
    } else if (character == 11) {
        token.length = bounded_token_size(3, remaining);
    } else if (character == 12) {
        token.length = bounded_token_size(2, remaining);
        token.effects = P8_TEXT_EFFECT_DRAW_COLOR;
    } else if (character == 14 || character == 15) {
        token.reasons |= P8_TEXT_REASON_CUSTOM_FONT;
        token.effects = P8_TEXT_EFFECT_CUSTOM_FONT_STATE | P8_TEXT_EFFECT_RENDER_STATE;
    }
    return token;
}

std::vector<text_span> scan_spans(const uint8_t *bytes, size_t size,
                                  uint32_t &reasons, uint32_t &effects)
{
    std::vector<text_span> spans;
    for (size_t index = 0; index < size;) {
        const token_description token = describe_token(bytes, size, index);
        reasons |= token.reasons;
        effects |= token.effects;
        const uint32_t offset = static_cast<uint32_t>(index);
        const uint32_t length = static_cast<uint32_t>(token.length);
        if (!spans.empty() && spans.back().offset + spans.back().length == offset
            && spans.back().kind == token.kind && spans.back().reasons == token.reasons
            && spans.back().effects == token.effects) {
            spans.back().length += length;
        } else {
            spans.push_back({offset, length, token.kind, token.reasons, token.effects});
        }
        index += token.length;
        if (token.terminates) break;
    }
    return spans;
}

void append_u16(std::vector<uint8_t> &bytes, uint16_t value)
{
    bytes.push_back(static_cast<uint8_t>(value));
    bytes.push_back(static_cast<uint8_t>(value >> 8u));
}

void append_u32(std::vector<uint8_t> &bytes, uint32_t value)
{
    for (unsigned shift = 0; shift < 32; shift += 8) {
        bytes.push_back(static_cast<uint8_t>(value >> shift));
    }
}

void append_i32(std::vector<uint8_t> &bytes, int value)
{
    const int64_t bounded = std::max<int64_t>(std::numeric_limits<int32_t>::min(),
        std::min<int64_t>(std::numeric_limits<int32_t>::max(), value));
    append_u32(bytes, static_cast<uint32_t>(static_cast<int32_t>(bounded)));
}

uint32_t custom_font_revision(const p8_core *core)
{
    uint32_t hash = 2166136261u;
    for (uint16_t offset = 0; offset < 256; ++offset) {
        hash ^= p8_core_peek(core, static_cast<uint16_t>(kCustomFont + offset));
        hash *= 16777619u;
    }
    return hash;
}

void record_text_ir(p8_core *core, const uint8_t *bytes, size_t size,
                    int anchor_x, int anchor_y, uint8_t foreground_in,
                    int append_newline, uint8_t print_attributes,
                    const p8_text_result &result, const text_state *state)
{
    if (size > std::numeric_limits<uint32_t>::max()) return;
    uint32_t reasons = P8_TEXT_REASON_NONE;
    uint32_t effects = P8_TEXT_EFFECT_NONE;
    std::vector<text_span> spans = scan_spans(bytes, size, reasons, effects);
    if ((print_attributes & 1u) != 0) {
        reasons |= P8_TEXT_REASON_VISUAL_CONTROL;
        effects |= P8_TEXT_EFFECT_RENDER_STATE;
        if ((print_attributes & 0x80u) != 0) {
            reasons |= P8_TEXT_REASON_CUSTOM_FONT;
            effects |= P8_TEXT_EFFECT_CUSTOM_FONT_STATE;
        }
    }
    if (append_newline) effects |= P8_TEXT_EFFECT_CURSOR;
    if (result.unsupported != P8_TEXT_UNSUPPORTED_NONE) {
        reasons |= P8_TEXT_REASON_UNSUPPORTED;
    }
    const uint32_t classification = result.unsupported != P8_TEXT_UNSUPPORTED_NONE
        ? P8_TEXT_CLASS_REFERENCE_ONLY
        : reasons == P8_TEXT_REASON_NONE ? P8_TEXT_CLASS_SAFE_MODERN
                                        : P8_TEXT_CLASS_REVIEW_REQUIRED;
    constexpr uint16_t header_size = 112;
    constexpr uint32_t span_size = 20;
    const uint64_t record_size64 = header_size
        + static_cast<uint64_t>(spans.size()) * span_size + size;
    if (record_size64 > std::numeric_limits<uint32_t>::max()
        || spans.size() > std::numeric_limits<uint16_t>::max()) return;
    std::vector<uint8_t> record;
    record.reserve(static_cast<size_t>(record_size64));
    append_u32(record, static_cast<uint32_t>(record_size64));
    append_u16(record, header_size);
    append_u16(record, static_cast<uint16_t>(spans.size()));
    append_u32(record, p8_core_text_ir_next_sequence(core));
    const uint64_t update = p8_core_get_update_count(core);
    append_u32(record, static_cast<uint32_t>(update));
    append_u32(record, static_cast<uint32_t>(update >> 32u));
    append_u32(record, classification);
    append_u32(record, reasons);
    append_u32(record, effects);
    append_u32(record, result.unsupported);
    append_i32(record, anchor_x);
    append_i32(record, anchor_y);
    append_i32(record, anchor_x);
    append_i32(record, anchor_y);
    append_i32(record, result.cursor_x);
    append_i32(record, result.cursor_y);
    append_i32(record, result.rightmost_x);
    append_i32(record, state && state->has_bounds ? state->min_x : 0);
    append_i32(record, state && state->has_bounds ? state->min_y : 0);
    append_i32(record, state && state->has_bounds
        ? state->max_draw_x - state->min_x + 1 : 0);
    append_i32(record, state && state->has_bounds
        ? state->max_draw_y - state->min_y + 1 : 0);
    append_u32(record, foreground_in & 0x0fu);
    append_u32(record, result.foreground);
    append_u32(record, print_attributes);
    append_u32(record, (reasons & P8_TEXT_REASON_CUSTOM_FONT) != 0
        ? custom_font_revision(core) : 0);
    append_u32(record, kCustomFont);
    append_u32(record, 256);
    append_u32(record, append_newline ? 1u : 0u);
    append_u32(record, static_cast<uint32_t>(size));
    for (const text_span &span : spans) {
        append_u32(record, span.offset);
        append_u32(record, span.length);
        append_u32(record, span.kind);
        append_u32(record, span.reasons);
        append_u32(record, span.effects);
    }
    if (size != 0) record.insert(record.end(), bytes, bytes + size);
    p8_core_append_text_ir_record(core, record.data(), record.size());
}

bool take_job(p8_text_job &job, uint8_t &value)
{
    if (job.index >= job.bytes.size()) return false;
    value = job.bytes[job.index++];
    return true;
}

void complete_job(p8_text_job &job, p8_text_result &result)
{
    if (job.append_newline && !job.terminated) {
        job.state.x = job.state.home_x;
        job.state.y += job.state.line_height;
    }
    p8_core_poke(job.state.core, kCursorX, static_cast<uint8_t>(job.state.x));
    p8_core_poke(job.state.core, kCursorY, static_cast<uint8_t>(job.state.y));
    p8_core_poke(job.state.core, kDrawColor, job.state.foreground);
    result.rightmost_x = job.state.max_x;
    result.cursor_x = job.state.x;
    result.cursor_y = job.state.y;
    result.foreground = job.state.foreground;
    result.unsupported = job.state.unsupported;
    record_text_ir(job.state.core, job.bytes.data(), job.bytes.size(),
                   job.anchor_x, job.anchor_y, job.foreground_in,
                   job.append_newline ? 1 : 0, job.print_attributes,
                   result, &job.state);
    job.completed = true;
}

void reject_job(p8_text_job &job, p8_text_result &result)
{
    result = {job.anchor_x, job.anchor_x, job.anchor_y,
              job.foreground_in, job.state.unsupported};
    record_text_ir(job.state.core, job.bytes.data(), job.bytes.size(),
                   job.anchor_x, job.anchor_y, job.foreground_in,
                   job.append_newline ? 1 : 0, job.print_attributes,
                   result, nullptr);
    job.completed = true;
}

int advance_job(p8_text_job &job, uint32_t &wait_frames, p8_text_result &result)
{
    wait_frames = 0;
    if (job.completed) {
        result = {job.state.max_x, job.state.x, job.state.y,
                  job.state.foreground, job.state.unsupported};
        return P8_TEXT_STEP_COMPLETE;
    }
    if (job.state.unsupported != P8_TEXT_UNSUPPORTED_NONE) {
        reject_job(job, result);
        return P8_TEXT_STEP_COMPLETE;
    }

    while (job.index < job.bytes.size() || job.repeat_remaining != 0) {
        bool drew_character = false;
        if (job.repeat_remaining != 0) {
            draw_character(job.state, static_cast<uint8_t>(job.repeated_character));
            --job.repeat_remaining;
            drew_character = true;
        } else {
            uint8_t character = 0;
            if (!take_job(job, character)) break;
            if (character == 0) {
                job.terminated = true;
                job.index = job.bytes.size();
                break;
            }
            if (character == 1) {
                uint8_t count = 0;
                if (!take_job(job, count) || !take_job(job, character)) break;
                job.repeated_character = character;
                job.repeat_remaining = static_cast<unsigned>(parameter(count));
                continue;
            }
            if (character == 2) {
                uint8_t color = 0;
                if (!take_job(job, color)) break;
                job.state.background = static_cast<uint8_t>(parameter(color) & 0x0f);
                job.state.background_enabled = true;
            } else if (character >= 3 && character <= 5) {
                uint8_t first = 0;
                if (!take_job(job, first)) break;
                if (character == 3) job.state.x += parameter(first) - 16;
                if (character == 4) job.state.y += parameter(first) - 16;
                if (character == 5) {
                    uint8_t second = 0;
                    if (!take_job(job, second)) break;
                    job.state.x += parameter(first) - 16;
                    job.state.y += parameter(second) - 16;
                }
            } else if (character == 6) {
                uint8_t command = 0;
                if (!take_job(job, command)) break;
                if (command >= '1' && command <= '9') {
                    wait_frames = 1u << static_cast<unsigned>(command - '1');
                    return P8_TEXT_STEP_WAIT;
                }
                if (command == 'd') {
                    uint8_t delay = 0;
                    if (!take_job(job, delay)) break;
                    job.character_delay = static_cast<uint32_t>(parameter(delay));
                } else if (command == 'c') {
                    uint8_t color = 0;
                    if (!take_job(job, color)) break;
                    p8_gfx_cls(job.state.core, static_cast<uint8_t>(parameter(color)));
                    job.state.x = job.state.y = job.state.home_x = job.state.home_y = 0;
                } else if (command == 'g') {
                    job.state.x = job.state.home_x;
                    job.state.y = job.state.home_y;
                } else if (command == 'h') {
                    job.state.home_x = job.state.x;
                    job.state.home_y = job.state.y;
                } else if (command == 'j') {
                    uint8_t px = 0, py = 0;
                    if (!take_job(job, px) || !take_job(job, py)) break;
                    job.state.x = parameter(px) * 4;
                    job.state.y = parameter(py) * 4;
                } else if (command == 'r' || command == 's'
                           || command == 'x' || command == 'y') {
                    uint8_t value = 0;
                    if (!take_job(job, value)) break;
                    if (command == 'r') job.state.rhs = parameter(value) * 4;
                    if (command == 's') job.state.tab_width = std::max(1, parameter(value));
                    if (command == 'x') job.state.forced_width = parameter(value);
                    if (command == 'y') job.state.forced_height = parameter(value);
                } else if (command == 'w') job.state.mode |= mode_wide;
                else if (command == 't') job.state.mode |= mode_tall;
                else if (command == '=') job.state.mode |= mode_stripe;
                else if (command == 'p') job.state.mode |= mode_wide | mode_tall | mode_stripe;
                else if (command == 'i') job.state.mode |= mode_invert;
                else if (command == '#') job.state.background_enabled = true;
                else if (command == '-') {
                    uint8_t disabled = 0;
                    if (!take_job(job, disabled)) break;
                    if (disabled == 'w') job.state.mode &= ~mode_wide;
                    if (disabled == 't') job.state.mode &= ~mode_tall;
                    if (disabled == '=') job.state.mode &= ~mode_stripe;
                    if (disabled == 'p') {
                        job.state.mode &= ~(mode_wide | mode_tall | mode_stripe);
                    }
                    if (disabled == 'i') job.state.mode &= ~mode_invert;
                    if (disabled == '#') job.state.background_enabled = false;
                } else if (command == ':' || command == ';'
                           || command == '.' || command == ',') {
                    std::array<uint8_t, 8> rows{};
                    const bool hexadecimal = command == ':' || command == ';';
                    for (int row = 0; row < 8; ++row) {
                        uint8_t first = 0;
                        if (!take_job(job, first)) break;
                        if (hexadecimal) {
                            uint8_t second = 0;
                            if (!take_job(job, second)) break;
                            rows[row] = static_cast<uint8_t>(
                                (hex_nibble(static_cast<char>(first)) << 4u)
                                | hex_nibble(static_cast<char>(second)));
                        } else {
                            rows[row] = first;
                        }
                    }
                    draw_character(job.state, 0x10, &rows);
                    drew_character = true;
                } else if (command == '@' || command == '!') {
                    uint16_t address = 0;
                    for (int digit = 0; digit < 4; ++digit) {
                        uint8_t value = 0;
                        if (!take_job(job, value)) break;
                        address = static_cast<uint16_t>(
                            (address << 4u) | hex_nibble(static_cast<char>(value)));
                    }
                    size_t count = job.bytes.size() - job.index;
                    if (command == '@') {
                        count = 0;
                        for (int digit = 0; digit < 4; ++digit) {
                            uint8_t value = 0;
                            if (!take_job(job, value)) break;
                            count = (count << 4u)
                                | hex_nibble(static_cast<char>(value));
                        }
                        count = std::min(count, job.bytes.size() - job.index);
                    }
                    for (size_t offset = 0; offset < count; ++offset) {
                        p8_core_poke(job.state.core,
                            static_cast<uint16_t>(address + offset),
                            job.bytes[job.index + offset]);
                    }
                    job.index += count;
                } else if (command == 'o') {
                    uint8_t color = 0, high = 0, low = 0;
                    if (!take_job(job, color) || !take_job(job, high)
                        || !take_job(job, low)) break;
                    job.state.outline_skip_interior = color == '!';
                    job.state.outline_color = (color == '$' || color == '!')
                        ? job.state.foreground
                        : static_cast<uint8_t>(parameter(color) & 0x0f);
                    job.state.outline_neighbors = static_cast<uint8_t>(
                        (hex_nibble(static_cast<char>(high)) << 4u)
                        | hex_nibble(static_cast<char>(low)));
                } else if (command == 'u') {
                    job.state.underline = true;
                } else {
                    job.state.unsupported |= P8_TEXT_UNSUPPORTED_RENDER_MODE;
                }
            } else if (character == 7) {
                job.state.unsupported |= P8_TEXT_UNSUPPORTED_AUDIO;
            } else if (character == 8) {
                job.state.x -= 4;
            } else if (character == 9) {
                const int stop = std::max(1, job.state.tab_width * 4);
                job.state.x += stop - ((job.state.x - job.state.home_x) % stop);
            } else if (character == 10) {
                job.state.x = job.state.home_x;
                job.state.y += job.state.line_height;
                job.state.line_height = 6;
            } else if (character == 11) {
                uint8_t offset = 0, decorated = 0;
                if (!take_job(job, offset) || !take_job(job, decorated)) break;
                const int saved_x = job.state.x, saved_y = job.state.y;
                job.state.x = job.state.previous_x + parameter(offset) % 4 - 2;
                job.state.y = job.state.previous_y + parameter(offset) / 4 - 8;
                draw_character(job.state, decorated);
                job.state.x = saved_x;
                job.state.y = saved_y;
            } else if (character == 12) {
                uint8_t color = 0;
                if (!take_job(job, color)) break;
                job.state.foreground = static_cast<uint8_t>(parameter(color) & 0x0f);
                p8_core_poke(job.state.core, kDrawColor, job.state.foreground);
            } else if (character == 13) {
                job.state.x = job.state.home_x;
            } else if (character == 14) {
                job.state.mode |= mode_custom;
            } else if (character == 15) {
                job.state.mode &= ~mode_custom;
            } else {
                draw_character(job.state, character);
                drew_character = true;
            }
        }
        apply_wrap(job.state);
        if (drew_character && job.character_delay != 0) {
            wait_frames = job.character_delay;
            return P8_TEXT_STEP_WAIT;
        }
    }

    complete_job(job, result);
    return P8_TEXT_STEP_COMPLETE;
}

} // namespace

extern "C" {

p8_text_job *p8_text_job_create(p8_core *core, const uint8_t *bytes, size_t size,
                                int x, int y, uint8_t foreground,
                                int append_newline)
{
    if (!core || (!bytes && size != 0)) return nullptr;
    p8_text_job *job = new (std::nothrow) p8_text_job{};
    if (!job) return nullptr;
    if (size != 0) job->bytes.assign(bytes, bytes + size);
    job->anchor_x = x;
    job->anchor_y = y;
    job->foreground_in = static_cast<uint8_t>(foreground & 0x0f);
    job->print_attributes = p8_core_peek(core, kPrintAttributes);
    job->append_newline = append_newline != 0;
    job->state.core = core;
    job->state.x = x;
    job->state.y = y;
    job->state.home_x = x;
    job->state.home_y = y;
    job->state.previous_x = x;
    job->state.previous_y = y;
    job->state.max_x = x;
    job->state.foreground = job->foreground_in;
    const uint32_t unsupported = unsupported_controls(bytes, size);
    job->requires_frames = (unsupported & P8_TEXT_UNSUPPORTED_DELAY) != 0;
    job->state.unsupported = unsupported
        & ~static_cast<uint32_t>(P8_TEXT_UNSUPPORTED_DELAY);
    if ((job->print_attributes & 1u) != 0) {
        if ((job->print_attributes & 0x04u) != 0) job->state.mode |= mode_wide;
        if ((job->print_attributes & 0x08u) != 0) job->state.mode |= mode_tall;
        if ((job->print_attributes & 0x10u) != 0) job->state.mode |= mode_solid;
        if ((job->print_attributes & 0x20u) != 0) job->state.mode |= mode_invert;
        if ((job->print_attributes & 0x40u) != 0) job->state.mode |= mode_stripe;
        if ((job->print_attributes & 0x80u) != 0) job->state.mode |= mode_custom;
        job->state.background_enabled = (job->print_attributes & 0x10u) != 0;
    }
    return job;
}

void p8_text_job_destroy(p8_text_job *job)
{
    delete job;
}

uint32_t p8_text_job_unsupported(const p8_text_job *job)
{
    return job ? job->state.unsupported : P8_TEXT_UNSUPPORTED_RENDER_MODE;
}

int p8_text_job_requires_frames(const p8_text_job *job)
{
    return job && job->requires_frames ? 1 : 0;
}

int p8_text_job_step(p8_text_job *job, uint32_t *wait_frames,
                     p8_text_result *result)
{
    if (!job || !wait_frames || !result) return P8_TEXT_STEP_ERROR;
    return advance_job(*job, *wait_frames, *result);
}

int p8_text_print(p8_core *core, const uint8_t *bytes, size_t size,
                  int x, int y, uint8_t foreground, int append_newline,
                  p8_text_result *result)
{
    if (!core || (!bytes && size != 0) || !result) return 0;
    const uint32_t unsupported = unsupported_controls(bytes, size);
    const uint8_t foreground_in = static_cast<uint8_t>(foreground & 0x0f);
    const uint8_t defaults = p8_core_peek(core, kPrintAttributes);
    if (unsupported != 0) {
        *result = {x, x, y, foreground_in, unsupported};
        record_text_ir(core, bytes, size, x, y, foreground_in, append_newline,
                       defaults, *result, nullptr);
        return 1;
    }
    p8_text_job *job = p8_text_job_create(core, bytes, size, x, y, foreground,
                                                append_newline);
    if (!job) return 0;
    uint32_t wait_frames = 0;
    const int status = p8_text_job_step(job, &wait_frames, result);
    p8_text_job_destroy(job);
    return status == P8_TEXT_STEP_COMPLETE && wait_frames == 0 ? 1 : 0;
}

} // extern "C"
