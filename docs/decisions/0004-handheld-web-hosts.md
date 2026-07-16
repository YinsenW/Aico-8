# ADR 0004: One Web host for browser, Android, and Linux handhelds

- Status: accepted
- Date: 2026-07-14
- Scope: target platforms, host reuse, and handheld delivery priority
- Supersedes: ADR 0003 decision 6 and the iOS/desktop target assumptions in ADR 0001

## Context

The intended play environment is primarily phones and handheld consoles. Most
commercial handhelds use Android, while many open handhelds use Linux. Building
separate gameplay or presentation implementations would increase drift and make
full-game qualification less trustworthy. ESP32-class hardware has no suitable
browser environment and represents a different future product decision.

## Decision

1. Browser Web/PWA is the current release-critical target.
2. The reusable host is the TypeScript Web application, HD presentation, and
   Wasm compatibility kernel; “Web host” does not replace the portable kernel.
3. Android packages the unchanged Web artifact in Capacitor/WebView as APK/AAB.
   Native code is limited to lifecycle, storage, audio focus, controller, haptic,
   signing, and store integration.
4. Linux handhelds run the same browser/PWA artifact first. A thin Web shell is
   allowed only after a named device exposes a measured browser capability gap.
5. Windows, macOS, and iOS packages are outside the current roadmap.
6. ESP32 remains optional future work: it may reuse the game-module, replay, and
   compatibility contracts through a native host, but it is not a Web-host target
   and cannot enter current milestones without a new product decision.

## Consequences

- Web, Android, and Linux handheld acceptance share one application/runtime lineage.
- Platform tests focus on lifecycle and device integration instead of revalidating
  a forked game implementation.
- Android follows the complete browser game; Linux handheld work follows Android.
- ESP32 research cannot expand current scope or force Web compromises.

## Reversal gate

Adding Windows, macOS, iOS, or active ESP32 delivery requires a new product need,
a target profile, an owner, acceptance selectors, and evidence that the work will
not delay or fork the Web/Android/Linux lineage.
