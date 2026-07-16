import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  HD_REVIEW_PACKET_SCHEMA_VERSION,
  HD_REVIEW_PRINCIPLE_GATES,
  validateHdReviewPacket,
} from "./hd-review-packet.js";

const hash = "a".repeat(64);
const review = {
  reviewer: "pending-human-side-by-side-review",
  silhouettePassed: false,
  requiredPartsPassed: false,
  proportionsPassed: false,
  contoursPassed: false,
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
  principleGates: HD_REVIEW_PRINCIPLE_GATES.map((gate) => ({ ...gate, verdict: "pending" })),
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
      contourChecks: [],
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

function markPrincipleGatesPassed(value: any): void {
  value.principleGates.forEach((gate: any) => { gate.verdict = "passed"; });
}

describe("HD identity review packet", () => {
  it("accepts a hash-bound pending source/HD review packet", () => {
    expect(validateHdReviewPacket(packet)).toEqual({ valid: true, errors: [] });
  });

  it("accepts initialization animation frames at exact host-tick boundaries", () => {
    const mutated: any = structuredClone(packet);
    mutated.screenshots = [
      {
        ...mutated.screenshots[0],
        id: "source-initialization",
        sceneId: "scene.initialization",
        stateBoundary: "host-initialization:tick:40:presentation-ms:0",
      },
      {
        ...mutated.screenshots[1],
        id: "hd-initialization",
        sceneId: "scene.initialization",
        stateBoundary: "host-initialization:tick:40:presentation-ms:0",
      },
    ];
    mutated.elements[0].sourceScreenshotIds = ["source-initialization"];
    mutated.elements[0].targetScreenshotIds = ["hd-initialization"];
    mutated.sceneComparisons[0] = {
      ...mutated.sceneComparisons[0],
      sceneId: "scene.initialization",
      sourceScreenshotId: "source-initialization",
      targetScreenshotId: "hd-initialization",
    };
    mutated.temporalComparisons[0] = {
      ...mutated.temporalComparisons[0],
      sceneId: "scene.initialization",
      frames: [{
        initializationHostTick: 40,
        presentationMilliseconds: 0,
        sourceScreenshotId: "source-initialization",
        targetScreenshotId: "hd-initialization",
        sameRuntimeState: true,
      }],
    };
    expect(validateHdReviewPacket(mutated)).toEqual({ valid: true, errors: [] });
  });

  it("rejects temporal frames with both or neither boundary coordinate", () => {
    const both: any = structuredClone(packet);
    both.temporalComparisons[0].frames[0].initializationHostTick = 3;
    expect(validateHdReviewPacket(both).errors.join("\n")).toMatch(/exactly one of update or initializationHostTick/);

    const neither: any = structuredClone(packet);
    delete neither.temporalComparisons[0].frames[0].update;
    expect(validateHdReviewPacket(neither).errors.join("\n")).toMatch(/exactly one of update or initializationHostTick/);
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
    markPrincipleGatesPassed(mutated);
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
    markPrincipleGatesPassed(mutated);
    mutated.elements[0]!.review.reviewer = "product-owner";
    for (const name of [
      "silhouettePassed", "requiredPartsPassed", "proportionsPassed", "contoursPassed", "expressionPassed",
      "colorHierarchyPassed", "motionPassed", "gameplayCuesPassed", "visualGrammarPassed",
    ] as const) mutated.elements[0]!.review[name] = true;
    expect(validateHdReviewPacket(mutated)).toEqual({ valid: true, errors: [] });
  });

  it("rejects accepted review fields without an immutable review decision", () => {
    const mutated = structuredClone(packet);
    mutated.status = "accepted";
    mutated.reviewer = "product-owner";
    markPrincipleGatesPassed(mutated);
    mutated.elements[0]!.review.reviewer = "product-owner";
    for (const name of [
      "silhouettePassed", "requiredPartsPassed", "proportionsPassed", "contoursPassed", "expressionPassed",
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

  it("rejects reordered multi-anchor evidence even when boundary sets match", () => {
    const mutated: any = structuredClone(packet);
    mutated.screenshots.push(
      { ...mutated.screenshots[0], id: "source-gameplay-later", stateBoundary: "canonical-replay:update:4:presentation-ms:0" },
      { ...mutated.screenshots[1], id: "hd-gameplay-later", stateBoundary: "canonical-replay:update:4:presentation-ms:0" },
    );
    mutated.elements[0].sourceScreenshotIds = ["source-gameplay", "source-gameplay-later"];
    mutated.elements[0].targetScreenshotIds = ["hd-gameplay-later", "hd-gameplay"];
    const result = validateHdReviewPacket(mutated);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/review anchor pair 0.*same state boundary and scene/);
  });

  it("rejects skipped, reordered, or prematurely passed principle gates", () => {
    const skipped: any = structuredClone(packet);
    skipped.principleGates.splice(1, 1);
    expect(validateHdReviewPacket(skipped).errors.join("\n")).toMatch(/exactly 3 ordered gates/);

    const reordered: any = structuredClone(packet);
    reordered.principleGates.reverse();
    expect(validateHdReviewPacket(reordered).errors.join("\n")).toMatch(/governed contract order/);

    const premature: any = structuredClone(packet);
    premature.principleGates[2].verdict = "passed";
    expect(validateHdReviewPacket(premature).errors.join("\n")).toMatch(/verdict must equal pending/);
  });

  it("keeps the JSON packet schema synchronized with executable principle gates", () => {
    const schema = JSON.parse(readFileSync(
      new URL("../../../specs/schemas/hd-review-packet-v1.schema.json", import.meta.url),
      "utf8",
    ));
    const definitions = ["spiritFidelityGate", "qualityLeapGate", "aestheticEvolutionGate"];
    const schemaGates = definitions.map((name) => {
      const properties = schema.$defs[name].allOf[1].properties;
      return {
        id: properties.id.const,
        order: properties.order.const,
        label: properties.label.const,
        dimensions: properties.dimensions.const,
      };
    });
    expect(schema.required).toContain("principleGates");
    expect(schemaGates).toEqual(HD_REVIEW_PRINCIPLE_GATES);
  });
});
