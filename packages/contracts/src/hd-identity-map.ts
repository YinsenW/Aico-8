export const HD_IDENTITY_MAP_SCHEMA_VERSION = "aico8.hd-identity-map.v1" as const;

export const ALLOWED_MODERNIZATION_DIMENSIONS = [
  "material",
  "lighting",
  "surface-detail",
  "animation-sampling",
  "particle-density",
] as const;

export type ModernizationDimension = (typeof ALLOWED_MODERNIZATION_DIMENSIONS)[number];
export type VisualElementKind = "character" | "environment" | "ui" | "effect" | "text";

export interface IdentityEvidence {
  id: string;
  kind: "source-frame" | "source-sprite" | "source-tile" | "source-command" | "source-animation";
  sourceRef: string;
  sha256: string;
}

export interface RequiredPartMapping {
  id: string;
  label: string;
  sourceEvidenceIds: string[];
  targetRegionIds: string[];
}

export interface ProportionCheck {
  id: string;
  label: string;
  sourceRatio: number;
  targetRatio: number;
  maximumAbsoluteDelta: number;
}

export interface IdentityAnchors {
  silhouetteTraits: string[];
  requiredParts: RequiredPartMapping[];
  proportionChecks: ProportionCheck[];
  faceAndExpressionTraits: string[];
  colorHierarchy: string[];
  motionCues: string[];
  gameplayCues: string[];
  forbiddenTransformations: string[];
}

export interface FrozenRenderRecipe {
  assetSha256: string;
  recipeId: string;
  targetRegionIds: string[];
  runtimeModelCalls: false;
}

export interface IdentityReview {
  reviewer: string;
  sourceSceneIds: string[];
  targetSceneIds: string[];
  silhouettePassed: boolean;
  requiredPartsPassed: boolean;
  proportionsPassed: boolean;
  expressionPassed: boolean;
  colorHierarchyPassed: boolean;
  motionPassed: boolean;
  gameplayCuesPassed: boolean;
  visualGrammarPassed: boolean;
}

export interface HdIdentityElement {
  id: string;
  kind: VisualElementKind;
  semanticRole: string;
  evidence: IdentityEvidence[];
  anchors: IdentityAnchors;
  allowedModernization: ModernizationDimension[];
  render: FrozenRenderRecipe;
  review: IdentityReview;
}

export interface HdIdentityMapV1 {
  schemaVersion: typeof HD_IDENTITY_MAP_SCHEMA_VERSION;
  gameId: string;
  cartSha256: string;
  visualGrammarId: string;
  canonicalReplayId: string;
  status: "draft" | "accepted";
  elements: HdIdentityElement[];
  coverage: {
    reachableElementIds: string[];
    mappedElementIds: string[];
    mixedIndexedFragments: number;
    diagnosticReferenceSwitches: number;
  };
}

export interface HdIdentityMapValidationResult {
  valid: boolean;
  errors: string[];
}

type JsonRecord = Record<string, unknown>;

const idPattern = /^[a-z0-9][a-z0-9._-]{1,127}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const elementKinds = new Set<VisualElementKind>(["character", "environment", "ui", "effect", "text"]);
const modernizationDimensions = new Set<string>(ALLOWED_MODERNIZATION_DIMENSIONS);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkKeys(
  value: JsonRecord,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
  errors: string[],
): void {
  for (const key of required) if (!(key in value)) errors.push(`${path}.${key} is required`);
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) if (!allowedSet.has(key)) errors.push(`${path}.${key} is not allowed`);
}

function checkString(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string`);
    return false;
  }
  return true;
}

function checkId(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    errors.push(`${path} must match ${idPattern.source}`);
    return false;
  }
  return true;
}

function checkHash(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "string" || !hashPattern.test(value)) {
    errors.push(`${path} must be a lowercase SHA-256 hex digest`);
  }
}

function checkUniqueStrings(value: unknown, path: string, errors: string[], minimum = 1): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.some((item) => !checkString(item, `${path}[]`, errors))) {
    if (!Array.isArray(value) || value.length < minimum) errors.push(`${path} must contain at least ${minimum} string(s)`);
    return [];
  }
  const strings = value as string[];
  if (new Set(strings).size !== strings.length) errors.push(`${path} must not contain duplicates`);
  return strings;
}

function checkPassed(value: unknown, path: string, accepted: boolean, errors: string[]): void {
  if (typeof value !== "boolean") errors.push(`${path} must be a boolean`);
  else if (accepted && value !== true) errors.push(`${path} must pass before the map can be accepted`);
}

function validateEvidence(value: unknown, path: string, errors: string[]): string | undefined {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  checkKeys(value, ["id", "kind", "sourceRef", "sha256"], ["id", "kind", "sourceRef", "sha256"], path, errors);
  const id = checkId(value.id, `${path}.id`, errors) ? value.id : undefined;
  if (!["source-frame", "source-sprite", "source-tile", "source-command", "source-animation"].includes(value.kind as string)) {
    errors.push(`${path}.kind is not a supported evidence kind`);
  }
  checkString(value.sourceRef, `${path}.sourceRef`, errors);
  checkHash(value.sha256, `${path}.sha256`, errors);
  return id;
}

function validateAnchors(
  value: unknown,
  kind: VisualElementKind | undefined,
  evidenceIds: Set<string>,
  targetRegionIds: Set<string>,
  path: string,
  errors: string[],
): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  const keys = [
    "silhouetteTraits",
    "requiredParts",
    "proportionChecks",
    "faceAndExpressionTraits",
    "colorHierarchy",
    "motionCues",
    "gameplayCues",
    "forbiddenTransformations",
  ] as const;
  checkKeys(value, keys, keys, path, errors);
  checkUniqueStrings(value.silhouetteTraits, `${path}.silhouetteTraits`, errors);
  checkUniqueStrings(value.colorHierarchy, `${path}.colorHierarchy`, errors);
  checkUniqueStrings(value.motionCues, `${path}.motionCues`, errors);
  checkUniqueStrings(value.gameplayCues, `${path}.gameplayCues`, errors);
  checkUniqueStrings(value.forbiddenTransformations, `${path}.forbiddenTransformations`, errors);
  const expressionTraits = checkUniqueStrings(
    value.faceAndExpressionTraits,
    `${path}.faceAndExpressionTraits`,
    errors,
    kind === "character" ? 1 : 0,
  );
  if (kind === "character" && expressionTraits.length === 0) {
    errors.push(`${path}.faceAndExpressionTraits is mandatory for characters`);
  }

  if (!Array.isArray(value.requiredParts) || value.requiredParts.length === 0) {
    errors.push(`${path}.requiredParts must map every identity-bearing part`);
  } else {
    const partIds = new Set<string>();
    for (const [index, rawPart] of value.requiredParts.entries()) {
      const partPath = `${path}.requiredParts[${index}]`;
      if (!isRecord(rawPart)) {
        errors.push(`${partPath} must be an object`);
        continue;
      }
      checkKeys(rawPart, ["id", "label", "sourceEvidenceIds", "targetRegionIds"], ["id", "label", "sourceEvidenceIds", "targetRegionIds"], partPath, errors);
      if (checkId(rawPart.id, `${partPath}.id`, errors)) {
        if (partIds.has(rawPart.id)) errors.push(`${partPath}.id must be unique within the element`);
        partIds.add(rawPart.id);
      }
      checkString(rawPart.label, `${partPath}.label`, errors);
      for (const evidenceId of checkUniqueStrings(rawPart.sourceEvidenceIds, `${partPath}.sourceEvidenceIds`, errors)) {
        if (!evidenceIds.has(evidenceId)) errors.push(`${partPath}.sourceEvidenceIds references unknown evidence ${evidenceId}`);
      }
      for (const regionId of checkUniqueStrings(rawPart.targetRegionIds, `${partPath}.targetRegionIds`, errors)) {
        if (!targetRegionIds.has(regionId)) errors.push(`${partPath}.targetRegionIds references unknown target region ${regionId}`);
      }
    }
  }

  if (!Array.isArray(value.proportionChecks) || value.proportionChecks.length === 0) {
    errors.push(`${path}.proportionChecks must contain at least one measurable source-to-target ratio`);
  } else {
    const proportionIds = new Set<string>();
    for (const [index, rawCheck] of value.proportionChecks.entries()) {
      const checkPath = `${path}.proportionChecks[${index}]`;
      if (!isRecord(rawCheck)) {
        errors.push(`${checkPath} must be an object`);
        continue;
      }
      checkKeys(rawCheck, ["id", "label", "sourceRatio", "targetRatio", "maximumAbsoluteDelta"], ["id", "label", "sourceRatio", "targetRatio", "maximumAbsoluteDelta"], checkPath, errors);
      if (checkId(rawCheck.id, `${checkPath}.id`, errors)) {
        if (proportionIds.has(rawCheck.id)) errors.push(`${checkPath}.id must be unique within the element`);
        proportionIds.add(rawCheck.id);
      }
      checkString(rawCheck.label, `${checkPath}.label`, errors);
      const numbers = [rawCheck.sourceRatio, rawCheck.targetRatio, rawCheck.maximumAbsoluteDelta];
      if (numbers.some((number) => typeof number !== "number" || !Number.isFinite(number) || number < 0)) {
        errors.push(`${checkPath} ratios and delta must be finite non-negative numbers`);
      } else if (Math.abs((rawCheck.targetRatio as number) - (rawCheck.sourceRatio as number)) > (rawCheck.maximumAbsoluteDelta as number)) {
        errors.push(`${checkPath}.targetRatio changes the declared source proportion beyond maximumAbsoluteDelta`);
      }
    }
  }
}

function validateReview(value: unknown, path: string, accepted: boolean, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  const passKeys = [
    "silhouettePassed",
    "requiredPartsPassed",
    "proportionsPassed",
    "expressionPassed",
    "colorHierarchyPassed",
    "motionPassed",
    "gameplayCuesPassed",
    "visualGrammarPassed",
  ] as const;
  const keys = ["reviewer", "sourceSceneIds", "targetSceneIds", ...passKeys] as const;
  checkKeys(value, keys, keys, path, errors);
  checkString(value.reviewer, `${path}.reviewer`, errors);
  checkUniqueStrings(value.sourceSceneIds, `${path}.sourceSceneIds`, errors);
  checkUniqueStrings(value.targetSceneIds, `${path}.targetSceneIds`, errors);
  for (const key of passKeys) checkPassed(value[key], `${path}.${key}`, accepted, errors);
}

export function validateHdIdentityMap(value: unknown): HdIdentityMapValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ["$ must be an object"] };
  const rootKeys = ["schemaVersion", "gameId", "cartSha256", "visualGrammarId", "canonicalReplayId", "status", "elements", "coverage"] as const;
  checkKeys(value, rootKeys, rootKeys, "$", errors);
  if (value.schemaVersion !== HD_IDENTITY_MAP_SCHEMA_VERSION) errors.push(`$.schemaVersion must equal ${HD_IDENTITY_MAP_SCHEMA_VERSION}`);
  checkId(value.gameId, "$.gameId", errors);
  checkHash(value.cartSha256, "$.cartSha256", errors);
  checkId(value.visualGrammarId, "$.visualGrammarId", errors);
  checkId(value.canonicalReplayId, "$.canonicalReplayId", errors);
  const accepted = value.status === "accepted";
  if (!accepted && value.status !== "draft") errors.push("$.status must be draft or accepted");

  const elementIds = new Set<string>();
  if (!Array.isArray(value.elements) || value.elements.length === 0) {
    errors.push("$.elements must contain at least one visual element");
  } else {
    for (const [index, rawElement] of value.elements.entries()) {
      const elementPath = `$.elements[${index}]`;
      if (!isRecord(rawElement)) {
        errors.push(`${elementPath} must be an object`);
        continue;
      }
      const elementKeys = ["id", "kind", "semanticRole", "evidence", "anchors", "allowedModernization", "render", "review"] as const;
      checkKeys(rawElement, elementKeys, elementKeys, elementPath, errors);
      if (checkId(rawElement.id, `${elementPath}.id`, errors)) {
        if (elementIds.has(rawElement.id)) errors.push(`${elementPath}.id must be globally unique`);
        elementIds.add(rawElement.id);
      }
      const kind = elementKinds.has(rawElement.kind as VisualElementKind) ? rawElement.kind as VisualElementKind : undefined;
      if (!kind) errors.push(`${elementPath}.kind is not supported`);
      checkString(rawElement.semanticRole, `${elementPath}.semanticRole`, errors);

      const evidenceIds = new Set<string>();
      if (!Array.isArray(rawElement.evidence) || rawElement.evidence.length === 0) {
        errors.push(`${elementPath}.evidence must contain source evidence`);
      } else {
        for (const [evidenceIndex, rawEvidence] of rawElement.evidence.entries()) {
          const evidenceId = validateEvidence(rawEvidence, `${elementPath}.evidence[${evidenceIndex}]`, errors);
          if (evidenceId) {
            if (evidenceIds.has(evidenceId)) errors.push(`${elementPath}.evidence[${evidenceIndex}].id must be unique`);
            evidenceIds.add(evidenceId);
          }
        }
      }

      let targetRegionIds = new Set<string>();
      if (!isRecord(rawElement.render)) {
        errors.push(`${elementPath}.render must be an object`);
      } else {
        checkKeys(rawElement.render, ["assetSha256", "recipeId", "targetRegionIds", "runtimeModelCalls"], ["assetSha256", "recipeId", "targetRegionIds", "runtimeModelCalls"], `${elementPath}.render`, errors);
        checkHash(rawElement.render.assetSha256, `${elementPath}.render.assetSha256`, errors);
        checkId(rawElement.render.recipeId, `${elementPath}.render.recipeId`, errors);
        targetRegionIds = new Set(checkUniqueStrings(rawElement.render.targetRegionIds, `${elementPath}.render.targetRegionIds`, errors));
        if (rawElement.render.runtimeModelCalls !== false) errors.push(`${elementPath}.render.runtimeModelCalls must be false`);
      }
      validateAnchors(rawElement.anchors, kind, evidenceIds, targetRegionIds, `${elementPath}.anchors`, errors);
      const modernizations = checkUniqueStrings(rawElement.allowedModernization, `${elementPath}.allowedModernization`, errors, 0);
      for (const modernization of modernizations) {
        if (!modernizationDimensions.has(modernization)) errors.push(`${elementPath}.allowedModernization contains forbidden dimension ${modernization}`);
      }
      validateReview(rawElement.review, `${elementPath}.review`, accepted, errors);
    }
  }

  if (!isRecord(value.coverage)) {
    errors.push("$.coverage must be an object");
  } else {
    checkKeys(value.coverage, ["reachableElementIds", "mappedElementIds", "mixedIndexedFragments", "diagnosticReferenceSwitches"], ["reachableElementIds", "mappedElementIds", "mixedIndexedFragments", "diagnosticReferenceSwitches"], "$.coverage", errors);
    const reachable = checkUniqueStrings(value.coverage.reachableElementIds, "$.coverage.reachableElementIds", errors);
    const mapped = checkUniqueStrings(value.coverage.mappedElementIds, "$.coverage.mappedElementIds", errors);
    for (const id of mapped) if (!elementIds.has(id)) errors.push(`$.coverage.mappedElementIds references unknown element ${id}`);
    if (accepted && (reachable.length !== mapped.length || reachable.some((id) => !mapped.includes(id)))) {
      errors.push("$.coverage must map every reachable element before acceptance");
    }
    for (const key of ["mixedIndexedFragments", "diagnosticReferenceSwitches"] as const) {
      const count = value.coverage[key];
      if (!Number.isInteger(count) || (count as number) < 0) errors.push(`$.coverage.${key} must be a non-negative integer`);
      else if (accepted && count !== 0) errors.push(`$.coverage.${key} must be zero before acceptance`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function assertHdIdentityMap(value: unknown): asserts value is HdIdentityMapV1 {
  const result = validateHdIdentityMap(value);
  if (!result.valid) throw new TypeError(`Invalid HD identity map:\n- ${result.errors.join("\n- ")}`);
}
