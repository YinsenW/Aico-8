#ifndef P8_TEXT_H
#define P8_TEXT_H

#include "p8/core.h"

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum {
    P8_TEXT_UNSUPPORTED_NONE = 0,
    P8_TEXT_UNSUPPORTED_DELAY = 1u << 0,
    P8_TEXT_UNSUPPORTED_AUDIO = 1u << 1,
    P8_TEXT_UNSUPPORTED_RENDER_MODE = 1u << 2,
};

enum {
    P8_TEXT_IR_SCHEMA_VERSION = 1,
    P8_TEXT_CLASS_SAFE_MODERN = 1,
    P8_TEXT_CLASS_REFERENCE_ONLY = 2,
    P8_TEXT_CLASS_REVIEW_REQUIRED = 3,
};

enum {
    P8_TEXT_REASON_NONE = 0,
    P8_TEXT_REASON_NON_ASCII = 1u << 0,
    P8_TEXT_REASON_CUSTOM_FONT = 1u << 1,
    P8_TEXT_REASON_INLINE_GLYPH = 1u << 2,
    P8_TEXT_REASON_VISUAL_CONTROL = 1u << 3,
    P8_TEXT_REASON_SIDE_EFFECT = 1u << 4,
    P8_TEXT_REASON_UNSUPPORTED = 1u << 5,
    P8_TEXT_REASON_AMBIGUOUS_MAPPING = 1u << 6,
};

enum {
    P8_TEXT_EFFECT_NONE = 0,
    P8_TEXT_EFFECT_CURSOR = 1u << 0,
    P8_TEXT_EFFECT_DRAW_COLOR = 1u << 1,
    P8_TEXT_EFFECT_RAM_WRITE = 1u << 2,
    P8_TEXT_EFFECT_SCREEN_CLEAR = 1u << 3,
    P8_TEXT_EFFECT_AUDIO = 1u << 4,
    P8_TEXT_EFFECT_TIMING = 1u << 5,
    P8_TEXT_EFFECT_RENDER_STATE = 1u << 6,
    P8_TEXT_EFFECT_CUSTOM_FONT_STATE = 1u << 7,
};

enum {
    P8_TEXT_SPAN_VISUAL = 1,
    P8_TEXT_SPAN_CONTROL = 2,
    P8_TEXT_SPAN_INLINE_GLYPH = 3,
    P8_TEXT_SPAN_TERMINATOR = 4,
};

typedef struct p8_text_result {
    int rightmost_x;
    int cursor_x;
    int cursor_y;
    uint8_t foreground;
    uint32_t unsupported;
} p8_text_result;

/* Executes the synchronous/manual-defined P8SCII subset against core RAM. */
int p8_text_print(p8_core *core, const uint8_t *bytes, size_t size,
                  int x, int y, uint8_t foreground, int append_newline,
                  p8_text_result *result);

/* Canonical little-endian DATA-TEXT-RUN-001 stream for the current draw stream. */
const uint8_t *p8_core_text_ir_data(const p8_core *core);
size_t p8_core_text_ir_size(const p8_core *core);

#ifdef __cplusplus
}
#endif

#endif
