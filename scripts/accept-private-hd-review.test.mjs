import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const acceptScript = path.join(repository, "scripts/accept-private-hd-review.ts");
const reviewPacketBuilder = path.join(repository, "scripts/build-private-hd-review-packet.mjs");
const statement = "我已按顺序完成 Dust Bunny 当前构建的三重审查：神似还原、画质跃升、审美进化；确认前一项通过后才审查后一项，并同意全部 1 个源相对元素的身份、完整性、动画与视觉语法检查。";
const pendingReviewer = "pending-human-side-by-side-review";
const checkNames = [
  "silhouettePassed", "requiredPartsPassed", "proportionsPassed", "contoursPassed", "expressionPassed",
  "colorHierarchyPassed", "motionPassed", "gameplayCuesPassed", "visualGrammarPassed",
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function write(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

function makeWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "aico8-review-decision-test-"));
  const sourceBytes = Buffer.from("source screenshot bytes");
  const targetBytes = Buffer.from("target screenshot bytes");
  write(path.join(workspace, "evidence/source.jpg"), sourceBytes);
  write(path.join(workspace, "evidence/target.jpg"), targetBytes);
  const visualRuntimeSha256 = "a".repeat(64);
  const review = Object.fromEntries(checkNames.map((name) => [name, false]));
  const identityMap = {
    schemaVersion: "aico8.hd-identity-map.v1",
    gameId: "test-game",
    cartSha256: "c".repeat(64),
    visualGrammarId: "test.visual-grammar.v1",
    canonicalReplayId: "test-replay",
    status: "draft",
    elements: [{
      id: "character.test",
      kind: "character",
      semanticRole: "source-relative test character",
      evidence: [{ id: "character.test.source", kind: "source-sprite", sourceRef: "sprite 1", sha256: "d".repeat(64) }],
      copy: { origin: "none", sourceCopy: [], targetCopy: [], evidenceIds: [] },
      anchors: {
        silhouetteTraits: ["compact source silhouette"],
        requiredParts: [{
          id: "head", label: "paired source ears", sourceEvidenceIds: ["character.test.source"], targetRegionIds: ["head"],
          recognitionCues: ["two separately readable source-relative ears"],
          forbiddenSubstitutions: ["ears merged into unrelated head bumps"],
        }],
        proportionChecks: [{
          id: "footprint", label: "footprint stays one cell", sourceRatio: 1, targetRatio: 1, maximumAbsoluteDelta: 0.1,
        }],
        compositionChecks: [{
          id: "frame-region", label: "frame region", sourceEvidenceIds: ["character.test.source"], targetRegionIds: ["head"],
          sourceBounds: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
          targetBounds: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, maximumEdgeDelta: 0.05,
        }],
        contourChecks: [],
        faceAndExpressionTraits: [],
        colorHierarchy: ["warm white over dark"],
        motionCues: ["source-timed hop"],
        gameplayCues: ["cell occupancy remains legible"],
        forbiddenTransformations: ["removing a declared source part"],
      },
      allowedModernization: ["material"],
      render: {
        assetSha256: "e".repeat(64), recipeId: "character.test.vector.v1",
        targetRegionIds: ["head"], runtimeModelCalls: false,
      },
      review: {
        reviewer: pendingReviewer, sourceSceneIds: ["source-gameplay"],
        targetSceneIds: ["hd-gameplay"], ...review,
      },
    }],
    coverage: {
      reachableElementIds: ["character.test"], mappedElementIds: ["character.test"],
      mixedIndexedFragments: 0, diagnosticReferenceSwitches: 0,
    },
  };
  const browserEvidence = {
    subject: "Dust Bunny private test build",
    build: { visualRuntimeSha256 },
    validationReplay: { replayId: "test-replay", semanticsSha256: "b".repeat(64) },
    identityReview: {
      status: "pending-human-side-by-side-review", reviewer: pendingReviewer,
      scenePairsComplete: true, temporalComparisonsComplete: true, accepted: false,
    },
    sceneComparisons: [{
      id: "gameplay", sceneId: "scene.gameplay", sourceScreenshotId: "source-gameplay",
      targetScreenshotId: "hd-gameplay", sameRuntimeState: true,
    }],
    temporalComparisons: [{
      id: "character-motion", sceneId: "scene.gameplay", elementIds: ["character.test"],
      frames: [{
        update: 3, presentationMilliseconds: 0, sourceScreenshotId: "source-gameplay",
        targetScreenshotId: "hd-gameplay", sameRuntimeState: true,
      }],
    }],
    screenshots: [
      {
        id: "source-gameplay", path: "evidence/source.jpg", sha256: sha256(sourceBytes),
        width: 1280, height: 720, presentationMode: "reference", sceneId: "scene.gameplay",
        stateBoundary: "canonical-replay:update:3:presentation-ms:0", visualRuntimeSha256,
      },
      {
        id: "hd-gameplay", path: "evidence/target.jpg", sha256: sha256(targetBytes),
        width: 1280, height: 720, presentationMode: "hd", sceneId: "scene.gameplay",
        stateBoundary: "canonical-replay:update:3:presentation-ms:0", visualRuntimeSha256,
      },
    ],
  };
  write(path.join(workspace, "validation/hd-identity-map.json"),
    Buffer.from(`${JSON.stringify(identityMap, null, 2)}\n`));
  write(path.join(workspace, "evidence/browser-validation.json"),
    Buffer.from(`${JSON.stringify(browserEvidence, null, 2)}\n`));
  const generation = spawnSync(process.execPath, [
    reviewPacketBuilder, "--workspace", workspace, "--write", "true",
  ], { cwd: repository, encoding: "utf8" });
  assert.equal(generation.status, 0, generation.stderr);
  const reviewDocument = fs.readFileSync(path.join(workspace, "evidence/identity-review-packet.html"), "utf8");
  assert.match(reviewDocument, new RegExp(`source\\.jpg\\?sha256=${sha256(sourceBytes)}`));
  assert.match(reviewDocument, new RegExp(`target\\.jpg\\?sha256=${sha256(targetBytes)}`));
  return workspace;
}

function accept(workspace, overrides = {}) {
  return spawnSync(process.execPath, [
    "--experimental-strip-types", acceptScript,
    "--workspace", workspace,
    "--reviewer", overrides.reviewer ?? "product-owner",
    "--statement", overrides.statement ?? statement,
    "--write", overrides.write ?? "true",
  ], { cwd: repository, encoding: "utf8" });
}

test("acceptance mutation requires explicit write and exact statement", () => {
  const workspace = makeWorkspace();
  try {
    const dryMutation = accept(workspace, { write: "false" });
    assert.notEqual(dryMutation.status, 0);
    assert.equal(fs.existsSync(path.join(workspace, "evidence/identity-review-decision.json")), false);
    const wrongStatement = accept(workspace, { statement: "I reviewed a different build." });
    assert.notEqual(wrongStatement.status, 0);
    assert.equal(fs.existsSync(path.join(workspace, "evidence/identity-review-decision.json")), false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("acceptance archives exact evidence and is idempotent", () => {
  const workspace = makeWorkspace();
  try {
    const first = accept(workspace);
    assert.equal(first.status, 0, first.stderr);
    const decisionPath = path.join(workspace, "evidence/identity-review-decision.json");
    const firstDecisionBytes = fs.readFileSync(decisionPath);
    const decision = JSON.parse(firstDecisionBytes.toString("utf8"));
    assert.equal(decision.decision, "accepted");
    assert.equal(decision.reviewer, "product-owner");
    assert.equal(decision.acceptanceStatement, statement);
    assert.deepEqual(decision.principleGates, [
      { id: "spirit-fidelity", verdict: "passed" },
      { id: "quality-leap", verdict: "passed" },
      { id: "aesthetic-evolution", verdict: "passed" },
    ]);
    assert.equal(sha256(fs.readFileSync(path.join(workspace, decision.reviewedPacket.path))),
      decision.reviewedPacket.sha256);
    assert.equal(sha256(fs.readFileSync(path.join(workspace, decision.reviewedPacket.documentPath))),
      decision.reviewedPacket.documentSha256);
    const second = accept(workspace);
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(fs.readFileSync(decisionPath), firstDecisionBytes);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("acceptance rejects evidence changed after packet generation", () => {
  const workspace = makeWorkspace();
  try {
    fs.appendFileSync(path.join(workspace, "evidence/browser-validation.json"), "tamper");
    const result = accept(workspace);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /stale|Browser evidence changed|Command failed/);
    assert.equal(fs.existsSync(path.join(workspace, "evidence/identity-review-decision.json")), false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("acceptance rejects a review document whose screenshot cache key was removed", () => {
  const workspace = makeWorkspace();
  try {
    const documentPath = path.join(workspace, "evidence/identity-review-packet.html");
    const document = fs.readFileSync(documentPath, "utf8");
    fs.writeFileSync(documentPath, document.replaceAll(/\?sha256=[0-9a-f]{64}/g, ""));
    const result = accept(workspace);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /stale|Command failed/);
    assert.equal(fs.existsSync(path.join(workspace, "evidence/identity-review-decision.json")), false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("acceptance never overwrites a conflicting content-addressed archive", () => {
  const workspace = makeWorkspace();
  try {
    const packetBytes = fs.readFileSync(path.join(workspace, "evidence/identity-review-packet.json"));
    const archiveDirectory = path.join(workspace, "evidence/reviews", sha256(packetBytes));
    write(path.join(archiveDirectory, "identity-review-packet.json"), Buffer.from("conflicting bytes"));
    const result = accept(workspace);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /different immutable review packet archive/);
    assert.equal(fs.existsSync(path.join(workspace, "evidence/identity-review-decision.json")), false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
