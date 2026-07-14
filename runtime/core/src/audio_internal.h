#ifndef P8_AUDIO_INTERNAL_H
#define P8_AUDIO_INTERNAL_H

#include "p8/core.h"

#include <array>
#include <cstddef>
#include <cstdint>

struct p8_audio_playback {
    int16_t sfx = -1;
    uint64_t position = 0;
    uint64_t elapsed = 0;
    uint32_t length = 0;
    uint8_t previous_key = 24;
    uint8_t previous_volume = 0;
    bool can_loop = true;
    bool is_music = false;
};

struct p8_audio_channel {
    p8_audio_playback playback{};
    int16_t deferred_music_sfx = -1;
    uint32_t phase = 0;
    uint32_t secondary_phase = 0;
    uint32_t noise = 0x6d2b79f5u;
    int16_t held_noise = 0;
};

struct p8_audio_music_state {
    int16_t pattern = -1;
    int16_t count = -1;
    uint8_t mask = 0;
    uint64_t elapsed_samples = 0;
    uint64_t duration_samples = 0;
    int32_t volume = 65536;
    int32_t fade_step = 0;
};

struct p8_audio_state {
    static constexpr size_t kRingCapacity = 16384;
    std::array<p8_audio_channel, 4> channels{};
    p8_audio_music_state music{};
    std::array<int16_t, kRingCapacity> ring{};
    size_t ring_read = 0;
    size_t ring_write = 0;
    size_t ring_count = 0;
    unsigned sample_remainder = 0;
    std::array<char, 192> error{};
};

p8_audio_state &p8_core_audio_state(p8_core *core);
const p8_audio_state &p8_core_audio_state(const p8_core *core);

#endif
