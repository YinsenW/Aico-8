import { describe, expect, it } from "vitest";

import { validateHdIdentityMap } from "./hd-identity-map.js";

const hash = "a".repeat(64);

function bunnyMap(): Record<string, unknown> {
  return {
    schemaVersion: "aico8.hd-identity-map.v1",
    gameId: "dust-bunny",
    cartSha256: hash,
    visualGrammarId: "dust-bunny.soft-rounded.v1",
    canonicalReplayId: "dust-bunny.all-levels.v1",
    status: "accepted",
    elements: [{
      id: "dust-bunny.player",
      kind: "character",
      semanticRole: "round, friendly player character",
      evidence: [{ id: "player-source", kind: "source-animation", sourceRef: "sprite:player/all-frames", sha256: hash }],
      copy: { origin: "none", sourceCopy: [], targetCopy: [], evidenceIds: [] },
      anchors: {
        silhouetteTraits: ["compact round face", "two upright ears"],
        requiredParts: [
          { id: "face", label: "round face", sourceEvidenceIds: ["player-source"], targetRegionIds: ["face"], recognitionCues: ["source-round facial mass"], forbiddenSubstitutions: ["elongated replacement face"] },
          { id: "ears", label: "paired ears", sourceEvidenceIds: ["player-source"], targetRegionIds: ["left-ear", "right-ear"], recognitionCues: ["two separately readable upright ears"], forbiddenSubstitutions: ["ears merged into ambiguous head bumps"] },
          { id: "whiskers", label: "visible whiskers", sourceEvidenceIds: ["player-source"], targetRegionIds: ["whiskers"], recognitionCues: ["source-count whisker strokes"], forbiddenSubstitutions: ["cheek decoration without whisker direction"] },
        ],
        proportionChecks: [{ id: "face-ratio", label: "face width / face height", sourceRatio: 1.05, targetRatio: 1.08, maximumAbsoluteDelta: 0.1 }],
        compositionChecks: [{
          id: "player-frame-region",
          label: "player location and screen footprint",
          sourceEvidenceIds: ["player-source"],
          targetRegionIds: ["face", "left-ear", "right-ear", "whiskers"],
          sourceBounds: { x: 0.25, y: 0.25, width: 0.25, height: 0.25 },
          targetBounds: { x: 0.26, y: 0.24, width: 0.26, height: 0.26 },
          maximumEdgeDelta: 0.05,
        }],
        contourChecks: [],
        faceAndExpressionTraits: ["gentle cute expression"],
        colorHierarchy: ["light face mass", "dark facial features", "accent inner ears"],
        motionCues: ["soft compact locomotion"],
        gameplayCues: ["player remains distinct from dust and walls"],
        forbiddenTransformations: ["long face", "missing ears", "missing whiskers", "aggressive expression"],
      },
      allowedModernization: ["material", "lighting", "surface-detail", "animation-sampling"],
      render: {
        assetSha256: hash,
        recipeId: "dust-bunny.player.v1",
        targetRegionIds: ["face", "left-ear", "right-ear", "whiskers"],
        runtimeModelCalls: false,
      },
      review: {
        reviewer: "identity-review-001",
        sourceSceneIds: ["source-level-01"],
        targetSceneIds: ["hd-level-01"],
        silhouettePassed: true,
        requiredPartsPassed: true,
        proportionsPassed: true,
        contoursPassed: true,
        expressionPassed: true,
        colorHierarchyPassed: true,
        motionPassed: true,
        gameplayCuesPassed: true,
        visualGrammarPassed: true,
      },
    }],
    coverage: {
      reachableElementIds: ["dust-bunny.player"],
      mappedElementIds: ["dust-bunny.player"],
      mixedIndexedFragments: 0,
      diagnosticReferenceSwitches: 0,
    },
  };
}

describe("HD identity map v1", () => {
  it("accepts a frozen, reviewed, fully mapped character identity", () => {
    expect(validateHdIdentityMap(bunnyMap())).toEqual({ valid: true, errors: [] });
  });

  it("rejects changing a round source face into an unsupported long face", () => {
    const map = bunnyMap() as any;
    map.elements[0].anchors.proportionChecks[0].targetRatio = 1.65;
    expect(validateHdIdentityMap(map).errors).toContain(
      "$.elements[0].anchors.proportionChecks[0].targetRatio changes the declared source proportion beyond maximumAbsoluteDelta",
    );
  });

  it("rejects relocating or resizing source composition even when its internal ratio still passes", () => {
    const map = bunnyMap() as any;
    map.elements[0].anchors.compositionChecks[0].targetBounds = {
      x: 0.55, y: 0.25, width: 0.25, height: 0.25,
    };
    expect(validateHdIdentityMap(map).errors).toContain(
      "$.elements[0].anchors.compositionChecks[0].targetBounds changes the declared source composition beyond maximumEdgeDelta",
    );
  });

  it("accepts source-locked logo contours and rejects topology or projected-mask redesign", () => {
    const map = bunnyMap() as any;
    map.elements[0].anchors.contourChecks = [{
      id: "logo-outline",
      label: "source wordmark outline",
      sourceEvidenceIds: ["player-source"],
      targetRegionIds: ["face"],
      sourceMaskSha256: hash,
      targetDownsampledMaskSha256: hash,
      sourceComponentCount: 4,
      targetComponentCount: 4,
      sourceHoleCount: 2,
      targetHoleCount: 2,
      measuredMaximumDisplacementSourcePixels: 0.3125,
      maximumDisplacementSourcePixels: 0.375,
    }];
    expect(validateHdIdentityMap(map)).toEqual({ valid: true, errors: [] });

    map.elements[0].anchors.contourChecks[0].targetDownsampledMaskSha256 = "b".repeat(64);
    map.elements[0].anchors.contourChecks[0].targetHoleCount = 1;
    const errors = validateHdIdentityMap(map).errors;
    expect(errors).toContain(
      "$.elements[0].anchors.contourChecks[0].targetDownsampledMaskSha256 must preserve the exact source-cell projection",
    );
    expect(errors).toContain(
      "$.elements[0].anchors.contourChecks[0].targetHoleCount must preserve source counter/hole topology",
    );
  });

  it("accepts a long face when the source identity is also long-faced", () => {
    const map = bunnyMap() as any;
    map.elements[0].semanticRole = "recognizably long-faced source character";
    map.elements[0].anchors.silhouetteTraits = ["long narrow face", "source-specific head crest"];
    map.elements[0].anchors.requiredParts = [
      { id: "face", label: "long narrow face", sourceEvidenceIds: ["player-source"], targetRegionIds: ["face"], recognitionCues: ["source-long facial silhouette"], forbiddenSubstitutions: ["rounding the source face"] },
      { id: "crest", label: "head crest", sourceEvidenceIds: ["player-source"], targetRegionIds: ["left-ear"], recognitionCues: ["single source crest"], forbiddenSubstitutions: ["replacing the crest with paired ears"] },
    ];
    map.elements[0].anchors.proportionChecks[0] = {
      id: "face-ratio",
      label: "face height / face width",
      sourceRatio: 1.65,
      targetRatio: 1.62,
      maximumAbsoluteDelta: 0.1,
    };
    map.elements[0].anchors.forbiddenTransformations = ["rounding the original long face", "removing the head crest"];
    expect(validateHdIdentityMap(map)).toEqual({ valid: true, errors: [] });
  });

  it("rejects an omitted identity-bearing part", () => {
    const map = bunnyMap() as any;
    map.elements[0].anchors.requiredParts[2].targetRegionIds = ["missing-whiskers-region"];
    expect(validateHdIdentityMap(map).errors).toContain(
      "$.elements[0].anchors.requiredParts[2].targetRegionIds references unknown target region missing-whiskers-region",
    );
  });

  it("rejects a named target region whose identity-bearing part has no visual recognition contract", () => {
    const map = bunnyMap() as any;
    delete map.elements[0].anchors.requiredParts[1].recognitionCues;
    map.elements[0].anchors.requiredParts[1].forbiddenSubstitutions = [];
    const errors = validateHdIdentityMap(map).errors;
    expect(errors).toContain("$.elements[0].anchors.requiredParts[1].recognitionCues is required");
    expect(errors).toContain("$.elements[0].anchors.requiredParts[1].forbiddenSubstitutions must contain at least 1 string(s)");
  });

  it("rejects runtime model generation and identity redesign dimensions", () => {
    const map = bunnyMap() as any;
    map.elements[0].render.runtimeModelCalls = true;
    map.elements[0].allowedModernization.push("face-shape");
    const errors = validateHdIdentityMap(map).errors;
    expect(errors).toContain("$.elements[0].render.runtimeModelCalls must be false");
    expect(errors).toContain("$.elements[0].allowedModernization contains forbidden dimension face-shape");
  });

  it("rejects invented copy without explicit product authorization", () => {
    const map = bunnyMap() as any;
    map.elements[0].kind = "text";
    map.elements[0].copy = {
      origin: "source-authored",
      sourceCopy: ["begin"],
      targetCopy: ["brand new slogan"],
      evidenceIds: ["player-source"],
    };
    expect(validateHdIdentityMap(map).errors).toContain(
      "$.elements[0].copy source-authored target copy must preserve the normalized source copy",
    );

    map.elements[0].copy = {
      origin: "supplemental-authorized",
      sourceCopy: [],
      targetCopy: ["brand new slogan"],
      evidenceIds: ["player-source"],
    };
    expect(validateHdIdentityMap(map).errors).toContain(
      "$.elements[0].copy supplemental copy requires product-authorization evidence",
    );
  });

  it("rejects incomplete or mixed-style accepted coverage", () => {
    const map = bunnyMap() as any;
    map.coverage.reachableElementIds.push("dust-bunny.wall");
    map.coverage.mixedIndexedFragments = 1;
    map.coverage.diagnosticReferenceSwitches = 1;
    const errors = validateHdIdentityMap(map).errors;
    expect(errors).toContain("$.coverage must map every reachable element before acceptance");
    expect(errors).toContain("$.coverage.mixedIndexedFragments must be zero before acceptance");
    expect(errors).toContain("$.coverage.diagnosticReferenceSwitches must be zero before acceptance");
  });

  it("rejects an accepted map with an unpassed identity review", () => {
    const map = bunnyMap() as any;
    map.elements[0].review.silhouettePassed = false;
    expect(validateHdIdentityMap(map).errors).toContain(
      "$.elements[0].review.silhouettePassed must pass before the map can be accepted",
    );
  });

  it("rejects review anchors that cannot be paired one-for-one", () => {
    const map = bunnyMap() as any;
    map.elements[0].review.sourceSceneIds.push("source-level-02");
    expect(validateHdIdentityMap(map).errors).toContain(
      "$.elements[0].review must declare one ordered target review anchor for every source review anchor",
    );
  });
});
