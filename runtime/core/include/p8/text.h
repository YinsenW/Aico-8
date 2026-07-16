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

#ifdef __cplusplus
}
#endif

#endif
