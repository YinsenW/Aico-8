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
          { id: "face", label: "round face", sourceEvidenceIds: ["player-source"], targetRegionIds: ["face"] },
          { id: "ears", label: "paired ears", sourceEvidenceIds: ["player-source"], targetRegionIds: ["left-ear", "right-ear"] },
          { id: "whiskers", label: "visible whiskers", sourceEvidenceIds: ["player-source"], targetRegionIds: ["whiskers"] },
        ],
        proportionChecks: [{ id: "face-ratio", label: "face width / face height", sourceRatio: 1.05, targetRatio: 1.08, maximumAbsoluteDelta: 0.1 }],
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

  it("accepts a long face when the source identity is also long-faced", () => {
    const map = bunnyMap() as any;
    map.elements[0].semanticRole = "recognizably long-faced source character";
    map.elements[0].anchors.silhouetteTraits = ["long narrow face", "source-specific head crest"];
    map.elements[0].anchors.requiredParts = [
      { id: "face", label: "long narrow face", sourceEvidenceIds: ["player-source"], targetRegionIds: ["face"] },
      { id: "crest", label: "head crest", sourceEvidenceIds: ["player-source"], targetRegionIds: ["left-ear"] },
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
});
