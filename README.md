# Aico 8

[简体中文](docs/README.zh-CN.md)

Aico 8 turns an authorized PICO-8 cart into a modern HD game while preserving
its gameplay, controls, timing, music, and sound. The primary presentation
target is a square 1024×1024 display.

Outputs:

- **Web/PWA** — runs in a browser and can be installed for offline play.
- **Android APK** — runs on Android phones and handhelds.
- **Both** — the Web and Android builds share the same game kernel and assets.

> Use only carts that you are authorized to research or adapt. Outputs remain
> private by default and are never uploaded or published automatically.

## One portable Agent Skill

Aico 8 is not tied to one model or coding client. The same `aico8-remake` Skill
bootstraps the pinned full toolchain in Claude Code, Codex, OpenCode, and Cherry
Studio. It is not an instruction-only prompt and it does not require the Codex
CLI. Web remakes use the bundled, hash-verified Wasm kernel, so users do not need
C++, Emscripten, or Android Studio.

For a terminal-based Agent, copy the matching one-line installer:

| Agent host | One-line install |
| --- | --- |
| Claude Code | `npx skills add https://github.com/YinsenW/Aico-8/tree/v0.1.3 -g -a claude-code -s aico8-remake -y` |
| Codex | `npx skills add https://github.com/YinsenW/Aico-8/tree/v0.1.3 -g -a codex -s aico8-remake -y` |
| OpenCode | `npx skills add https://github.com/YinsenW/Aico-8/tree/v0.1.3 -g -a opencode -s aico8-remake -y` |

This installs directly from GitHub; no skills registry entry is required. For
[Cherry Studio](https://docs.cherry-ai.com/docs/en-us/advanced-basic/agent),
download `aico8-remake.zip` from
[Releases](https://github.com/YinsenW/Aico-8/releases/latest), then choose
**Library → Add Skill → Local import**. The ZIP is the same Skill, not a reduced
edition.

An optional Codex plugin wrapper also exists, but it is not the default product
and is not needed by any other Agent.

## Remake a cart

Start a new Agent task, attach one `.p8` or `.p8.png` cart, and say:

```text
Use Aico 8 to remake this authorized cart for Web.
```

Or:

```text
Use Aico 8 to remake this authorized cart for Web and Android APK.
```

The Agent loads the Skill, installs the complete versioned engine in private
local state, verifies the prebuilt Web/Wasm kernel, runs browser or
Android-emulator validation, and returns the finished artifacts.
The user should not need repository paths, build commands, TypeScript, C++, Wasm,
Gradle, or Android Studio knowledge.

## Human review remains mandatory

HD remaking is not mechanical upscaling. For each game, the Agent must show
source/HD comparisons and obtain approval in this order:

1. **Spirit fidelity** — identities, atmosphere, gameplay, and meaning remain recognizable.
2. **Quality leap** — resolution, contours, materials, animation, and detail genuinely improve.
3. **Aesthetic evolution** — color, lighting, composition, and finish meet modern expectations without redesigning the source identity.

Agent-driven compatibility, building, and evidence collection are automated.
Semantic interpretation, art direction, representative gameplay, and final scope
remain explicit human decisions.

## What Aico 8 contains

- The **Skill** is the portable natural-language control surface.
- The **toolchain** ingests carts, integrates HD presentation, validates, and packages.
- The **runtime** preserves the authoritative original behavior beneath the HD layer.

The Android build packages the already validated Web bytes; it is not a separate
game implementation. Physical devices are optional for technical acceptance:
browser and Android-emulator evidence are supported.

## Maintainers

Development, recovery, testing, and governance start at [AGENTS.md](AGENTS.md)
and [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Current status, evidence, and
open work are owned only by [governance/project.json](governance/project.json).

Repository code is licensed under [Apache-2.0](LICENSE). This license does not
cover PICO-8 itself, third-party carts, their assets, or generated remakes.
