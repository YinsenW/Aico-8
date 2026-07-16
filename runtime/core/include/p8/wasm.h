#ifndef AICO8_WASM_H
#define AICO8_WASM_H

#include "p8/audio.h"
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
int aico8_initialization_complete(const aico8_runtime *runtime);

/* Called by a 60 Hz host. Returns -1 on VM error, 0 when idle, and 1 after an update. */
int aico8_tick60(aico8_runtime *runtime, uint8_t player_zero_buttons);
size_t aico8_audio_available(const aico8_runtime *runtime);
size_t aico8_read_audio(aico8_runtime *runtime, int16_t *destination,
                        size_t capacity);
uint32_t aico8_audio_capabilities(const aico8_runtime *runtime);
int aico8_set_audio_diagnostic_mask(aico8_runtime *runtime, uint32_t mask);
uint32_t aico8_audio_diagnostic_flags(const aico8_runtime *runtime);
int aico8_get_audio_channel_status(const aico8_runtime *runtime, unsigned channel,
                                   p8_audio_channel_status *status);
size_t aico8_copy_audio_events(const aico8_runtime *runtime,
                               p8_audio_event *destination, size_t capacity);

const uint8_t *aico8_framebuffer(aico8_runtime *runtime);
size_t aico8_framebuffer_size(void);
const p8_draw_command *aico8_draw_commands(const aico8_runtime *runtime);
size_t aico8_draw_command_count(const aico8_runtime *runtime);
const uint8_t *aico8_draw_payload(const aico8_runtime *runtime);
size_t aico8_draw_payload_size(const aico8_runtime *runtime);
size_t aico8_copy_map_region(const aico8_runtime *runtime, int cell_x, int cell_y,
                             int width, int height, uint8_t *destination,
                             size_t capacity);
size_t aico8_copy_sprite_region(const aico8_runtime *runtime, int pixel_x, int pixel_y,
                                int width, int height, uint8_t *destination,
                                size_t capacity);
size_t aico8_copy_sprite_flags(const aico8_runtime *runtime, int first_sprite,
                               int count, uint8_t *destination, size_t capacity);
size_t aico8_copy_palette_state(const aico8_runtime *runtime, uint8_t *destination,
                                size_t capacity);
int aico8_get_global_raw(aico8_runtime *runtime, const char *name,
                         int32_t *raw_16_16);
int aico8_get_global_boolean(aico8_runtime *runtime, const char *name, int *value);
size_t aico8_copy_global_string(aico8_runtime *runtime, const char *name,
                                char *destination, size_t capacity);
int aico8_get_table_length(aico8_runtime *runtime, const char *name,
                           size_t *length);
int aico8_get_table_value_raw(aico8_runtime *runtime, const char *name,
                              size_t one_based_index, int32_t *raw_16_16);
int aico8_get_table_field_raw(aico8_runtime *runtime, const char *name,
                              const char *field, int32_t *raw_16_16);
int aico8_get_table_field_boolean(aico8_runtime *runtime, const char *name,
                                  const char *field, int *value);
int aico8_get_table_entry_raw(aico8_runtime *runtime, const char *name,
                              size_t one_based_index, const char *field,
                              int32_t *raw_16_16);
int aico8_get_table_entry_boolean(aico8_runtime *runtime, const char *name,
                                  size_t one_based_index, const char *field,
                                  int *value);
size_t aico8_copy_menu_item_label(const aico8_runtime *runtime, unsigned index,
                                  char *destination, size_t capacity);
uint8_t aico8_menu_item_filter(const aico8_runtime *runtime, unsigned index);
int aico8_invoke_menu_item(aico8_runtime *runtime, unsigned index,
                           uint8_t buttons, int *keep_open);

size_t aico8_copy_persistent(const aico8_runtime *runtime, uint8_t *destination,
                             size_t capacity);
const char *aico8_last_error(const aico8_runtime *runtime);
const char *aico8_diagnostic_output(const aico8_runtime *runtime);

#ifdef __cplusplus
}
#endif

#endif
