# ADR 0003: Internal modules with standalone delivery first

- Status: accepted
- Date: 2026-07-13
- Scope: game modules, batch conversion, collections, packaging, and future Player

## Context

Aico 8 must ship the first modernized game quickly, accept several carts in one
request later, reuse one runtime across platforms, and avoid freezing a public
cartridge ABI before real games prove it. A standalone product may still contain
one or several statically embedded games; this differs from a Player that loads
arbitrary external packages after installation.

## Decision

1. Each remake becomes a versioned internal game module behind
   `API-GAME-MODULE-001`; it is not a public distribution format.
2. The first product is one statically bound, standalone Web/PWA game.
3. After at least three materially different games pass independent validation,
   the packager may create a fixed collection with a launcher and isolated saves.
4. A multi-cart request fans out to isolated workspaces and acceptance records;
   only validated modules may enter assembly.
5. A stable `.aico8` and general external-cart Player require a later ADR after
   compatibility, migration, security, signing, store-policy, and demand evidence.
6. Web/PWA is release-critical. Mobile, desktop, and ESP32 retain contract seams
   but do not block the first complete game.

## Consequences

- Users receive ordinary standalone artifacts without first installing a Player.
- The shared runtime is deduplicated inside a fixed collection.
- Adding or removing a collection game requires rebuilding and repackaging.
- Per-game provenance, validation, save migration, and licenses remain independent.
- The internal boundary can evolve until multi-game evidence justifies stability.

## Reversal gate

A future Player ADR must show three validated games with no private runtime APIs,
backward-compatible package loading and save migration, a signed/untrusted-content
model, Web plus one installed host, and a product need that static delivery cannot
serve. Until then, `.aico8` is a reserved idea rather than a contract.
