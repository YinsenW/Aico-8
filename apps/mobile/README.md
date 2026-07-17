# Aico 8 Android host

Capacitor Android packaging for the shared Web/Wasm application:

- Android lifecycle, audio-focus, and save adapters;
- controller and low-latency touch layouts;
- safe-area handling around the canonical square 1024 design surface;
- audio focus, suspend/resume, and offline asset bundles;
- Android accessibility and release validation.

Game logic and compatibility behavior remain inside the shared core.
Linux handhelds consume the browser/PWA artifact first and belong to a later
device-profile or thin-Web-shell area, not this Android wrapper.

The wrapper never builds a second game bundle. `pnpm assemble:web` copies one
already-validated Web package into the ignored `www/` staging directory and
records a content-addressed lineage manifest. `pnpm verify:lineage` then proves
that the staged bytes and Capacitor's Android asset copy are identical to that
source package before a native build may proceed.

Capacitor 8 requires Android Studio 2025.2.1 or newer and an Android SDK. The
project targets API 36 and supports API 24+. APK/AAB signing keys and physical
device evidence are deliberately external inputs and are never committed.

For a named physical handheld, connect exactly one authorized non-emulator
device with its controller attached, then run:

```sh
pnpm --filter @aico8/mobile capture:device -- \
  <debug-apk> <android-test-apk> <android-web-lineage.json> \
  <device-profile-id> <controller-name> <evidence-output-directory>
```

The collector installs the lineage-bound test build, disables networking,
proves the local Web host, native touch, storage recreation, and a ready-screen
capture, and records the physical display, vendor WebView, controller listing,
cold launch, logcat, and frame stats. It hashes rather than stores the adb
serial. A successful collection intentionally reports `pending-human`: audio
interruption/recovery, controller gameplay, vendor-WebView gameplay, and
sustained gameplay performance must all be reviewed before the contract permits
`passed`.

Record those four outcomes in an
`aico8.android-device-manual-decision.v1` file whose
`subjectReportSha256` is the exact SHA-256 of the pending report, then finalize
without mutating either input:

```sh
pnpm --filter @aico8/mobile finalize:device -- \
  <pending-report.json> <manual-decision.json> <final-report.json>
```

The decision forbids `pending` values. Any failed manual check produces a failed
final report; only four explicit passes produce `passed`.
