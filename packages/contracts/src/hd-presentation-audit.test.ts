import { describe, expect, it } from "vitest";

import type { HdIdentityMapV1 } from "./hd-identity-map.js";
import {
  buildHdPresentationAudit,
  validateHdPresentationAudit,
  type HdFrameObservation,
  type SourceVisualTokenDefinition,
} from "./hd-presentation-audit.js";

const hash = (digit: string): string => digit.repeat(64);
const identityMap = {
  status: "accepted",
  gameId: "synthetic-game",
  canonicalReplayId: "synthetic-replay",
  visualGrammarId: "synthetic-grammar",
  coverage: {
    reachableElementIds: ["scene.gameplay", "environment.wall"],
    mappedElementIds: ["scene.gameplay", "environment.wall"],
  },
  elements: [{ id: "scene.gameplay" }, { id: "environment.wall" }],
} as HdIdentityMapV1;
const catalog: SourceVisualTokenDefinition[] = [
  { id: "scene:gameplay", kind: "scene", identityElementId: "scene.gameplay" },
  { id: "tile:32-47", kind: "tile", identityElementId: "environment.wall" },
  { id: "tile:48-63", kind: "tile", identityElementId: "environment.wall" },
];
const frames = (stateHash = hash("a")): HdFrameObservation[] => [{
  update: 0,
  sceneId: "scene.gameplay",
  sourceTokenIds: ["scene:gameplay", "tile:32-47", "tile:48-63"],
  mixedIndexedFragments: 0,
  diagnosticReferenceSwitches: 0,
  compatibilityStateSha256: stateHash,
}];

describe("HD presentation audit", () => {
  it("accepts complete source-token coverage and per-update state invariance", () => {
    const audit = buildHdPresentationAudit({
      identityMap,
      identityMapSha256: hash("b"),
      catalog,
      hdOffFrames: frames(),
      hdOnFrames: frames(),
      status: "accepted",
      observationRuns: [{ id: "canonical", kind: "canonical-replay", startUpdate: 0, endUpdateExclusive: 1 }],
      regressions: [{ id: "remove-wall-variant", category: "coverage-mutation", rejected: true }],
    });
    expect(validateHdPresentationAudit(audit, identityMap)).toEqual({ valid: true, errors: [] });
  });

  it("keeps an observed but undeclared visual variant as an explicit failure", () => {
    const audit = buildHdPresentationAudit({
      identityMap,
      identityMapSha256: hash("b"),
      catalog: catalog.filter(({ id }) => id !== "tile:48-63"),
      hdOffFrames: frames(),
      hdOnFrames: frames(),
      status: "accepted",
      observationRuns: [{ id: "canonical", kind: "canonical-replay", startUpdate: 0, endUpdateExclusive: 1 }],
      regressions: [{ id: "remove-wall-variant", category: "coverage-mutation", rejected: true }],
    });
    const result = validateHdPresentationAudit(audit, identityMap);
    expect(result.valid).toBe(false);
    expect(audit.coverage.unmappedSourceTokenIds).toEqual(["tile:48-63"]);
    expect(result.errors.some((error) => error.includes("unmapped"))).toBe(true);
  });

  it("rejects a renderer observation that changes compatibility state", () => {
    const audit = buildHdPresentationAudit({
      identityMap,
      identityMapSha256: hash("b"),
      catalog,
      hdOffFrames: frames(hash("a")),
      hdOnFrames: frames(hash("c")),
      status: "accepted",
      observationRuns: [{ id: "canonical", kind: "canonical-replay", startUpdate: 0, endUpdateExclusive: 1 }],
      regressions: [{ id: "remove-wall-variant", category: "coverage-mutation", rejected: true }],
    });
    const result = validateHdPresentationAudit(audit, identityMap);
    expect(result.valid).toBe(false);
    expect(audit.invariance.mismatchUpdateIds).toEqual([0]);
  });

  it("rejects mixed indexed output and diagnostic reference switches", () => {
    const mixed = frames().map((frame) => ({ ...frame, mixedIndexedFragments: 1, diagnosticReferenceSwitches: 1 }));
    const audit = buildHdPresentationAudit({
      identityMap,
      identityMapSha256: hash("b"),
      catalog,
      hdOffFrames: frames(),
      hdOnFrames: mixed,
      status: "accepted",
      observationRuns: [{ id: "canonical", kind: "canonical-replay", startUpdate: 0, endUpdateExclusive: 1 }],
      regressions: [{ id: "remove-wall-variant", category: "coverage-mutation", rejected: true }],
    });
    expect(validateHdPresentationAudit(audit, identityMap).valid).toBe(false);
  });
});
