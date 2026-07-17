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
