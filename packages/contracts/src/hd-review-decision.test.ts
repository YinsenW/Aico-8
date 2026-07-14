import { describe, expect, it } from "vitest";

import { HD_REVIEW_CHECK_NAMES } from "./hd-review-packet.js";
import {
  HD_REVIEW_DECISION_SCHEMA_VERSION,
  promoteHdIdentityMapFromReview,
  validateHdReviewDecision,
} from "./hd-review-decision.js";

const hash = "a".repeat(64);
const pendingReviewer = "pending-human-side-by-side-review";
const acceptanceStatement = "I reviewed every declared source-relative element in this build.";
const review = Object.fromEntries(HD_REVIEW_CHECK_NAMES.map((name) => [name, false]));

const reviewedPacket = {
  schemaVersion: "aico8.hd-review-packet.v1",
  gameId: "test-game",
  visualRuntimeSha256: hash,
  replaySemanticsSha256: hash,
  identityMapSha256: hash,
  browserEvidenceSha256: hash,
  status: "pending-human-side-by-side-review",
  reviewer: pendingReviewer,
  acceptanceStatement,
  reviewDecision: null,
  elements: [{
    id: "character.test",
    kind: "character",
    semanticRole: "source-relative test character",
    sourceScreenshotIds: ["source-gameplay"],
    targetScreenshotIds: ["hd-gameplay"],
    criteria: {
      silhouetteTraits: ["compact source silhouette"],
      requiredParts: ["paired source ears"],
      proportionChecks: ["footprint: 1 → 1, maximum delta 0.1"],
      compositionChecks: ["frame region: source [0.25,0.25,0.5,0.5] → HD [0.25,0.25,0.5,0.5], maximum edge delta 0.05"],
      faceAndExpressionTraits: ["friendly source expression"],
      colorHierarchy: ["warm white over dark"],
      motionCues: ["source-timed hop"],
      gameplayCues: ["cell occupancy remains legible"],
      forbiddenTransformations: ["removing a declared source part"],
      allowedModernization: ["material"],
    },
    review: { reviewer: pendingReviewer, ...review },
  }],
  sceneComparisons: [{
    id: "gameplay",
    sceneId: "scene.gameplay",
    sourceScreenshotId: "source-gameplay",
    targetScreenshotId: "hd-gameplay",
    sameRuntimeState: true,
  }],
  temporalComparisons: [{
    id: "character-motion",
    sceneId: "scene.gameplay",
    elementIds: ["character.test"],
    frames: [{
      update: 3,
      presentationMilliseconds: 0,
      sourceScreenshotId: "source-gameplay",
      targetScreenshotId: "hd-gameplay",
      sameRuntimeState: true,
    }],
  }],
  screenshots: [
    {
      id: "source-gameplay", path: "browser/source-gameplay.jpg", sha256: hash,
      width: 1280, height: 720, presentationMode: "reference", sceneId: "scene.gameplay",
      stateBoundary: "canonical-replay:update:3:presentation-ms:0", visualRuntimeSha256: hash,
    },
    {
      id: "hd-gameplay", path: "browser/hd-gameplay.jpg", sha256: hash,
      width: 1280, height: 720, presentationMode: "hd", sceneId: "scene.gameplay",
      stateBoundary: "canonical-replay:update:3:presentation-ms:0", visualRuntimeSha256: hash,
    },
  ],
  document: { path: "evidence/identity-review-packet.html", sha256: hash },
};

const decision = {
  schemaVersion: HD_REVIEW_DECISION_SCHEMA_VERSION,
  gameId: "test-game",
  decision: "accepted",
  reviewer: "product-owner",
  acceptanceStatement,
  reviewedPacket: {
    path: "evidence/reviews/packet/identity-review-packet.json",
    sha256: hash,
    documentPath: "evidence/reviews/packet/identity-review-packet.html",
    documentSha256: hash,
    visualRuntimeSha256: hash,
    replaySemanticsSha256: hash,
    identityMapSha256: hash,
    browserEvidenceSha256: hash,
  },
  elementIds: ["character.test"],
  checkNames: [...HD_REVIEW_CHECK_NAMES],
};

const identityMap = {
  schemaVersion: "aico8.hd-identity-map.v1",
  gameId: "test-game",
  cartSha256: hash,
  visualGrammarId: "test.visual-grammar.v1",
  canonicalReplayId: "test-replay",
  status: "draft",
  elements: [{
    id: "character.test",
    kind: "character",
    semanticRole: "source-relative test character",
    evidence: [{ id: "character.test.source", kind: "source-sprite", sourceRef: "sprite 1", sha256: hash }],
    copy: { origin: "none", sourceCopy: [], targetCopy: [], evidenceIds: [] },
    anchors: {
      silhouetteTraits: ["compact source silhouette"],
      requiredParts: [{
        id: "head", label: "head", sourceEvidenceIds: ["character.test.source"], targetRegionIds: ["head"],
        recognitionCues: ["source-relative head silhouette"],
        forbiddenSubstitutions: ["unrelated substitute silhouette"],
      }],
      proportionChecks: [{ id: "footprint", label: "footprint", sourceRatio: 1, targetRatio: 1, maximumAbsoluteDelta: 0.1 }],
      compositionChecks: [{
        id: "frame-region", label: "frame region", sourceEvidenceIds: ["character.test.source"], targetRegionIds: ["head"],
        sourceBounds: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
        targetBounds: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, maximumEdgeDelta: 0.05,
      }],
      faceAndExpressionTraits: ["friendly source expression"],
      colorHierarchy: ["warm white over dark"],
      motionCues: ["source-timed hop"],
      gameplayCues: ["cell occupancy remains legible"],
      forbiddenTransformations: ["removing a declared source part"],
    },
    allowedModernization: ["material"],
    render: { assetSha256: hash, recipeId: "character.test.vector.v1", targetRegionIds: ["head"], runtimeModelCalls: false },
    review: {
      reviewer: pendingReviewer,
      sourceSceneIds: ["source-gameplay"],
      targetSceneIds: ["hd-gameplay"],
      ...review,
    },
  }],
  coverage: {
    reachableElementIds: ["character.test"], mappedElementIds: ["character.test"],
    mixedIndexedFragments: 0, diagnosticReferenceSwitches: 0,
  },
};

describe("HD human review decision", () => {
  it("accepts an atomic decision bound to the pending packet", () => {
    expect(validateHdReviewDecision(decision, reviewedPacket)).toEqual({ valid: true, errors: [] });
  });

  it("rejects a decision for a different visual runtime or acceptance statement", () => {
    const mutated = structuredClone(decision);
    mutated.reviewedPacket.visualRuntimeSha256 = "b".repeat(64);
    mutated.acceptanceStatement = "I did not review this build.";
    const result = validateHdReviewDecision(mutated, reviewedPacket);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/visual runtime|acceptance statement/);
  });

  it("rejects partial pre-approval or an incomplete check set", () => {
    const mutatedPacket: any = structuredClone(reviewedPacket);
    mutatedPacket.elements[0]!.review.motionPassed = true;
    const mutatedDecision: any = structuredClone(decision);
    mutatedDecision.checkNames.pop();
    const result = validateHdReviewDecision(mutatedDecision, mutatedPacket);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/every review check|must remain false/);
  });

  it("promotes every review field together and preserves all non-review identity data", () => {
    const accepted = promoteHdIdentityMapFromReview({
      draftIdentityMap: identityMap,
      draftIdentityMapSha256: hash,
      decision,
      reviewedPacket,
    });
    expect(accepted.status).toBe("accepted");
    expect(accepted.elements[0]!.review.reviewer).toBe("product-owner");
    expect(HD_REVIEW_CHECK_NAMES.every((name) => accepted.elements[0]!.review[name] === true)).toBe(true);
    expect({ ...accepted, status: "draft", elements: identityMap.elements }).toEqual(identityMap);
  });

  it("cannot promote a rebuilt draft whose hash differs from the reviewed packet", () => {
    expect(() => promoteHdIdentityMapFromReview({
      draftIdentityMap: identityMap,
      draftIdentityMapSha256: "b".repeat(64),
      decision,
      reviewedPacket,
    })).toThrow(/draft identity map hash/);
  });
});
