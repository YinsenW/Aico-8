import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  HD_EVIDENCE_ARTIFACT_CLASSES,
  HD_EVIDENCE_LIFECYCLE_SCHEMA_VERSION,
  HD_EVIDENCE_LIFECYCLE_STATES,
  validateHdEvidenceLifecycle,
} from "./hd-evidence-lifecycle.js";

const hash = "a".repeat(64);
const initialGates = () => [
  { id: "spirit-fidelity", order: 1, verdict: "pending" },
  { id: "quality-leap", order: 2, verdict: "blocked-by-prior-gate" },
  { id: "aesthetic-evolution", order: 3, verdict: "blocked-by-prior-gate" },
];
const draft = (mapped = 27, unmapped = 1) => ({
  sourceVisualInventorySha256: hash,
  identityMapSha256: hash,
  assetDraftSha256: hash,
  reachableElementCount: 28,
  mappedElementCount: mapped,
  unmappedElementCount: unmapped,
});
const safety = (status: "verified" | "blocked-unverified" = "verified") => ({
  glyphEvidence: { status, sha256: status === "verified" ? hash : null },
  mixedIndexedFragments: 0,
  indexedPixelFallback: false,
  runtimeModelCalls: false,
});
const runtime = () => ({ visualRuntimeSha256: hash, replaySemanticsSha256: hash, identityMapSha256: hash });
const capture = () => ({ capturedArtifactSha256: hash, screenshotSetSha256: hash, sameStateSourceHdPairs: 3 });
const browser = () => ({
  browserEvidenceSha256: hash,
  environmentSha256: hash,
  readiness: {
    status: "ready",
    overlayExcluded: true,
    consecutivePresentedFrames: 2,
    modeSceneBoundaryViewportBound: true,
  },
});

const offlineDraft = (): any => ({
  schemaVersion: HD_EVIDENCE_LIFECYCLE_SCHEMA_VERSION,
  gameId: "steps-private-research",
  artifactClass: "offline-hd-draft",
  lifecycleState: "offline-hd-draft",
  orderedGates: initialGates(),
  draft: draft(),
  safety: safety("blocked-unverified"),
  runtime: null,
  capture: null,
  browser: null,
  humanReview: null,
});

const packagedCapture = (): any => ({
  ...offlineDraft(),
  artifactClass: "packaged-capture",
  lifecycleState: "pending-human-review",
  draft: draft(28, 0),
  safety: safety(),
  runtime: runtime(),
  capture: capture(),
  browser: browser(),
});

const humanPacket = (): any => ({
  ...packagedCapture(),
  artifactClass: "human-review-packet",
  humanReview: {
    reviewPacket: {
      path: "evidence/reviews/packet.json",
      sha256: hash,
      status: "pending-human-side-by-side-review",
    },
  },
});

describe("HD evidence lifecycle", () => {
  it("accepts each fail-closed stage while leaving acceptance to hd-review-decision.v1", () => {
    const readyDraft = offlineDraft();
    readyDraft.lifecycleState = "pending-packaged-capture";
    readyDraft.draft = draft(28, 0);
    readyDraft.safety = safety();
    for (const value of [offlineDraft(), readyDraft, packagedCapture(), humanPacket()]) {
      expect(validateHdEvidenceLifecycle(value)).toEqual({ valid: true, errors: [] });
    }
  });

  it("rejects offline runtime claims", () => {
    const value = offlineDraft();
    value.runtime = runtime();
    expect(validateHdEvidenceLifecycle(value).errors.join("\n")).toMatch(/Offline HD drafts cannot carry runtime/);
  });

  it("rejects offline capture and browser claims", () => {
    const value = offlineDraft();
    value.capture = capture();
    value.browser = browser();
    expect(validateHdEvidenceLifecycle(value).errors.join("\n")).toMatch(/capture, browser/);
  });

  it("rejects offline human claims", () => {
    const value = offlineDraft();
    value.humanReview = humanPacket().humanReview;
    expect(validateHdEvidenceLifecycle(value).errors.join("\n")).toMatch(/human claims/);
  });

  it("rejects packaged capture without complete hashes and readiness", () => {
    const value = packagedCapture();
    value.runtime.visualRuntimeSha256 = "not-a-hash";
    value.capture.sameStateSourceHdPairs = 0;
    value.browser.readiness.overlayExcluded = false;
    value.browser.readiness.consecutivePresentedFrames = 1;
    expect(validateHdEvidenceLifecycle(value).errors.join("\n")).toMatch(/SHA-256|positive integer|overlayExcluded|at least 2/);
  });

  it("rejects inline or embedded human decisions", () => {
    const value = humanPacket();
    value.humanReview.decision = {
      schemaVersion: "aico8.hd-review-decision.v1",
      decision: "accepted",
    };
    expect(validateHdEvidenceLifecycle(value).errors.join("\n")).toMatch(/decision is not allowed/);

    const accepted = humanPacket();
    accepted.orderedGates = [
      { id: "spirit-fidelity", order: 1, verdict: "passed" },
      { id: "quality-leap", order: 2, verdict: "passed" },
      { id: "aesthetic-evolution", order: 3, verdict: "passed" },
    ];
    expect(validateHdEvidenceLifecycle(accepted).errors.join("\n")).toMatch(/hd-review-decision\.v1/);
  });

  it("rejects reordered, skipped, compensating, or premature gates", () => {
    const reordered = humanPacket();
    reordered.orderedGates.reverse();
    expect(validateHdEvidenceLifecycle(reordered).errors.join("\n")).toMatch(/must equal/);

    const skipped = humanPacket();
    skipped.orderedGates[1].verdict = "passed";
    expect(validateHdEvidenceLifecycle(skipped).errors.join("\n")).toMatch(/until Spirit fidelity passes/);

    const compensated = humanPacket();
    compensated.orderedGates[2].verdict = "passed";
    expect(validateHdEvidenceLifecycle(compensated).errors.join("\n")).toMatch(/until Quality leap passes/);

    const partial = humanPacket();
    partial.orderedGates[0].verdict = "passed";
    partial.orderedGates[1].verdict = "pending";
    expect(validateHdEvidenceLifecycle(partial).errors.join("\n")).toMatch(/cannot carry human gate verdicts/);

    const premature = packagedCapture();
    premature.orderedGates[0].verdict = "passed";
    premature.orderedGates[1].verdict = "pending";
    expect(validateHdEvidenceLifecycle(premature).errors.join("\n")).toMatch(/cannot carry human gate verdicts/);
  });

  it("rejects lifecycle promotion with unverified glyph evidence", () => {
    const value = packagedCapture();
    value.safety = safety("blocked-unverified");
    expect(validateHdEvidenceLifecycle(value).errors.join("\n")).toMatch(/Unverified glyph evidence blocks/);
  });

  it("rejects unbound drafts, false inventory arithmetic, and incomplete promotion", () => {
    const unbound = offlineDraft();
    delete unbound.draft;
    expect(validateHdEvidenceLifecycle(unbound).errors.join("\n")).toMatch(/draft is required|draft must be an object/);

    const falseCounts = offlineDraft();
    falseCounts.draft.mappedElementCount = 26;
    expect(validateHdEvidenceLifecycle(falseCounts).errors.join("\n")).toMatch(/must equal mappedElementCount/);

    const incomplete = packagedCapture();
    incomplete.draft = draft();
    expect(validateHdEvidenceLifecycle(incomplete).errors.join("\n")).toMatch(/complete mapped presentation/);
  });

  it("rejects mixed indexed or pixel-fallback presentation", () => {
    const value = offlineDraft();
    value.safety.mixedIndexedFragments = 1;
    value.safety.indexedPixelFallback = true;
    expect(validateHdEvidenceLifecycle(value).errors.join("\n")).toMatch(/mixedIndexedFragments|indexedPixelFallback/);
  });

  it("rejects runtime model generation", () => {
    const value = offlineDraft();
    value.safety.runtimeModelCalls = true;
    expect(validateHdEvidenceLifecycle(value).errors.join("\n")).toMatch(/runtimeModelCalls/);
  });

  it("keeps the JSON Schema synchronized with lifecycle classes, states, and gate order", () => {
    const schema = JSON.parse(readFileSync(
      new URL("../../../specs/schemas/hd-evidence-lifecycle-v1.schema.json", import.meta.url),
      "utf8",
    ));
    expect(schema.properties.schemaVersion.const).toBe(HD_EVIDENCE_LIFECYCLE_SCHEMA_VERSION);
    expect(schema.properties.artifactClass.enum).toEqual(HD_EVIDENCE_ARTIFACT_CLASSES);
    expect(schema.properties.lifecycleState.enum).toEqual(HD_EVIDENCE_LIFECYCLE_STATES);
    expect(schema.$defs.orderedGates.prefixItems.map((item: any) => item.properties.id.const)).toEqual([
      "spirit-fidelity", "quality-leap", "aesthetic-evolution",
    ]);
  });
});
