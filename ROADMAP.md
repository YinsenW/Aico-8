# Aico 8 milestone view

This file shows dependency order only. It intentionally contains no completion
checkboxes or copied status. Current focus, exits, evidence, tests, and open work
are owned by `governance/project.json`.

| Milestone | Product requirements | Outcome |
| --- | --- | --- |
| M0 Governance and public source | REQ-GOV-001, REQ-REPO-001 | Governance remains above 9.5/10 and a licensed, sanitized source history can become public |
| M1 Lossless workbench | REQ-INGEST-001 | Authorized carts become versioned, rebuildable workspaces |
| M2 Compatibility | REQ-COMPAT-001, REQ-INPUT-001 | Native/Wasm kernel matches licensed official behavior |
| M3 First complete private trial | REQ-HD-001, REQ-TYPOGRAPHY-001, REQ-WEB-001, REQ-REMAKE-001 | The representative cart is complete and playable for research/testing; no formal release occurs without permission |
| M4 Technical release | REQ-RELEASE-001 | Reproducible Web/PWA package, validation, notices, and rights decision |
| M5 Generalization | REQ-INGEST-001, REQ-COMPAT-001, REQ-HD-001 | Additional dynamic, audio, 60 Hz, input, and `tline` carts pass |
| M6 Thin Skill | REQ-SKILL-001 | Stable Jobs are orchestrated only after repeated verified releases |

The dependency path for the active requirement is recorded in `current_focus`.
Product wording is in `docs/PRODUCT.md`; language ownership and proof gates are
in `docs/decisions/0001-language-boundary.md`.
