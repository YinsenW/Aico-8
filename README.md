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

Aico 8 is not tied to one model or coding client. Its portable
`aico8-remake.zip` follows the Agent Skills `SKILL.md` convention and is the
default distribution. The same package works with Claude Code, Codex, OpenCode,
and Cherry Studio; only the one-time import screen or destination folder differs.

Download the latest `aico8-remake.zip` from
[Releases](https://github.com/YinsenW/Aico-8/releases/latest), then install it:

| Agent host | Install the same ZIP |
| --- | --- |
| [Claude Code](https://code.claude.com/docs/en/slash-commands#where-skills-live) | Extract as `~/.claude/skills/aico8-remake/` |
| Codex | Extract as `~/.agents/skills/aico8-remake/` |
| [OpenCode](https://opencode.ai/docs/skills/#place-files) | Extract as `~/.config/opencode/skills/aico8-remake/`; it also discovers the two paths above |
| [Cherry Studio](https://docs.cherry-ai.com/docs/en-us/advanced-basic/agent) | Library → Add Skill → Local import → select `aico8-remake.zip` |

Codex users may alternatively install the native Codex plugin wrapper:

```sh
codex plugin marketplace add YinsenW/Aico-8 --ref v0.1.2
codex plugin add aico8@aico8
```

Those commands are a Codex convenience, not a requirement of Aico 8 or the
portable Skill.

## Remake a cart

Start a new Agent task, attach one `.p8` or `.p8.png` cart, and say:

```text
Use Aico 8 to remake this authorized cart for Web.
```

Or:

```text
Use Aico 8 to remake this authorized cart for Web and Android APK.
```

The Agent loads the Skill, installs the versioned engine in private local state,
runs browser or Android-emulator validation, and returns the finished artifacts.
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
