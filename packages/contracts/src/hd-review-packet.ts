export const HD_REVIEW_PACKET_SCHEMA_VERSION = "aico8.hd-review-packet.v1" as const;
export const PENDING_HD_REVIEWER = "pending-human-side-by-side-review" as const;

export const HD_REVIEW_CHECK_NAMES = [
  "silhouettePassed",
  "requiredPartsPassed",
  "proportionsPassed",
  "contoursPassed",
  "expressionPassed",
  "colorHierarchyPassed",
  "motionPassed",
  "gameplayCuesPassed",
  "visualGrammarPassed",
] as const;

export const HD_REVIEW_PRINCIPLE_GATES = [
  {
    id: "spirit-fidelity",
    order: 1,
    label: "神似还原 / Spirit fidelity",
    dimensions: [
      "source-relative identity and recognizable character",
      "scene atmosphere and emotional tone",
      "motion, gameplay cues, and play feel",
    ],
  },
  {
    id: "quality-leap",
    order: 2,
    label: "画质跃升 / Quality leap",
    dimensions: [
      "resolution and density-aware sampling",
      "continuous contours and readable internal detail",
      "materials, animation, and effects beyond enlarged pixels",
    ],
  },
  {
    id: "aesthetic-evolution",
    order: 3,
    label: "审美进化 / Aesthetic evolution",
    dimensions: [
      "coherent modern color and lighting",
      "composition, hierarchy, and finish",
      "one visual grammar without source-identity redesign",
    ],
  },
] as const;

export interface HdReviewPacketValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

type JsonRecord = Record<string, unknown>;
type Screenshot = {
  id: string;
  presentationMode: "reference" | "hd";
  sceneId: string;
  stateBoundary: string;
  visualRuntimeSha256: string;
};

const hashPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-z0-9][a-z0-9._-]{1,127}$/;
const elementKinds = new Set(["character", "environment", "ui", "effect", "text"]);

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

function stringValue(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string`);
    return false;
  }
  return true;
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

function integer(value: unknown, path: string, errors: string[], minimum = 0): value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    errors.push(`${path} must be an integer >= ${minimum}`);
    return false;
  }
  return true;
}

function booleanValue(value: unknown, path: string, errors: string[]): value is boolean {
  if (typeof value !== "boolean") {
    errors.push(`${path} must be boolean`);
    return false;
  }
  return true;
}

function stringList(value: unknown, path: string, errors: string[], minimum = 1, ids = false): string[] {
  if (!Array.isArray(value) || value.length < minimum) {
    errors.push(`${path} must contain at least ${minimum} item(s)`);
    return [];
  }
  const result: string[] = [];
  value.forEach((item, index) => {
    const valid = ids
      ? idValue(item, `${path}[${index}]`, errors)
      : stringValue(item, `${path}[${index}]`, errors);
    if (valid) result.push(item as string);
  });
  if (new Set(result).size !== result.length) errors.push(`${path} must not contain duplicates`);
  return result;
}

function safeRelativePath(value: unknown, path: string, errors: string[]): value is string {
  if (!stringValue(value, path, errors)) return false;
  const segments = value.split("/");
  if (value.startsWith("/") || value.includes("\\")
    || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    errors.push(`${path} must be a safe relative path`);
    return false;
  }
  return true;
}

function validatePrincipleGates(value: unknown, status: unknown, errors: string[]): void {
  if (!Array.isArray(value) || value.length !== HD_REVIEW_PRINCIPLE_GATES.length) {
    errors.push(`$.principleGates must contain exactly ${HD_REVIEW_PRINCIPLE_GATES.length} ordered gates`);
    return;
  }
  const expectedVerdict = status === "accepted" ? "passed" : "pending";
  HD_REVIEW_PRINCIPLE_GATES.forEach((expected, index) => {
    const path = `$.principleGates[${index}]`;
    const gate = record(value[index], path, errors);
    if (!gate) return;
    exactKeys(gate, ["id", "order", "label", "dimensions", "verdict"], path, errors);
    if (gate.id !== expected.id || gate.order !== expected.order || gate.label !== expected.label
      || JSON.stringify(gate.dimensions) !== JSON.stringify(expected.dimensions)) {
      errors.push(`${path} must match ${expected.id} in the governed contract order`);
    }
    if (gate.verdict !== expectedVerdict) {
      errors.push(`${path}.verdict must equal ${expectedVerdict} while packet status is ${String(status)}`);
    }
  });
}

function validateReview(
  value: unknown,
  path: string,
  status: string,
  rootReviewer: string | undefined,
  errors: string[],
): void {
  const review = record(value, path, errors);
  if (!review) return;
  const keys = ["reviewer", ...HD_REVIEW_CHECK_NAMES];
  exactKeys(review, keys, path, errors);
  if (stringValue(review.reviewer, `${path}.reviewer`, errors) && rootReviewer && review.reviewer !== rootReviewer) {
    errors.push(`${path}.reviewer must match the packet reviewer`);
  }
  for (const name of HD_REVIEW_CHECK_NAMES) {
    if (booleanValue(review[name], `${path}.${name}`, errors) && status === "accepted" && review[name] !== true) {
      errors.push(`${path}.${name} must pass before the packet is accepted`);
    }
  }
}

function requireScreenshot(
  screenshots: Map<string, Screenshot>,
  id: string,
  expectedMode: "reference" | "hd",
  path: string,
  errors: string[],
): Screenshot | undefined {
  const screenshot = screenshots.get(id);
  if (!screenshot) {
    errors.push(`${path} references unknown screenshot ${id}`);
    return undefined;
  }
  if (screenshot.presentationMode !== expectedMode) {
    errors.push(`${path} ${expectedMode === "hd" ? "target must use HD" : "source must use reference"} presentation`);
  }
  return screenshot;
}

export function validateHdReviewPacket(value: unknown): HdReviewPacketValidationResult {
  const errors: string[] = [];
  const root = record(value, "$", errors);
  if (!root) return { valid: false, errors };
  exactKeys(root, [
    "schemaVersion", "gameId", "visualRuntimeSha256", "replaySemanticsSha256",
    "identityMapSha256", "browserEvidenceSha256", "status", "reviewer",
    "acceptanceStatement", "principleGates", "reviewDecision", "elements", "sceneComparisons",
    "temporalComparisons", "screenshots", "document",
  ], "$", errors);
  if (root.schemaVersion !== HD_REVIEW_PACKET_SCHEMA_VERSION) {
    errors.push(`$.schemaVersion must equal ${HD_REVIEW_PACKET_SCHEMA_VERSION}`);
  }
  idValue(root.gameId, "$.gameId", errors);
  const visualRuntimeSha256 = hashValue(root.visualRuntimeSha256, "$.visualRuntimeSha256", errors)
    ? root.visualRuntimeSha256 as string : undefined;
  hashValue(root.replaySemanticsSha256, "$.replaySemanticsSha256", errors);
  hashValue(root.identityMapSha256, "$.identityMapSha256", errors);
  hashValue(root.browserEvidenceSha256, "$.browserEvidenceSha256", errors);
  const status = root.status;
  if (status !== "pending-human-side-by-side-review" && status !== "accepted") {
    errors.push("$.status must be pending-human-side-by-side-review or accepted");
  }
  const reviewer = stringValue(root.reviewer, "$.reviewer", errors) ? root.reviewer as string : undefined;
  stringValue(root.acceptanceStatement, "$.acceptanceStatement", errors);
  validatePrincipleGates(root.principleGates, status, errors);
  if (status === "pending-human-side-by-side-review" && reviewer !== PENDING_HD_REVIEWER) {
    errors.push(`$.reviewer must equal ${PENDING_HD_REVIEWER} while review is pending`);
  }
  if (status === "accepted" && reviewer === PENDING_HD_REVIEWER) {
    errors.push("$.reviewer must identify the human reviewer when accepted");
  }
  if (status === "pending-human-side-by-side-review" && root.reviewDecision !== null) {
    errors.push("$.reviewDecision must be null while review is pending");
  }
  if (status === "accepted") {
    if (root.reviewDecision === null) {
      errors.push("$.reviewDecision is required when status is accepted");
    } else {
      const decision = record(root.reviewDecision, "$.reviewDecision", errors);
      if (decision) {
        exactKeys(decision, ["path", "sha256"], "$.reviewDecision", errors);
        safeRelativePath(decision.path, "$.reviewDecision.path", errors);
        hashValue(decision.sha256, "$.reviewDecision.sha256", errors);
      }
    }
  }

  const screenshots = new Map<string, Screenshot>();
  if (!Array.isArray(root.screenshots) || root.screenshots.length === 0) {
    errors.push("$.screenshots must be a non-empty array");
  } else {
    root.screenshots.forEach((item, index) => {
      const path = `$.screenshots[${index}]`;
      const screenshot = record(item, path, errors);
      if (!screenshot) return;
      exactKeys(screenshot, ["id", "path", "sha256", "width", "height", "presentationMode", "sceneId", "stateBoundary", "visualRuntimeSha256"], path, errors);
      const id = idValue(screenshot.id, `${path}.id`, errors) ? screenshot.id as string : undefined;
      safeRelativePath(screenshot.path, `${path}.path`, errors);
      hashValue(screenshot.sha256, `${path}.sha256`, errors);
      integer(screenshot.width, `${path}.width`, errors, 1);
      integer(screenshot.height, `${path}.height`, errors, 1);
      if (screenshot.presentationMode !== "reference" && screenshot.presentationMode !== "hd") {
        errors.push(`${path}.presentationMode must be reference or hd`);
      }
      idValue(screenshot.sceneId, `${path}.sceneId`, errors);
      stringValue(screenshot.stateBoundary, `${path}.stateBoundary`, errors);
      if (hashValue(screenshot.visualRuntimeSha256, `${path}.visualRuntimeSha256`, errors)
        && visualRuntimeSha256 && screenshot.visualRuntimeSha256 !== visualRuntimeSha256) {
        errors.push(`${path}.visualRuntimeSha256 must match the packet build`);
      }
      if (id) {
        if (screenshots.has(id)) errors.push(`${path}.id duplicates ${id}`);
        else screenshots.set(id, screenshot as unknown as Screenshot);
      }
    });
  }

  const elementIds = new Set<string>();
  if (!Array.isArray(root.elements) || root.elements.length === 0) {
    errors.push("$.elements must be a non-empty array");
  } else {
    root.elements.forEach((item, index) => {
      const path = `$.elements[${index}]`;
      const element = record(item, path, errors);
      if (!element) return;
      exactKeys(element, ["id", "kind", "semanticRole", "sourceScreenshotIds", "targetScreenshotIds", "criteria", "review"], path, errors);
      const id = idValue(element.id, `${path}.id`, errors) ? element.id as string : undefined;
      if (id) {
        if (elementIds.has(id)) errors.push(`${path}.id duplicates ${id}`);
        elementIds.add(id);
      }
      if (!elementKinds.has(element.kind as string)) errors.push(`${path}.kind is unsupported`);
      stringValue(element.semanticRole, `${path}.semanticRole`, errors);
      const sources = stringList(element.sourceScreenshotIds, `${path}.sourceScreenshotIds`, errors, 1, true);
      const targets = stringList(element.targetScreenshotIds, `${path}.targetScreenshotIds`, errors, 1, true);
      if (sources.length !== targets.length) {
        errors.push(`${path} must declare one ordered target review anchor for every source review anchor`);
      }
      const sourceScreenshots = sources.map((sourceId, sourceIndex) =>
        requireScreenshot(screenshots, sourceId, "reference", `${path}.sourceScreenshotIds[${sourceIndex}]`, errors)).filter(Boolean) as Screenshot[];
      const targetScreenshots = targets.map((targetId, targetIndex) =>
        requireScreenshot(screenshots, targetId, "hd", `${path}.targetScreenshotIds[${targetIndex}]`, errors)).filter(Boolean) as Screenshot[];
      const sourceBoundaries = [...new Set(sourceScreenshots.map(({ stateBoundary }) => stateBoundary))].sort();
      const targetBoundaries = [...new Set(targetScreenshots.map(({ stateBoundary }) => stateBoundary))].sort();
      const sourceScenes = [...new Set(sourceScreenshots.map(({ sceneId }) => sceneId))].sort();
      const targetScenes = [...new Set(targetScreenshots.map(({ sceneId }) => sceneId))].sort();
      if (JSON.stringify(sourceBoundaries) !== JSON.stringify(targetBoundaries)) {
        errors.push(`${path} source and target review anchors must cover the same state boundaries`);
      }
      if (JSON.stringify(sourceScenes) !== JSON.stringify(targetScenes)) {
        errors.push(`${path} source and target review anchors must cover the same scenes`);
      }
      for (let pairIndex = 0; pairIndex < Math.min(sourceScreenshots.length, targetScreenshots.length); pairIndex += 1) {
        const source = sourceScreenshots[pairIndex]!;
        const target = targetScreenshots[pairIndex]!;
        if (source.stateBoundary !== target.stateBoundary || source.sceneId !== target.sceneId) {
          errors.push(`${path} review anchor pair ${pairIndex} must bind the same state boundary and scene`);
        }
      }
      const criteria = record(element.criteria, `${path}.criteria`, errors);
      if (criteria) {
        const criteriaKeys = ["silhouetteTraits", "requiredParts", "proportionChecks", "compositionChecks", "contourChecks", "faceAndExpressionTraits", "colorHierarchy", "motionCues", "gameplayCues", "forbiddenTransformations", "allowedModernization"];
        exactKeys(criteria, criteriaKeys, `${path}.criteria`, errors);
        for (const key of criteriaKeys) stringList(criteria[key], `${path}.criteria.${key}`, errors,
          key === "faceAndExpressionTraits" || key === "allowedModernization" || key === "contourChecks" ? 0 : 1);
      }
      validateReview(element.review, `${path}.review`, status as string, reviewer, errors);
    });
  }

  const comparisonIds = new Set<string>();
  if (!Array.isArray(root.sceneComparisons) || root.sceneComparisons.length === 0) {
    errors.push("$.sceneComparisons must be a non-empty array");
  } else {
    root.sceneComparisons.forEach((item, index) => {
      const path = `$.sceneComparisons[${index}]`;
      const comparison = record(item, path, errors);
      if (!comparison) return;
      exactKeys(comparison, ["id", "sceneId", "sourceScreenshotId", "targetScreenshotId", "sameRuntimeState"], path, errors);
      const id = idValue(comparison.id, `${path}.id`, errors) ? comparison.id as string : undefined;
      if (id) {
        if (comparisonIds.has(id)) errors.push(`${path}.id duplicates ${id}`);
        comparisonIds.add(id);
      }
      const sceneId = idValue(comparison.sceneId, `${path}.sceneId`, errors) ? comparison.sceneId as string : undefined;
      const sourceId = idValue(comparison.sourceScreenshotId, `${path}.sourceScreenshotId`, errors) ? comparison.sourceScreenshotId as string : undefined;
      const targetId = idValue(comparison.targetScreenshotId, `${path}.targetScreenshotId`, errors) ? comparison.targetScreenshotId as string : undefined;
      const source = sourceId ? requireScreenshot(screenshots, sourceId, "reference", `${path}.sourceScreenshotId`, errors) : undefined;
      const target = targetId ? requireScreenshot(screenshots, targetId, "hd", `${path}.targetScreenshotId`, errors) : undefined;
      if (source && target && source.stateBoundary !== target.stateBoundary) errors.push(`${path} source and target must use the same state boundary`);
      if (sceneId && (source?.sceneId !== sceneId || target?.sceneId !== sceneId)) errors.push(`${path} screenshots must match sceneId`);
      if (booleanValue(comparison.sameRuntimeState, `${path}.sameRuntimeState`, errors) && comparison.sameRuntimeState !== true) {
        errors.push(`${path}.sameRuntimeState must be true`);
      }
    });
  }

  const temporalIds = new Set<string>();
  if (!Array.isArray(root.temporalComparisons) || root.temporalComparisons.length === 0) {
    errors.push("$.temporalComparisons must be a non-empty array");
  } else {
    root.temporalComparisons.forEach((item, index) => {
      const path = `$.temporalComparisons[${index}]`;
      const comparison = record(item, path, errors);
      if (!comparison) return;
      exactKeys(comparison, ["id", "sceneId", "elementIds", "frames"], path, errors);
      const id = idValue(comparison.id, `${path}.id`, errors) ? comparison.id as string : undefined;
      if (id) {
        if (temporalIds.has(id)) errors.push(`${path}.id duplicates ${id}`);
        temporalIds.add(id);
      }
      const sceneId = idValue(comparison.sceneId, `${path}.sceneId`, errors) ? comparison.sceneId as string : undefined;
      const referencedElementIds = stringList(comparison.elementIds, `${path}.elementIds`, errors, 1, true);
      referencedElementIds.forEach((elementId) => {
        if (!elementIds.has(elementId)) errors.push(`${path}.elementIds references unknown element ${elementId}`);
      });
      if (!Array.isArray(comparison.frames) || comparison.frames.length === 0) {
        errors.push(`${path}.frames must be a non-empty array`);
        return;
      }
      comparison.frames.forEach((item_, frameIndex) => {
        const framePath = `${path}.frames[${frameIndex}]`;
        const frame = record(item_, framePath, errors);
        if (!frame) return;
        exactKeys(frame, ["update", "presentationMilliseconds", "sourceScreenshotId", "targetScreenshotId", "sameRuntimeState"], framePath, errors);
        const update = integer(frame.update, `${framePath}.update`, errors, 0) ? frame.update as number : undefined;
        const milliseconds = integer(frame.presentationMilliseconds, `${framePath}.presentationMilliseconds`, errors, 0)
          ? frame.presentationMilliseconds as number : undefined;
        const sourceId = idValue(frame.sourceScreenshotId, `${framePath}.sourceScreenshotId`, errors) ? frame.sourceScreenshotId as string : undefined;
        const targetId = idValue(frame.targetScreenshotId, `${framePath}.targetScreenshotId`, errors) ? frame.targetScreenshotId as string : undefined;
        const source = sourceId ? requireScreenshot(screenshots, sourceId, "reference", `${framePath}.sourceScreenshotId`, errors) : undefined;
        const target = targetId ? requireScreenshot(screenshots, targetId, "hd", `${framePath}.targetScreenshotId`, errors) : undefined;
        if (source && target && source.stateBoundary !== target.stateBoundary) errors.push(`${framePath} source and target must use the same state boundary`);
        if (sceneId && (source?.sceneId !== sceneId || target?.sceneId !== sceneId)) errors.push(`${framePath} screenshots must match sceneId`);
        if (update !== undefined && milliseconds !== undefined) {
          const expected = `canonical-replay:update:${update}:presentation-ms:${milliseconds}`;
          if (source?.stateBoundary !== expected || target?.stateBoundary !== expected) errors.push(`${framePath} must bind ${expected}`);
        }
        if (booleanValue(frame.sameRuntimeState, `${framePath}.sameRuntimeState`, errors) && frame.sameRuntimeState !== true) {
          errors.push(`${framePath}.sameRuntimeState must be true`);
        }
      });
    });
  }

  const document = record(root.document, "$.document", errors);
  if (document) {
    exactKeys(document, ["path", "sha256"], "$.document", errors);
    safeRelativePath(document.path, "$.document.path", errors);
    hashValue(document.sha256, "$.document.sha256", errors);
  }

  return { valid: errors.length === 0, errors };
}
