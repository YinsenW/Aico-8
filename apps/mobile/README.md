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
  <debug-apk> <android-test-apk> <android-web-lineage.json> <target-profile.json> \
  <device-profile-id> <controller-name> <performance-capture-seconds> \
  <evidence-output-directory>
```

The collector installs the lineage-bound test build, disables networking,
proves the local Web host, native touch, storage recreation, and a ready-screen
capture, and records the physical display, vendor WebView, controller listing,
cold launch, user-orientation state preservation, logcat, and frame stats. The
lineage-bound target profile supplies the warmup/sample counts and performance
budgets. During the minimum 60-second measurement window, play continuously with
the named controller; insufficient frames, an over-budget p95, excess dropped
frames, or missing orientation evidence fails automatically. The collector
hashes rather than stores the adb serial. A successful collection intentionally
reports `pending-human`: audio interruption/recovery, controller gameplay,
vendor-WebView gameplay, and sustained gameplay quality must all be reviewed
before the contract permits `passed`.

Before handing the machine evidence to a reviewer, recompute every subject and
artifact binding without requiring the device to stay attached:

```sh
pnpm --filter @aico8/mobile verify:device -- \
  <android-device-validation.json> <debug-apk> <android-web-lineage.json> \
  <target-profile.json> <evidence-directory>
```

After `finalize:device`, verify the final report with the exact pending report
and decision bytes appended to the same command. A reviewed report is rejected
when either file is omitted or when the reconstructed final report differs:

```sh
pnpm --filter @aico8/mobile verify:device -- \
  <final-report.json> <debug-apk> <android-web-lineage.json> \
  <target-profile.json> <evidence-directory> \
  <pending-report.json> <manual-decision.json>
```

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

## Linux handheld browser-first evidence

Linux does not receive another game implementation or a pre-emptive native shell.
Use `target-profile.linux.json` with the exact validated Web/PWA release. A named
device harness records its browser/device identity, Web capability results, frame
durations, and the conventional evidence files `ready.png`, `capabilities.json`,
`offline.json`, `storage.json`, `controller.json`, `lifecycle.json`, and
`performance.json`. Import and derive the fail-closed report with:

```sh
pnpm --filter @aico8/mobile capture:linux -- \
  <machine-capture.json> <web-release-directory> <linux-target-profile.json> \
  <evidence-directory> <pending-report.json>
```

The command recomputes the Web tree, target-profile, release-manifest, visual-runtime,
and evidence hashes plus the target-owned performance budgets. All browser capabilities
passing yields `pending-human`; any failed required capability yields `browser-gap`
only when `capabilityGaps` contains an exact evidence-bound entry. Controller gaps bind
`controller.json`; offline gaps bind `offline.json`; storage gaps bind `storage.json`;
audio, fullscreen, Wasm, and WebGL2 gaps bind `capabilities.json`. A `thin-web-shell`
remediation is permission to investigate that gap, not evidence that a shell or the
platform exit passes. Recheck retained bytes and finalize an all-pass manual decision:

```sh
pnpm --filter @aico8/mobile verify:linux -- \
  <report.json> <web-release-directory> <linux-target-profile.json> <evidence-directory>

pnpm --filter @aico8/mobile finalize:linux -- \
  <pending-report.json> <manual-decision.json> <final-report.json>

pnpm --filter @aico8/mobile verify:linux -- \
  <final-report.json> <web-release-directory> <linux-target-profile.json> \
  <evidence-directory> <pending-report.json> <manual-decision.json>
```

The shorter verifier form is only for an unreviewed report. Once a manual
decision is present, omission or byte drift of either source file fails closed.
