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

/* Capability bits are fail-closed. A missing bit means callers must not infer
 * compatible behavior from a diagnostic implementation. In particular, the
 * core can deterministically render a structurally bounded custom-instrument
 * subset while the two custom capability bits remain clear until licensed
 * official captures qualify the PCM and transition semantics. */
enum p8_audio_capability {
    P8_AUDIO_CAP_EVENT_LEDGER = 1u << 0,
    P8_AUDIO_CAP_CHANNEL_STATUS = 1u << 1,
    P8_AUDIO_CAP_STAT_57 = 1u << 2,
    P8_AUDIO_CAP_STAT_46_56 = 1u << 3,
    P8_AUDIO_CAP_FILTERS = 1u << 4,
    P8_AUDIO_CAP_CUSTOM_INSTRUMENTS = 1u << 5,
    P8_AUDIO_CAP_CUSTOM_WAVEFORMS = 1u << 6,
};

/* Diagnostic playback is opt-in and never upgrades a capability bit. The
 * used flags are sticky for the loaded execution so qualification can reject
 * and hash any run that crossed an unqualified audio boundary. */
enum p8_audio_diagnostic_flag {
    P8_AUDIO_DIAGNOSTIC_CUSTOM_INSTRUMENT = 1u << 0,
    P8_AUDIO_DIAGNOSTIC_CUSTOM_WAVEFORM = 1u << 1,
};

enum p8_audio_event_kind {
    P8_AUDIO_EVENT_CHANNEL_START = 1,
    P8_AUDIO_EVENT_CHANNEL_STOP = 2,
    P8_AUDIO_EVENT_CHANNEL_RELEASE = 3,
    P8_AUDIO_EVENT_NOTE = 4,
    P8_AUDIO_EVENT_MUSIC_PATTERN = 5,
    P8_AUDIO_EVENT_MUSIC_STOP = 6,
    P8_AUDIO_EVENT_DIAGNOSTIC_CUSTOM_AUDIO = 7,
};

/* Fixed-width diagnostic ABI. These values describe Aico 8's internal event
 * stream and are not licensed-official stat(46..57) evidence. */
typedef struct p8_audio_channel_status {
    int32_t sfx;
    int32_t note;
    int32_t deferred_music_sfx;
    int32_t is_music;
    int32_t is_releasing;
} p8_audio_channel_status;

typedef struct p8_audio_event {
    uint32_t sequence;
    uint32_t sample_low;
    uint32_t sample_high;
    int32_t kind;
    int32_t channel;
    int32_t sfx;
    int32_t note;
    int32_t music_pattern;
} p8_audio_event;

void p8_audio_reset(p8_core *core);
int p8_audio_sfx(p8_core *core, int sfx, int channel, int offset, int length);
int p8_audio_music(p8_core *core, int pattern, int fade_milliseconds,
                   uint8_t channel_mask);
void p8_audio_host_tick60(p8_core *core);
size_t p8_audio_available(const p8_core *core);
size_t p8_audio_read(p8_core *core, int16_t *destination, size_t capacity);
uint32_t p8_audio_capabilities(const p8_core *core);
int p8_audio_set_diagnostic_mask(p8_core *core, uint32_t mask);
uint32_t p8_audio_diagnostic_flags(const p8_core *core);
int p8_audio_get_channel_status(const p8_core *core, unsigned channel,
                                p8_audio_channel_status *status);
size_t p8_audio_copy_events(const p8_core *core, p8_audio_event *destination,
                            size_t capacity);
/* stat(57) reports the actual music-active state. stat(46..56) returns zero,
 * without writing value, while licensed tick-history semantics remain
 * unqualified. */
int p8_audio_stat(const p8_core *core, unsigned selector, int32_t *value);
int p8_audio_current_sfx(const p8_core *core, unsigned channel);
int p8_audio_current_music(const p8_core *core);
const char *p8_audio_last_error(const p8_core *core);

#ifdef __cplusplus
}
#endif

#endif
