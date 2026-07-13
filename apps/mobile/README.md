# Aico 8 Android host

Planned Capacitor Android packaging for the shared Web/Wasm application:

- Android lifecycle, audio-focus, and save adapters;
- controller and low-latency touch layouts;
- safe-area handling around the canonical square 1024 design surface;
- audio focus, suspend/resume, haptics, and offline asset bundles;
- Android accessibility and release validation.

Game logic and compatibility behavior remain inside the shared core.
Linux handhelds consume the browser/PWA artifact first and belong to a later
device-profile or thin-Web-shell area, not this Android wrapper.
