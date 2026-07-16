#ifndef P8_CORE_INTERNAL_H
#define P8_CORE_INTERNAL_H

#include "p8/core.h"

#include <cstdint>
#include <cstddef>

uint8_t p8_core_secondary_palette_get(const p8_core *core, uint8_t color);
void p8_core_secondary_palette_set(p8_core *core, uint8_t color, uint8_t pair);
void p8_core_secondary_palette_reset(p8_core *core);
uint32_t p8_core_text_ir_next_sequence(p8_core *core);
int p8_core_append_text_ir_record(p8_core *core, const uint8_t *record,
                                  size_t record_size);

#endif
