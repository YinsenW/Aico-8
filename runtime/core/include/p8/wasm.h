#ifndef AICO8_WASM_H
#define AICO8_WASM_H

#include "p8/core.h"

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct aico8_runtime aico8_runtime;

aico8_runtime *aico8_create(void);
void aico8_destroy(aico8_runtime *runtime);

/* Loading and starting are separate so a host can restore cartdata first. */
int aico8_load_cart(aico8_runtime *runtime, const uint8_t *rom, size_t rom_size,
                    const char *source, size_t source_size);
int aico8_load_persistent(aico8_runtime *runtime, const uint8_t *data, size_t size);
int aico8_start(aico8_runtime *runtime);

/* Called by a 60 Hz host. Returns -1 on VM error, 0 when idle, and 1 after an update. */
int aico8_tick60(aico8_runtime *runtime, uint8_t player_zero_buttons);

const uint8_t *aico8_framebuffer(aico8_runtime *runtime);
size_t aico8_framebuffer_size(void);
const p8_draw_command *aico8_draw_commands(const aico8_runtime *runtime);
size_t aico8_draw_command_count(const aico8_runtime *runtime);
const uint8_t *aico8_draw_payload(const aico8_runtime *runtime);
size_t aico8_draw_payload_size(const aico8_runtime *runtime);

size_t aico8_copy_persistent(const aico8_runtime *runtime, uint8_t *destination,
                             size_t capacity);
const char *aico8_last_error(const aico8_runtime *runtime);

#ifdef __cplusplus
}
#endif

#endif
