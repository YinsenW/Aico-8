import { describe, expect, it } from "vitest";

import {
  HD_REVIEW_PACKET_SCHEMA_VERSION,
  validateHdReviewPacket,
} from "./hd-review-packet.js";

const hash = "a".repeat(64);
const review = {
  reviewer: "pending-human-side-by-side-review",
  silhouettePassed: false,
  requiredPartsPassed: false,
  proportionsPassed: false,
  expressionPassed: false,
  colorHierarchyPassed: false,
  motionPassed: false,
  gameplayCuesPassed: false,
  visualGrammarPassed: false,
};

const packet = {
  schemaVersion: HD_REVIEW_PACKET_SCHEMA_VERSION,
  gameId: "dust-bunny-private-research",
  visualRuntimeSha256: hash,
  replaySemanticsSha256: hash,
  identityMapSha256: hash,
  browserEvidenceSha256: hash,
  status: "pending-human-side-by-side-review",
  reviewer: "pending-human-side-by-side-review",
  acceptanceStatement: "I reviewed every declared source-relative element in this build.",
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
      faceAndExpressionTraits: ["friendly source expression"],
      colorHierarchy: ["warm white over dark"],
      motionCues: ["source-timed hop"],
      gameplayCues: ["cell occupancy remains legible"],
      forbiddenTransformations: ["removing a declared source part"],
      allowedModernization: ["material"],
    },
    review,
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
      id: "source-gameplay",
      path: "browser/source-gameplay.jpg",
      sha256: hash,
      width: 1280,
      height: 720,
      presentationMode: "reference",
      sceneId: "scene.gameplay",
      stateBoundary: "canonical-replay:update:3:presentation-ms:0",
      visualRuntimeSha256: hash,
    },
    {
      id: "hd-gameplay",
      path: "browser/hd-gameplay.jpg",
      sha256: hash,
      width: 1280,
      height: 720,
      presentationMode: "hd",
      sceneId: "scene.gameplay",
      stateBoundary: "canonical-replay:update:3:presentation-ms:0",
      visualRuntimeSha256: hash,
    },
  ],
  document: { path: "evidence/identity-review-packet.html", sha256: hash },
};

describe("HD identity review packet", () => {
  it("accepts a hash-bound pending source/HD review packet", () => {
    expect(validateHdReviewPacket(packet)).toEqual({ valid: true, errors: [] });
  });

  it("rejects cross-state or wrong-mode source/HD pairs", () => {
    const mutated: any = structuredClone(packet);
    mutated.screenshots[1]!.stateBoundary = "canonical-replay:update:4:presentation-ms:0";
    mutated.screenshots[1]!.presentationMode = "reference";
    const result = validateHdReviewPacket(mutated);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/same state boundary|target.*HD/);
  });

  it("cannot mark a packet accepted while any element review remains false", () => {
    const mutated: any = structuredClone(packet);
    mutated.status = "accepted";
    mutated.reviewer = "product-owner";
    mutated.reviewDecision = { path: "evidence/identity-review-decision.json", sha256: hash };
    mutated.elements[0]!.review.reviewer = "product-owner";
    const result = validateHdReviewPacket(mutated);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/must pass before.*accepted/);
  });

  it("accepts the same evidence only after every human review check passes", () => {
    const mutated: any = structuredClone(packet);
    mutated.status = "accepted";
    mutated.reviewer = "product-owner";
    mutated.reviewDecision = { path: "evidence/identity-review-decision.json", sha256: hash };
    mutated.elements[0]!.review.reviewer = "product-owner";
    for (const name of [
      "silhouettePassed", "requiredPartsPassed", "proportionsPassed", "expressionPassed",
      "colorHierarchyPassed", "motionPassed", "gameplayCuesPassed", "visualGrammarPassed",
    ] as const) mutated.elements[0]!.review[name] = true;
    expect(validateHdReviewPacket(mutated)).toEqual({ valid: true, errors: [] });
  });

  it("rejects accepted review fields without an immutable review decision", () => {
    const mutated = structuredClone(packet);
    mutated.status = "accepted";
    mutated.reviewer = "product-owner";
    mutated.elements[0]!.review.reviewer = "product-owner";
    for (const name of [
      "silhouettePassed", "requiredPartsPassed", "proportionsPassed", "expressionPassed",
      "colorHierarchyPassed", "motionPassed", "gameplayCuesPassed", "visualGrammarPassed",
    ] as const) mutated.elements[0]!.review[name] = true;
    const result = validateHdReviewPacket(mutated);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/reviewDecision.*required/);
  });

  it("rejects unknown element or screenshot references", () => {
    const mutated = structuredClone(packet);
    mutated.temporalComparisons[0]!.elementIds = ["character.missing"];
    mutated.elements[0]!.targetScreenshotIds = ["hd-missing"];
    const result = validateHdReviewPacket(mutated);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/unknown element|unknown screenshot/);
  });

  it("rejects whitespace-only labels and ambiguous relative paths", () => {
    const mutated = structuredClone(packet);
    mutated.elements[0]!.semanticRole = "   ";
    mutated.document.path = "evidence//identity-review-packet.html";
    const result = validateHdReviewPacket(mutated);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/non-empty string|safe relative path/);
  });
});
