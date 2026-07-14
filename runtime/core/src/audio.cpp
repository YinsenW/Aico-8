#include "p8/audio.h"

#include "audio_internal.h"

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <limits>

namespace {

constexpr uint16_t kMusicBase = 0x3100;
constexpr uint16_t kSfxBase = 0x3200;
constexpr unsigned kSfxSize = 68;
constexpr uint64_t kOneNote = uint64_t{1} << 32;
constexpr uint32_t kCapabilities = P8_AUDIO_CAP_EVENT_LEDGER
    | P8_AUDIO_CAP_CHANNEL_STATUS | P8_AUDIO_CAP_STAT_57;
static_assert((kCapabilities & (P8_AUDIO_CAP_STAT_46_56 | P8_AUDIO_CAP_FILTERS
                                | P8_AUDIO_CAP_CUSTOM_INSTRUMENTS
                                | P8_AUDIO_CAP_CUSTOM_WAVEFORMS)) == 0,
              "unqualified audio features must remain fail-closed");

static_assert(sizeof(p8_audio_channel_status) == 20,
              "audio channel status ABI must remain fixed-width");
static_assert(sizeof(p8_audio_event) == 32,
              "audio event ABI must remain fixed-width");

constexpr std::array<uint32_t, 64> kPhaseIncrement = {
    12740059, 13497623, 14300233, 15150569, 16051469, 17005939, 18017165, 19088521,
    20223584, 21426141, 22700205, 24050030, 25480119, 26995246, 28600467, 30301139,
    32102938, 34011878, 36034330, 38177043, 40447168, 42852281, 45400411, 48100060,
    50960238, 53990491, 57200933, 60602278, 64205876, 68023757, 72068660, 76354085,
    80894335, 85704563, 90800821, 96200119, 101920476, 107980983, 114401866, 121204555,
    128411753, 136047513, 144137319, 152708170, 161788671, 171409126, 181601643, 192400238,
    203840952, 215961966, 228803732, 242409110, 256823506, 272095026, 288274639, 305416341,
    323577341, 342818251, 363203285, 384800477, 407681904, 431923931, 457607465, 484818220,
};

struct note_data {
    uint8_t key = 0;
    uint8_t waveform = 0;
    uint8_t volume = 0;
    uint8_t effect = 0;
    bool custom = false;
};

int current_note(const p8_audio_playback &playback)
{
    if (playback.sfx < 0) return -1;
    return static_cast<int>(std::min<uint64_t>(31, playback.position >> 32));
}

void append_event(p8_audio_state &state, uint64_t sample, int kind, int channel,
                  int sfx, int note, int music_pattern)
{
    if ((kCapabilities & P8_AUDIO_CAP_EVENT_LEDGER) == 0) return;
    if (state.event_count == state.events.size()) {
        state.event_read = (state.event_read + 1) % state.events.size();
        --state.event_count;
    }
    const size_t write = (state.event_read + state.event_count) % state.events.size();
    state.events[write] = {
        state.next_event_sequence++,
        static_cast<uint32_t>(sample),
        static_cast<uint32_t>(sample >> 32),
        kind,
        channel,
        sfx,
        note,
        music_pattern,
    };
    ++state.event_count;
}

void stop_channel(p8_audio_state &state, unsigned index, uint64_t sample)
{
    p8_audio_playback &playback = state.channels[index].playback;
    if (playback.sfx < 0) return;
    append_event(state, sample, P8_AUDIO_EVENT_CHANNEL_STOP,
                 static_cast<int>(index), playback.sfx, current_note(playback),
                 state.music.pattern);
    playback.sfx = -1;
}

void clear_error(p8_audio_state &state)
{
    state.error.fill(0);
}

void set_error(p8_audio_state &state, const char *message, int value)
{
    std::snprintf(state.error.data(), state.error.size(), message, value);
}

uint16_t sfx_address(int sfx, unsigned offset)
{
    return static_cast<uint16_t>(kSfxBase + static_cast<unsigned>(sfx) * kSfxSize + offset);
}

note_data read_note(const p8_core *core, int sfx, unsigned note)
{
    const uint8_t low = p8_core_peek(core, sfx_address(sfx, note * 2));
    const uint8_t high = p8_core_peek(core, sfx_address(sfx, note * 2 + 1));
    return {
        static_cast<uint8_t>(low & 0x3f),
        static_cast<uint8_t>(((low >> 6) & 0x03) | ((high & 0x01) << 2)),
        static_cast<uint8_t>((high >> 1) & 0x07),
        static_cast<uint8_t>((high >> 4) & 0x07),
        (high & 0x80) != 0,
    };
}

uint8_t sfx_speed(const p8_core *core, int sfx)
{
    return std::max<uint8_t>(1, p8_core_peek(core, sfx_address(sfx, 65)));
}

uint8_t sfx_loop_start(const p8_core *core, int sfx)
{
    return p8_core_peek(core, sfx_address(sfx, 66));
}

uint8_t sfx_loop_end(const p8_core *core, int sfx)
{
    return p8_core_peek(core, sfx_address(sfx, 67));
}

bool validate_sfx(p8_core *core, int sfx)
{
    p8_audio_state &state = p8_core_audio_state(core);
    if ((kCapabilities & P8_AUDIO_CAP_FILTERS) == 0
        && (p8_core_peek(core, sfx_address(sfx, 64)) & 0xfe) != 0) {
        set_error(state, "sfx %d uses filters that are not yet conformance-qualified", sfx);
        return false;
    }
    for (unsigned note = 0; note < 32; ++note) {
        const note_data data = read_note(core, sfx, note);
        constexpr uint32_t custom_capabilities = P8_AUDIO_CAP_CUSTOM_INSTRUMENTS
            | P8_AUDIO_CAP_CUSTOM_WAVEFORMS;
        if ((kCapabilities & custom_capabilities) != custom_capabilities
            && data.volume != 0 && data.custom) {
            set_error(state, "sfx %d uses a custom instrument that is not yet conformance-qualified", sfx);
            return false;
        }
    }
    return true;
}

uint8_t song_byte(const p8_core *core, int pattern, unsigned channel)
{
    return p8_core_peek(core, static_cast<uint16_t>(kMusicBase + pattern * 4 + channel));
}

bool song_channel_silent(uint8_t value)
{
    return (value & 0x40) != 0;
}

bool song_loop_start(const p8_core *core, int pattern)
{
    return (song_byte(core, pattern, 0) & 0x80) != 0;
}

bool song_loop_end(const p8_core *core, int pattern)
{
    return (song_byte(core, pattern, 1) & 0x80) != 0;
}

bool song_stop(const p8_core *core, int pattern)
{
    return (song_byte(core, pattern, 2) & 0x80) != 0;
}

void stop_music_channels(p8_audio_state &state)
{
    for (unsigned index = 0; index < state.channels.size(); ++index) {
        p8_audio_channel &channel = state.channels[index];
        if (channel.playback.is_music) stop_channel(state, index, state.sample_clock);
        channel.deferred_music_sfx = -1;
    }
}

void launch_sfx(p8_audio_state &state, unsigned index, int sfx, unsigned offset,
                unsigned length, bool is_music)
{
    p8_audio_channel &channel = state.channels[index];
    channel.playback = {};
    channel.playback.sfx = static_cast<int16_t>(sfx);
    channel.playback.position = static_cast<uint64_t>(std::min(offset, 31u)) << 32;
    channel.playback.length = length;
    channel.playback.can_loop = true;
    channel.playback.is_music = is_music;
    channel.phase = 0;
    channel.secondary_phase = 0;
    append_event(state, state.sample_clock, P8_AUDIO_EVENT_CHANNEL_START,
                 static_cast<int>(index), sfx, current_note(channel.playback),
                 state.music.pattern);
}

uint64_t pattern_duration_samples(const p8_core *core, int pattern, uint8_t channel_mask)
{
    int looping_duration = -1;
    int nonlooping_duration = -1;
    for (unsigned channel = 0; channel < 4; ++channel) {
        if ((channel_mask & (1u << channel)) == 0) continue;
        const uint8_t value = song_byte(core, pattern, channel);
        if (song_channel_silent(value)) continue;
        const int sfx = value & 0x3f;
        const int speed = sfx_speed(core, sfx);
        const int loop_start = sfx_loop_start(core, sfx);
        const int loop_end = sfx_loop_end(core, sfx);
        if (loop_end > loop_start) {
            looping_duration = std::max(looping_duration, 32 * speed);
        } else {
            int end = 32;
            if (loop_end == 0 && loop_start > 0) end = std::min(end, loop_start);
            nonlooping_duration = end * speed;
            break;
        }
    }
    const int speed_units = nonlooping_duration > 0 ? nonlooping_duration
        : (looping_duration > 0 ? looping_duration : 32);
    return static_cast<uint64_t>(speed_units) * 183;
}

bool set_music_pattern(p8_core *core, int pattern)
{
    p8_audio_state &state = p8_core_audio_state(core);
    const int previous_pattern = state.music.pattern;
    stop_music_channels(state);
    if (pattern < 0 || pattern > 63) {
        state.music.pattern = -1;
        state.music.count = -1;
        state.music.mask = 0;
        state.music.elapsed_samples = 0;
        state.music.duration_samples = 0;
        if (previous_pattern >= 0) {
            append_event(state, state.sample_clock, P8_AUDIO_EVENT_MUSIC_STOP,
                         -1, -1, -1, previous_pattern);
        }
        return true;
    }
    for (unsigned channel = 0; channel < 4; ++channel) {
        if ((state.music.mask & (1u << channel)) == 0) continue;
        const uint8_t value = song_byte(core, pattern, channel);
        if (!song_channel_silent(value) && !validate_sfx(core, value & 0x3f)) return false;
    }
    state.music.pattern = static_cast<int16_t>(pattern);
    state.music.elapsed_samples = 0;
    state.music.duration_samples = pattern_duration_samples(core, pattern, state.music.mask);
    append_event(state, state.sample_clock, P8_AUDIO_EVENT_MUSIC_PATTERN,
                 -1, -1, -1, pattern);
    for (unsigned index = 0; index < 4; ++index) {
        if ((state.music.mask & (1u << index)) == 0) continue;
        const uint8_t value = song_byte(core, pattern, index);
        if (song_channel_silent(value)) continue;
        const int sfx = value & 0x3f;
        p8_audio_channel &channel = state.channels[index];
        if (channel.playback.sfx < 0) launch_sfx(state, index, sfx, 0, 0, true);
        else channel.deferred_music_sfx = static_cast<int16_t>(sfx);
    }
    return true;
}

int32_t triangle(uint32_t phase)
{
    const uint32_t position = phase >> 16;
    const int32_t ramp = static_cast<int32_t>(position < 32768 ? position : 65535 - position);
    return ramp - 16384;
}

int32_t tilted(uint32_t phase)
{
    constexpr uint32_t peak = 0xe0000000u;
    if (phase < peak) {
        return -16384 + static_cast<int32_t>((static_cast<uint64_t>(phase) * 32768) / peak);
    }
    return 16384 - static_cast<int32_t>((static_cast<uint64_t>(phase - peak) * 32768) / (std::numeric_limits<uint32_t>::max() - peak + 1ull));
}

int32_t waveform(p8_audio_channel &channel, uint8_t instrument, uint32_t increment)
{
    const uint32_t previous = channel.phase;
    channel.phase += increment;
    channel.secondary_phase += static_cast<uint32_t>((static_cast<uint64_t>(increment) * 109) / 110);
    switch (instrument) {
    case 0: return triangle(channel.phase);
    case 1: return tilted(channel.phase);
    case 2: return static_cast<int16_t>(channel.phase >> 16) / 2;
    case 3: return channel.phase < 0x80000000u ? 8192 : -8192;
    case 4: return channel.phase < 0x51000000u ? 8192 : -8192;
    case 5: return std::clamp(triangle(channel.phase) + triangle(channel.phase * 3u) / 2,
                              -16384, 16384);
    case 6:
        if (channel.phase < previous) {
            uint32_t value = channel.noise;
            value ^= value << 13;
            value ^= value >> 17;
            value ^= value << 5;
            channel.noise = value;
            channel.held_noise = static_cast<int16_t>(value >> 16) / 2;
        }
        return channel.held_noise;
    case 7: return (triangle(channel.phase) + triangle(channel.secondary_phase)) / 2;
    default: return 0;
    }
}

uint32_t effect_increment(const p8_core *core, const p8_audio_playback &playback,
                          unsigned note_index, note_data &note)
{
    const uint32_t fraction = static_cast<uint32_t>(playback.position);
    if (note.effect == 6 || note.effect == 7) {
        const unsigned speed = sfx_speed(core, playback.sfx);
        const unsigned steps = note.effect == 6 ? (speed <= 8 ? 2u : 4u)
                                                 : (speed <= 8 ? 1u : 2u);
        const unsigned offset = static_cast<unsigned>((static_cast<uint64_t>(fraction) * steps) >> 32) & 3u;
        note = read_note(core, playback.sfx, (note_index & ~3u) | offset);
    }
    uint32_t increment = kPhaseIncrement[note.key];
    if (note.effect == 1) {
        const uint32_t previous = kPhaseIncrement[playback.previous_key];
        const int64_t difference = static_cast<int64_t>(increment) - previous;
        increment = static_cast<uint32_t>(static_cast<int64_t>(previous)
            + ((difference * fraction) >> 32));
    } else if (note.effect == 2) {
        constexpr uint64_t period = P8_AUDIO_SAMPLE_RATE * 2 / 15;
        const uint64_t position = (playback.elapsed >> 32) % period;
        const int32_t vibrato = position < period / 2
            ? static_cast<int32_t>((position * 65536) / (period / 2)) - 32768
            : 32767 - static_cast<int32_t>(((position - period / 2) * 65536) / (period / 2));
        increment = static_cast<uint32_t>(static_cast<int64_t>(increment)
            + (static_cast<int64_t>(increment) * vibrato) / (32768 * 34));
    } else if (note.effect == 3) {
        increment = static_cast<uint32_t>((static_cast<uint64_t>(increment)
            * (std::numeric_limits<uint32_t>::max() - fraction)) >> 32);
    }
    return increment;
}

int32_t effect_volume(const p8_audio_playback &playback, const note_data &note)
{
    const uint32_t fraction = static_cast<uint32_t>(playback.position);
    int32_t volume = static_cast<int32_t>(note.volume) * 32767 / 7;
    if (note.effect == 1 && playback.previous_volume != 0) {
        const int32_t previous = static_cast<int32_t>(playback.previous_volume) * 32767 / 7;
        volume = previous + static_cast<int32_t>((static_cast<int64_t>(volume - previous) * fraction) >> 32);
    } else if (note.effect == 4) {
        volume = static_cast<int32_t>((static_cast<int64_t>(volume) * fraction) >> 32);
    } else if (note.effect == 5) {
        volume = static_cast<int32_t>((static_cast<int64_t>(volume)
            * (std::numeric_limits<uint32_t>::max() - fraction)) >> 32);
    }
    return volume;
}

void advance_playback(const p8_core *core, p8_audio_state &state, unsigned channel_index,
                      uint64_t transition_sample)
{
    p8_audio_playback &playback = state.channels[channel_index].playback;
    if (playback.sfx < 0) return;
    const unsigned speed = sfx_speed(core, playback.sfx);
    const uint64_t step = kOneNote / (183u * speed);
    const unsigned previous_note = static_cast<unsigned>(playback.position >> 32);
    playback.position += step;
    playback.elapsed += step;
    unsigned next_note = static_cast<unsigned>(playback.position >> 32);
    if (next_note != previous_note && previous_note < 32) {
        const note_data previous = read_note(core, playback.sfx, previous_note);
        playback.previous_key = previous.key;
        playback.previous_volume = previous.volume;
    }
    const unsigned loop_start = sfx_loop_start(core, playback.sfx);
    const unsigned loop_end = sfx_loop_end(core, playback.sfx);
    if (playback.can_loop && loop_end > loop_start && next_note >= loop_end) {
        const uint64_t loop_size = static_cast<uint64_t>(loop_end - loop_start) << 32;
        playback.position = (static_cast<uint64_t>(loop_start) << 32)
            + (playback.position - (static_cast<uint64_t>(loop_start) << 32)) % loop_size;
        next_note = static_cast<unsigned>(playback.position >> 32);
    }
    unsigned end = playback.length > 0 ? std::min<unsigned>(32, playback.length) : 32;
    if (!playback.is_music && loop_end == 0 && loop_start > 0) end = std::min(end, loop_start);
    if ((!playback.can_loop || loop_end <= loop_start) && next_note >= end) {
        stop_channel(state, channel_index, transition_sample);
        return;
    }
    if (next_note != previous_note) {
        append_event(state, transition_sample, P8_AUDIO_EVENT_NOTE,
                     static_cast<int>(channel_index), playback.sfx,
                     static_cast<int>(next_note), state.music.pattern);
    }
}

int32_t render_channel(p8_core *core, unsigned index)
{
    p8_audio_state &state = p8_core_audio_state(core);
    p8_audio_channel &channel = state.channels[index];
    if (channel.playback.sfx < 0 && channel.deferred_music_sfx >= 0) {
        const int sfx = channel.deferred_music_sfx;
        const uint64_t divisor = static_cast<uint64_t>(183) * sfx_speed(core, sfx);
        const unsigned offset = static_cast<unsigned>(std::min<uint64_t>(31,
            state.music.elapsed_samples / divisor));
        launch_sfx(state, index, sfx, offset, 0, true);
        channel.deferred_music_sfx = -1;
    }
    p8_audio_playback &playback = channel.playback;
    if (playback.sfx < 0) return 0;
    const unsigned note_index = static_cast<unsigned>(playback.position >> 32);
    if (note_index >= 32) {
        stop_channel(state, index, state.sample_clock);
        return 0;
    }
    note_data note = read_note(core, playback.sfx, note_index);
    int32_t sample = 0;
    if (note.volume != 0) {
        const uint32_t increment = effect_increment(core, playback, note_index, note);
        const int32_t volume = effect_volume(playback, note);
        sample = static_cast<int32_t>((static_cast<int64_t>(waveform(channel, note.waveform, increment))
            * volume) >> 15);
        if (playback.is_music) sample = static_cast<int32_t>((static_cast<int64_t>(sample)
            * state.music.volume) >> 17);
        else sample /= 2;
    }
    advance_playback(core, state, index, state.sample_clock + 1);
    return sample;
}

void advance_music(p8_core *core)
{
    p8_audio_state &state = p8_core_audio_state(core);
    if (state.music.pattern < 0) return;
    if (state.music.fade_step != 0) {
        state.music.volume = std::clamp(state.music.volume + state.music.fade_step, 0, 65536);
        if (state.music.fade_step < 0 && state.music.volume == 0) {
            set_music_pattern(core, -1);
            return;
        }
    }
    ++state.music.elapsed_samples;
    if (state.music.elapsed_samples < state.music.duration_samples) return;
    const int current = state.music.pattern;
    int next = current + 1;
    if (song_stop(core, current) || next > 63) {
        next = -1;
        state.music.count = -1;
    } else {
        ++state.music.count;
        if (song_loop_end(core, current)) {
            next = current;
            while (next > 0 && !song_loop_start(core, next)) --next;
        }
    }
    set_music_pattern(core, next);
}

void push_sample(p8_audio_state &state, int16_t sample)
{
    if (state.ring_count == state.ring.size()) {
        state.ring_read = (state.ring_read + 1) % state.ring.size();
        --state.ring_count;
    }
    state.ring[state.ring_write] = sample;
    state.ring_write = (state.ring_write + 1) % state.ring.size();
    ++state.ring_count;
}

} // namespace

extern "C" {

void p8_audio_reset(p8_core *core)
{
    if (!core) return;
    p8_core_audio_state(core) = p8_audio_state{};
}

int p8_audio_sfx(p8_core *core, int sfx, int channel, int offset, int length)
{
    if (!core) return -1;
    p8_audio_state &state = p8_core_audio_state(core);
    clear_error(state);
    if (sfx < -2 || sfx > 63 || channel < -2 || channel > 3 || offset > 31) {
        set_error(state, "invalid sfx request %d", sfx);
        return -1;
    }
    if (channel == -2) {
        for (unsigned index = 0; index < state.channels.size(); ++index) {
            if (state.channels[index].playback.sfx == sfx) {
                stop_channel(state, index, state.sample_clock);
            }
        }
        return -1;
    }
    if (sfx == -1 || sfx == -2) {
        const unsigned first = channel < 0 ? 0u : static_cast<unsigned>(channel);
        const unsigned last = channel < 0 ? 4u : first + 1;
        for (unsigned index = first; index < last; ++index) {
            p8_audio_playback &playback = state.channels[index].playback;
            if (playback.is_music) continue;
            if (sfx == -1) {
                stop_channel(state, index, state.sample_clock);
            } else if (playback.sfx >= 0 && playback.can_loop) {
                playback.can_loop = false;
                append_event(state, state.sample_clock, P8_AUDIO_EVENT_CHANNEL_RELEASE,
                             static_cast<int>(index), playback.sfx,
                             current_note(playback), state.music.pattern);
            }
        }
        return -1;
    }
    if (!validate_sfx(core, sfx)) return -1;
    if (channel == -1) {
        for (unsigned index = 0; index < 4; ++index) {
            if ((state.music.mask & (1u << index)) == 0
                && (state.channels[index].playback.sfx < 0
                    || state.channels[index].playback.sfx == sfx)) {
                channel = static_cast<int>(index);
                break;
            }
        }
    }
    if (channel == -1) {
        for (unsigned index = 0; index < 4; ++index) {
            if ((state.music.mask & (1u << index)) == 0
                && state.channels[index].playback.is_music) {
                channel = static_cast<int>(index);
                break;
            }
        }
    }
    if (channel == -1) {
        unsigned fastest = 256;
        for (unsigned index = 0; index < 4; ++index) {
            if ((state.music.mask & (1u << index)) != 0) continue;
            const int active = state.channels[index].playback.sfx;
            if (active >= 0 && sfx_speed(core, active) <= fastest) {
                fastest = sfx_speed(core, active);
                channel = static_cast<int>(index);
            }
        }
    }
    if (channel < 0) return -1;
    for (unsigned index = 0; index < state.channels.size(); ++index) {
        if (state.channels[index].playback.sfx == sfx) {
            stop_channel(state, index, state.sample_clock);
        }
    }
    p8_audio_channel &target = state.channels[static_cast<unsigned>(channel)];
    if (target.playback.sfx >= 0 && target.playback.is_music) {
        target.deferred_music_sfx = target.playback.sfx;
    }
    if (target.playback.sfx >= 0) {
        stop_channel(state, static_cast<unsigned>(channel), state.sample_clock);
    }
    launch_sfx(state, static_cast<unsigned>(channel), sfx,
               static_cast<unsigned>(std::max(0, offset)),
               static_cast<unsigned>(std::max(0, length)), false);
    return channel;
}

int p8_audio_music(p8_core *core, int pattern, int fade_milliseconds,
                   uint8_t channel_mask)
{
    if (!core) return 0;
    p8_audio_state &state = p8_core_audio_state(core);
    clear_error(state);
    if (pattern < -1 || pattern > 63) {
        set_error(state, "invalid music pattern %d", pattern);
        return 0;
    }
    if (pattern < 0) {
        if (fade_milliseconds <= 0) return set_music_pattern(core, -1) ? 1 : 0;
        const int64_t samples = std::max<int64_t>(1,
            static_cast<int64_t>(fade_milliseconds) * P8_AUDIO_SAMPLE_RATE / 1000);
        state.music.fade_step = -std::max<int32_t>(1,
            static_cast<int32_t>(state.music.volume / samples));
        return 1;
    }
    state.music.count = 0;
    state.music.mask = channel_mask & 0x0f;
    state.music.fade_step = 0;
    state.music.volume = 65536;
    if (fade_milliseconds > 0) {
        const int64_t samples = std::max<int64_t>(1,
            static_cast<int64_t>(fade_milliseconds) * P8_AUDIO_SAMPLE_RATE / 1000);
        state.music.volume = 0;
        state.music.fade_step = std::max<int32_t>(1, static_cast<int32_t>(65536 / samples));
    }
    return set_music_pattern(core, pattern) ? 1 : 0;
}

void p8_audio_host_tick60(p8_core *core)
{
    if (!core) return;
    p8_audio_state &state = p8_core_audio_state(core);
    state.sample_remainder += P8_AUDIO_SAMPLE_RATE;
    const unsigned frames = state.sample_remainder / 60;
    state.sample_remainder %= 60;
    for (unsigned frame = 0; frame < frames; ++frame) {
        int32_t mixed = 0;
        for (unsigned channel = 0; channel < 4; ++channel) mixed += render_channel(core, channel);
        push_sample(state, static_cast<int16_t>(std::clamp(mixed, -32768, 32767)));
        ++state.sample_clock;
        advance_music(core);
    }
}

size_t p8_audio_available(const p8_core *core)
{
    return core ? p8_core_audio_state(core).ring_count : 0;
}

size_t p8_audio_read(p8_core *core, int16_t *destination, size_t capacity)
{
    if (!core || !destination) return 0;
    p8_audio_state &state = p8_core_audio_state(core);
    const size_t count = std::min(capacity, state.ring_count);
    for (size_t index = 0; index < count; ++index) {
        destination[index] = state.ring[state.ring_read];
        state.ring_read = (state.ring_read + 1) % state.ring.size();
    }
    state.ring_count -= count;
    return count;
}

uint32_t p8_audio_capabilities(const p8_core *core)
{
    return core ? kCapabilities : 0;
}

int p8_audio_get_channel_status(const p8_core *core, unsigned channel,
                                p8_audio_channel_status *status)
{
    if (!core || channel >= P8_AUDIO_CHANNEL_COUNT || !status
        || (kCapabilities & P8_AUDIO_CAP_CHANNEL_STATUS) == 0) {
        return 0;
    }
    const p8_audio_channel &source = p8_core_audio_state(core).channels[channel];
    const bool active = source.playback.sfx >= 0;
    *status = {
        source.playback.sfx,
        current_note(source.playback),
        source.deferred_music_sfx,
        active && source.playback.is_music ? 1 : 0,
        active && !source.playback.can_loop ? 1 : 0,
    };
    return 1;
}

size_t p8_audio_copy_events(const p8_core *core, p8_audio_event *destination,
                            size_t capacity)
{
    if (!core || !destination || capacity == 0
        || (kCapabilities & P8_AUDIO_CAP_EVENT_LEDGER) == 0) {
        return 0;
    }
    const p8_audio_state &state = p8_core_audio_state(core);
    const size_t count = std::min(capacity, state.event_count);
    for (size_t index = 0; index < count; ++index) {
        destination[index] = state.events[(state.event_read + index) % state.events.size()];
    }
    return count;
}

int p8_audio_stat(const p8_core *core, unsigned selector, int32_t *value)
{
    if (!core || !value || selector < 46 || selector > 57) return 0;
    if (selector == 57 && (kCapabilities & P8_AUDIO_CAP_STAT_57) != 0) {
        *value = p8_core_audio_state(core).music.pattern >= 0 ? 1 : 0;
        return 1;
    }
    /* Field names are documented, but their tick-history transition boundaries
     * are normative runtime behavior. Do not expose guessed values before the
     * licensed capture closes P8_AUDIO_CAP_STAT_46_56. */
    return 0;
}

int p8_audio_current_sfx(const p8_core *core, unsigned channel)
{
    return core && channel < 4 ? p8_core_audio_state(core).channels[channel].playback.sfx : -1;
}

int p8_audio_current_music(const p8_core *core)
{
    return core ? p8_core_audio_state(core).music.pattern : -1;
}

const char *p8_audio_last_error(const p8_core *core)
{
    return core ? p8_core_audio_state(core).error.data() : "no core";
}

} // extern "C"
