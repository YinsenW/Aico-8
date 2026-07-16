# PICO-8 audio preservation and oracle plan

Status: extraction/rebuild is lossless; official PCM/status goldens are waiting
for a licensed local PICO-8 runtime.

## Product rule

Audio is preserved by default, not modernized. A remake may use a cleaner host
output path, but notes, timing, instruments, effects, filters, loops, music
flow, and audible behavior remain PICO-8-compatible. Any later soundtrack
replacement is a separate creative choice and must never be required for the
remake pipeline.

The shared runtime therefore needs one synth implementation used by web,
iOS/Android, desktop, and embedded targets. Offline WAV/OGG generation calls
the same synth; it is not a second interpretation of the cart.

## What the corpus contains

`tools/analyze_p8_audio.py /tmp/pico8-unpacked` currently reports:

| Measurement | Result |
| --- | ---: |
| Carts scanned | 291 |
| Carts with audible notes | 275 |
| Carts with music patterns | 257 |
| Carts with filter/property bits | 134 |
| Carts referring to custom instruments | 131 |

Every base waveform and every note effect appears in the corpus. The highest
coverage stress candidate is `132_Downstream_Dream_🛶.p8`: it contains all
16 waveform selectors, all eight effects, 63 SFX records with non-editor raw
property bits, all eight custom-instrument references, and all observed music
flow flags. This is an internal test input unless its author grants permission
to publish derived captures or a remake.

These counts describe encoded cart content, not proof that every feature is
reached during normal gameplay. Runtime reachability is a separate trace task.

## Lossless resource schema

Each extracted SFX now has two views of its four-byte header:

- `properties_raw`: the exact four bytes used for rebuilding.
- `editor_mode`, `filters`, `speed`, `loop_start`, and `loop_end`: decoded fields
  for analysis and future editing.

Rebuilding always prefers `properties_raw`; the readable fields cannot silently
rewrite unknown or version-dependent bits. Older extracted workspaces without
`properties_raw` remain supported. After this change, all 291 carts completed
the stronger PNG -> workspace -> text cart -> PNG round trip with exact decoded
ROM and resource hashes and zero failures.

Music records follow the same rule: raw flag/channel bytes remain authoritative,
while decoded loop/stop/channel fields are an editable view.

## Official oracle capture

The official manual defines both required capture paths:

1. `EXPORT FOO%D.WAV` writes all 64 SFX to individual WAV files.
2. `extcmd("audio_rec")` and `extcmd("audio_end")` record runtime audio,
   including music, fades, channel arbitration, and live RAM mutation.
3. `stat(46..57)` exposes tick-history audio state; it must be sampled once per
   logical update and compared alongside PCM.

The executable fixture is `tests/conformance/probes/audio_status.p8`; the exact
capture inventory and provenance requirements are in
`tests/conformance/audio_capture_manifest.json`. It covers base waveforms and
effects, filtered looping audio, loop release, music fade, explicit channels,
live copying into SFX RAM, and the modern status queries.

Official manual references:

- https://www.lexaloffle.com/dl/docs/pico-8_manual.html#SFX-and-Music
- https://www.lexaloffle.com/dl/docs/pico-8_manual.html#EXTCMD
- https://www.lexaloffle.com/dl/docs/pico-8_manual.html#STAT

The official capture command accepts repeatable `--artifact relative.wav`,
`--artifact relative.png`, and `--artifact relative.csv` declarations. The
runtime capture's exact command and required `p8_audio_runtime.wav` plus
`audio_status.csv` arguments are owned by the capture manifest. Outputs are
produced in an isolated working directory, copied under the ignored capture bundle, and bound to the
runtime/cart record by media type, size, and SHA-256. Undeclared filesystem
output is discarded; missing or mutated declared output fails closed.

Independent runtimes are differential-test subjects only. Their WAV output or
status traces must not be committed as normative goldens.

`pnpm compare:official-probe` performs the eventual runtime-audio comparison at
the decoded integer-PCM and normalized CSV-cell boundaries, so RIFF metadata and
CRLF/LF differences cannot create false failures. Candidate capture generation
must still come from the production kernel and bind its binary hash; the current
audio selectors deliberately remain fail-closed, so no candidate or matched
report is claimed before the licensed status trace defines the missing behavior.

## Runtime boundary

The compatibility core owns:

- the 0x3100 music and 0x3200 SFX memory views;
- four-channel scheduling, reservation, interruption, release, and music flow;
- all built-in and custom instruments, note effects, and filters;
- fixed logical audio ticks and `stat(46..57)` history;
- a deterministic PCM stream before host resampling.

Platform adapters only own the output device, buffering, and sample-rate
conversion. They may not decide musical timing from browser animation frames,
mobile callbacks, or display refresh.

The Web adapter exposes its host-only measurements on `#game-frame` as
`data-audio-*` fields. The evidence includes context/unlock state, browser base
and output latency when available, pending and discarded sample counts,
scheduled chunks/samples, accumulated underrun count and duration, excessive
lead resynchronizations, and current/maximum buffered lead. These measurements
are diagnostics for device integration; they do not qualify synth semantics or
replace official PCM/status goldens. Unit fixtures deterministically exercise
the drop, underrun, and resynchronization paths, while retained device evidence
must name the browser, operating system, audio device, and interaction used to
unlock playback.

## Acceptance order

1. Raw extracted/rebuilt bytes are identical.
2. Per-update `stat(46..57)` traces match the official runtime.
3. Pre-resampling PCM length, event boundaries, looping, release, fades, and
   channel ownership match.
4. Prefer sample-exact PCM. If official output itself varies across supported
   hosts, first measure that variation, then define the smallest justified
   numeric tolerance; do not begin with a perceptual similarity threshold.
5. Host resampler tests are separate from synth conformance.

No audio subsystem is considered complete until the synthetic fixture and at
least one permission-safe real cart pass these layers.
