#ifndef P8_AUDIO_H
#define P8_AUDIO_H

#include "p8/core.h"

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum {
    P8_AUDIO_SAMPLE_RATE = 22050,
    P8_AUDIO_CHANNEL_COUNT = 4,
};

void p8_audio_reset(p8_core *core);
int p8_audio_sfx(p8_core *core, int sfx, int channel, int offset, int length);
int p8_audio_music(p8_core *core, int pattern, int fade_milliseconds,
                   uint8_t channel_mask);
void p8_audio_host_tick60(p8_core *core);
size_t p8_audio_available(const p8_core *core);
size_t p8_audio_read(p8_core *core, int16_t *destination, size_t capacity);
int p8_audio_current_sfx(const p8_core *core, unsigned channel);
int p8_audio_current_music(const p8_core *core);
const char *p8_audio_last_error(const p8_core *core);

#ifdef __cplusplus
}
#endif

#endif
