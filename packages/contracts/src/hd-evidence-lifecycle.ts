import { HD_REVIEW_PRINCIPLE_GATES, PENDING_HD_REVIEWER } from "./hd-review-packet.ts";

export const HD_EVIDENCE_LIFECYCLE_SCHEMA_VERSION = "aico8.hd-evidence-lifecycle.v1" as const;

export const HD_EVIDENCE_ARTIFACT_CLASSES = [
  "offline-hd-draft",
  "packaged-capture",
  "human-review-packet",
] as const;

export const HD_EVIDENCE_LIFECYCLE_STATES = [
  "offline-hd-draft",
  "pending-packaged-capture",
  "pending-human-review",
] as const;

export type HdEvidenceArtifactClass = (typeof HD_EVIDENCE_ARTIFACT_CLASSES)[number];
export type HdEvidenceLifecycleState = (typeof HD_EVIDENCE_LIFECYCLE_STATES)[number];
export type HdEvidenceGateVerdict = "blocked-by-prior-gate" | "pending" | "passed";

export interface HdEvidenceGateState {
  readonly id: (typeof HD_REVIEW_PRINCIPLE_GATES)[number]["id"];
  readonly order: 1 | 2 | 3;
  readonly verdict: HdEvidenceGateVerdict;
}

export interface HdEvidenceLifecycleV1 {
  readonly schemaVersion: typeof HD_EVIDENCE_LIFECYCLE_SCHEMA_VERSION;
  readonly gameId: string;
  readonly artifactClass: HdEvidenceArtifactClass;
  readonly lifecycleState: HdEvidenceLifecycleState;
  readonly orderedGates: readonly HdEvidenceGateState[];
  readonly draft: {
    readonly sourceVisualInventorySha256: string;
    readonly identityMapSha256: string;
    readonly assetDraftSha256: string;
    readonly reachableElementCount: number;
    readonly mappedElementCount: number;
    readonly unmappedElementCount: number;
  };
  readonly safety: {
    readonly glyphEvidence: {
      readonly status: "verified" | "blocked-unverified";
      readonly sha256: string | null;
    };
    readonly mixedIndexedFragments: 0;
    readonly indexedPixelFallback: false;
    readonly runtimeModelCalls: false;
  };
  readonly runtime: {
    readonly visualRuntimeSha256: string;
    readonly replaySemanticsSha256: string;
    readonly identityMapSha256: string;
  } | null;
  readonly capture: {
    readonly capturedArtifactSha256: string;
    readonly screenshotSetSha256: string;
    readonly sameStateSourceHdPairs: number;
  } | null;
  readonly browser: {
    readonly browserEvidenceSha256: string;
    readonly environmentSha256: string;
    readonly readiness: {
      readonly status: "ready";
      readonly overlayExcluded: true;
      readonly consecutivePresentedFrames: number;
      readonly modeSceneBoundaryViewportBound: true;
    };
  } | null;
  readonly humanReview: {
    readonly reviewPacket: {
      readonly path: string;
      readonly sha256: string;
      readonly status: typeof PENDING_HD_REVIEWER;
    };
  } | null;
}

export interface HdEvidenceLifecycleValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

type JsonRecord = Record<string, unknown>;
const hashPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-z0-9][a-z0-9._-]{1,127}$/;

function record(value: unknown, path: string, errors: string[]): JsonRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, keys: readonly string[], path: string, errors: string[]): void {
  const expected = new Set(keys);
  for (const key of keys) if (!(key in value)) errors.push(`${path}.${key} is required`);
  for (const key of Object.keys(value)) if (!expected.has(key)) errors.push(`${path}.${key} is not allowed`);
}

function idValue(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    errors.push(`${path} must be a valid ID`);
    return false;
  }
  return true;
}

function hashValue(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value !== "string" || !hashPattern.test(value)) {
    errors.push(`${path} must be a lowercase SHA-256 digest`);
    return false;
  }
  return true;
}

function safeRelativePath(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty path`);
    return false;
  }
  const segments = value.split("/");
  if (value.startsWith("/") || value.includes("\\")
    || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    errors.push(`${path} must be a safe relative path`);
    return false;
  }
  return true;
}

function hashObject(value: unknown, keys: readonly string[], path: string, errors: string[]): JsonRecord | undefined {
  const object = record(value, path, errors);
  if (!object) return undefined;
  exactKeys(object, keys, path, errors);
  for (const key of keys) hashValue(object[key], `${path}.${key}`, errors);
  return object;
}

function validateOrderedGates(value: unknown, errors: string[]): HdEvidenceGateVerdict[] {
  if (!Array.isArray(value) || value.length !== HD_REVIEW_PRINCIPLE_GATES.length) {
    errors.push("$.orderedGates must contain exactly 3 gates in contract order");
    return [];
  }
  const verdicts: HdEvidenceGateVerdict[] = [];
  HD_REVIEW_PRINCIPLE_GATES.forEach((expected, index) => {
    const path = `$.orderedGates[${index}]`;
    const gate = record(value[index], path, errors);
    if (!gate) return;
    exactKeys(gate, ["id", "order", "verdict"], path, errors);
    if (gate.id !== expected.id) errors.push(`${path}.id must equal ${expected.id}`);
    if (gate.order !== expected.order) errors.push(`${path}.order must equal ${expected.order}`);
    if (!["blocked-by-prior-gate", "pending", "passed"].includes(gate.verdict as string)) {
      errors.push(`${path}.verdict is not supported`);
      return;
    }
    verdicts.push(gate.verdict as HdEvidenceGateVerdict);
  });
  if (verdicts.length !== 3) return verdicts;
  if (verdicts[0] === "blocked-by-prior-gate") errors.push("Spirit fidelity cannot be blocked by a prior gate");
  if (verdicts[0] !== "passed" && verdicts[1] !== "blocked-by-prior-gate") {
    errors.push("Quality leap must remain blocked until Spirit fidelity passes");
  }
  if (verdicts[1] !== "passed" && verdicts[2] !== "blocked-by-prior-gate") {
    errors.push("Aesthetic evolution must remain blocked until Quality leap passes");
  }
  if (verdicts.join(",") !== "pending,blocked-by-prior-gate,blocked-by-prior-gate") {
    errors.push("Lifecycle evidence cannot carry human gate verdicts; use hd-review-decision.v1 for acceptance");
  }
  return verdicts;
}

function validateDraft(value: unknown, errors: string[]): {
  reachable: number;
  mapped: number;
  unmapped: number;
} | undefined {
  const draft = record(value, "$.draft", errors);
  if (!draft) return undefined;
  exactKeys(draft, [
    "sourceVisualInventorySha256", "identityMapSha256", "assetDraftSha256",
    "reachableElementCount", "mappedElementCount", "unmappedElementCount",
  ], "$.draft", errors);
  for (const key of ["sourceVisualInventorySha256", "identityMapSha256", "assetDraftSha256"] as const) {
    hashValue(draft[key], `$.draft.${key}`, errors);
  }
  const reachable = draft.reachableElementCount;
  const mapped = draft.mappedElementCount;
  const unmapped = draft.unmappedElementCount;
  if (!Number.isSafeInteger(reachable) || (reachable as number) < 1) {
    errors.push("$.draft.reachableElementCount must be a positive integer");
  }
  if (!Number.isSafeInteger(mapped) || (mapped as number) < 0) {
    errors.push("$.draft.mappedElementCount must be a non-negative integer");
  }
  if (!Number.isSafeInteger(unmapped) || (unmapped as number) < 0) {
    errors.push("$.draft.unmappedElementCount must be a non-negative integer");
  }
  if (Number.isSafeInteger(reachable) && Number.isSafeInteger(mapped) && Number.isSafeInteger(unmapped)
    && reachable !== (mapped as number) + (unmapped as number)) {
    errors.push("$.draft reachableElementCount must equal mappedElementCount + unmappedElementCount");
  }
  return { reachable: reachable as number, mapped: mapped as number, unmapped: unmapped as number };
}

function validateSafety(value: unknown, errors: string[]): "verified" | "blocked-unverified" | undefined {
  const safety = record(value, "$.safety", errors);
  if (!safety) return undefined;
  exactKeys(safety, ["glyphEvidence", "mixedIndexedFragments", "indexedPixelFallback", "runtimeModelCalls"], "$.safety", errors);
  const glyph = record(safety.glyphEvidence, "$.safety.glyphEvidence", errors);
  let status: "verified" | "blocked-unverified" | undefined;
  if (glyph) {
    exactKeys(glyph, ["status", "sha256"], "$.safety.glyphEvidence", errors);
    if (glyph.status === "verified") {
      status = "verified";
      hashValue(glyph.sha256, "$.safety.glyphEvidence.sha256", errors);
    } else if (glyph.status === "blocked-unverified") {
      status = "blocked-unverified";
      if (glyph.sha256 !== null) errors.push("$.safety.glyphEvidence.sha256 must be null while glyph evidence is unverified");
    } else errors.push("$.safety.glyphEvidence.status is not supported");
  }
  if (safety.mixedIndexedFragments !== 0) errors.push("$.safety.mixedIndexedFragments must equal 0");
  if (safety.indexedPixelFallback !== false) errors.push("$.safety.indexedPixelFallback must equal false");
  if (safety.runtimeModelCalls !== false) errors.push("$.safety.runtimeModelCalls must equal false");
  return status;
}

function validateRuntime(value: unknown, errors: string[]): void {
  hashObject(value, ["visualRuntimeSha256", "replaySemanticsSha256", "identityMapSha256"], "$.runtime", errors);
}

function validateCapture(value: unknown, errors: string[]): void {
  const capture = record(value, "$.capture", errors);
  if (!capture) return;
  exactKeys(capture, ["capturedArtifactSha256", "screenshotSetSha256", "sameStateSourceHdPairs"], "$.capture", errors);
  hashValue(capture.capturedArtifactSha256, "$.capture.capturedArtifactSha256", errors);
  hashValue(capture.screenshotSetSha256, "$.capture.screenshotSetSha256", errors);
  if (!Number.isSafeInteger(capture.sameStateSourceHdPairs) || (capture.sameStateSourceHdPairs as number) < 1) {
    errors.push("$.capture.sameStateSourceHdPairs must be a positive integer");
  }
}

function validateBrowser(value: unknown, errors: string[]): void {
  const browser = record(value, "$.browser", errors);
  if (!browser) return;
  exactKeys(browser, ["browserEvidenceSha256", "environmentSha256", "readiness"], "$.browser", errors);
  hashValue(browser.browserEvidenceSha256, "$.browser.browserEvidenceSha256", errors);
  hashValue(browser.environmentSha256, "$.browser.environmentSha256", errors);
  const readiness = record(browser.readiness, "$.browser.readiness", errors);
  if (!readiness) return;
  exactKeys(readiness, ["status", "overlayExcluded", "consecutivePresentedFrames", "modeSceneBoundaryViewportBound"], "$.browser.readiness", errors);
  if (readiness.status !== "ready") errors.push("$.browser.readiness.status must equal ready");
  if (readiness.overlayExcluded !== true) errors.push("$.browser.readiness.overlayExcluded must equal true");
  if (!Number.isSafeInteger(readiness.consecutivePresentedFrames)
    || (readiness.consecutivePresentedFrames as number) < 2) {
    errors.push("$.browser.readiness.consecutivePresentedFrames must be at least 2");
  }
  if (readiness.modeSceneBoundaryViewportBound !== true) {
    errors.push("$.browser.readiness.modeSceneBoundaryViewportBound must equal true");
  }
}

function validateHumanReview(value: unknown, errors: string[]): void {
  const human = record(value, "$.humanReview", errors);
  if (!human) return;
  exactKeys(human, ["reviewPacket"], "$.humanReview", errors);
  const packet = record(human.reviewPacket, "$.humanReview.reviewPacket", errors);
  if (!packet) return;
  exactKeys(packet, ["path", "sha256", "status"], "$.humanReview.reviewPacket", errors);
  safeRelativePath(packet.path, "$.humanReview.reviewPacket.path", errors);
  hashValue(packet.sha256, "$.humanReview.reviewPacket.sha256", errors);
  if (packet.status !== PENDING_HD_REVIEWER) {
    errors.push(`$.humanReview.reviewPacket.status must equal ${PENDING_HD_REVIEWER}`);
  }
}

export function validateHdEvidenceLifecycle(value: unknown): HdEvidenceLifecycleValidationResult {
  const errors: string[] = [];
  const root = record(value, "$", errors);
  if (!root) return { valid: false, errors };
  exactKeys(root, [
    "schemaVersion", "gameId", "artifactClass", "lifecycleState", "orderedGates",
    "draft", "safety", "runtime", "capture", "browser", "humanReview",
  ], "$", errors);
  if (root.schemaVersion !== HD_EVIDENCE_LIFECYCLE_SCHEMA_VERSION) {
    errors.push(`$.schemaVersion must equal ${HD_EVIDENCE_LIFECYCLE_SCHEMA_VERSION}`);
  }
  idValue(root.gameId, "$.gameId", errors);
  const artifactClass = HD_EVIDENCE_ARTIFACT_CLASSES.includes(root.artifactClass as HdEvidenceArtifactClass)
    ? root.artifactClass as HdEvidenceArtifactClass : undefined;
  if (!artifactClass) errors.push("$.artifactClass is not supported");
  const lifecycleState = HD_EVIDENCE_LIFECYCLE_STATES.includes(root.lifecycleState as HdEvidenceLifecycleState)
    ? root.lifecycleState as HdEvidenceLifecycleState : undefined;
  if (!lifecycleState) errors.push("$.lifecycleState is not supported");
  const verdicts = validateOrderedGates(root.orderedGates, errors);
  const draft = validateDraft(root.draft, errors);
  const glyphStatus = validateSafety(root.safety, errors);
  if (artifactClass === "offline-hd-draft") {
    if (root.runtime !== null || root.capture !== null || root.browser !== null || root.humanReview !== null) {
      errors.push("Offline HD drafts cannot carry runtime, capture, browser, or human claims");
    }
    if (!["offline-hd-draft", "pending-packaged-capture"].includes(lifecycleState ?? "")) {
      errors.push("Offline HD drafts can only be offline-hd-draft or pending-packaged-capture");
    }
  } else if (artifactClass === "packaged-capture") {
    if (lifecycleState !== "pending-human-review") errors.push("Packaged capture must be pending-human-review");
    if (root.runtime === null || root.capture === null || root.browser === null) {
      errors.push("Packaged capture requires runtime, capture, and browser evidence");
    } else {
      validateRuntime(root.runtime, errors);
      validateCapture(root.capture, errors);
      validateBrowser(root.browser, errors);
    }
    if (root.humanReview !== null) errors.push("Packaged capture cannot carry a human review claim");
  } else if (artifactClass === "human-review-packet") {
    if (lifecycleState !== "pending-human-review") errors.push("Human review packet must be pending-human-review");
    if (root.runtime === null || root.capture === null || root.browser === null || root.humanReview === null) {
      errors.push("Human review packet requires runtime, capture, browser, and pending packet lineage");
    } else {
      validateRuntime(root.runtime, errors);
      validateCapture(root.capture, errors);
      validateBrowser(root.browser, errors);
      validateHumanReview(root.humanReview, errors);
    }
  }

  if (lifecycleState === "pending-packaged-capture" && artifactClass !== "offline-hd-draft") {
    errors.push("Only an offline draft can wait for packaged capture");
  }
  if (lifecycleState !== "offline-hd-draft" && draft
    && (draft.reachable < 1 || draft.mapped !== draft.reachable || draft.unmapped !== 0)) {
    errors.push("Lifecycle promotion requires complete mapped presentation with zero unmapped elements");
  }
  if (lifecycleState !== "offline-hd-draft" && glyphStatus !== "verified") {
    errors.push("Unverified glyph evidence blocks lifecycle promotion");
  }
  return { valid: errors.length === 0, errors };
}

export function assertHdEvidenceLifecycle(value: unknown): asserts value is HdEvidenceLifecycleV1 {
  const result = validateHdEvidenceLifecycle(value);
  if (!result.valid) throw new Error(`Invalid HD evidence lifecycle: ${result.errors.join("; ")}`);
}
