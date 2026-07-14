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
export type CopyOrigin = "none" | "source-authored" | "state-derived-accessibility" | "supplemental-authorized";

export interface IdentityEvidence {
  id: string;
  kind: "source-frame" | "source-sprite" | "source-tile" | "source-command" | "source-animation" | "product-authorization";
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

export interface NormalizedCompositionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CompositionCheck {
  id: string;
  label: string;
  sourceEvidenceIds: string[];
  targetRegionIds: string[];
  sourceBounds: NormalizedCompositionBounds;
  targetBounds: NormalizedCompositionBounds;
  maximumEdgeDelta: number;
}

export interface IdentityAnchors {
  silhouetteTraits: string[];
  requiredParts: RequiredPartMapping[];
  proportionChecks: ProportionCheck[];
  compositionChecks: CompositionCheck[];
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

export interface CopyProvenance {
  origin: CopyOrigin;
  sourceCopy: string[];
  targetCopy: string[];
  evidenceIds: string[];
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
  copy: CopyProvenance;
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
const copyOrigins = new Set<CopyOrigin>(["none", "source-authored", "state-derived-accessibility", "supplemental-authorized"]);
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

function validateNormalizedBounds(
  value: unknown,
  path: string,
  errors: string[],
): NormalizedCompositionBounds | undefined {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  const keys = ["x", "y", "width", "height"] as const;
  checkKeys(value, keys, keys, path, errors);
  const numbers = keys.map((key) => value[key]);
  if (numbers.some((number) => typeof number !== "number" || !Number.isFinite(number))) {
    errors.push(`${path} values must be finite numbers`);
    return undefined;
  }
  const bounds = value as unknown as NormalizedCompositionBounds;
  if (bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 || bounds.height <= 0
    || bounds.x + bounds.width > 1 || bounds.y + bounds.height > 1) {
    errors.push(`${path} must be a positive rectangle normalized inside the source frame`);
    return undefined;
  }
  return bounds;
}

function validateEvidence(value: unknown, path: string, errors: string[]): string | undefined {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  checkKeys(value, ["id", "kind", "sourceRef", "sha256"], ["id", "kind", "sourceRef", "sha256"], path, errors);
  const id = checkId(value.id, `${path}.id`, errors) ? value.id : undefined;
  if (!["source-frame", "source-sprite", "source-tile", "source-command", "source-animation", "product-authorization"].includes(value.kind as string)) {
    errors.push(`${path}.kind is not a supported evidence kind`);
  }
  checkString(value.sourceRef, `${path}.sourceRef`, errors);
  checkHash(value.sha256, `${path}.sha256`, errors);
  return id;
}

function validateCopy(
  value: unknown,
  evidenceKinds: Map<string, string>,
  path: string,
  errors: string[],
): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  const keys = ["origin", "sourceCopy", "targetCopy", "evidenceIds"] as const;
  checkKeys(value, keys, keys, path, errors);
  const origin = copyOrigins.has(value.origin as CopyOrigin) ? value.origin as CopyOrigin : undefined;
  if (!origin) errors.push(`${path}.origin is not supported`);
  const sourceCopy = checkUniqueStrings(value.sourceCopy, `${path}.sourceCopy`, errors, 0);
  const targetCopy = checkUniqueStrings(value.targetCopy, `${path}.targetCopy`, errors, 0);
  const evidenceIds = checkUniqueStrings(value.evidenceIds, `${path}.evidenceIds`, errors, 0);
  for (const id of evidenceIds) if (!evidenceKinds.has(id)) errors.push(`${path}.evidenceIds references unknown evidence ${id}`);
  if (!origin) return;
  if (origin === "none") {
    if (sourceCopy.length > 0 || targetCopy.length > 0 || evidenceIds.length > 0) {
      errors.push(`${path} with origin none cannot declare copy or evidence`);
    }
    return;
  }
  if (targetCopy.length === 0) errors.push(`${path}.targetCopy must identify every rendered copy string`);
  if (evidenceIds.length === 0) errors.push(`${path}.evidenceIds must trace rendered copy to durable evidence`);
  if (origin === "source-authored") {
    const normalize = (text: string): string => text.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
    if (sourceCopy.length === 0 || sourceCopy.length !== targetCopy.length
      || sourceCopy.some((text, index) => normalize(text) !== normalize(targetCopy[index] ?? ""))) {
      errors.push(`${path} source-authored target copy must preserve the normalized source copy`);
    }
  } else if (sourceCopy.length > 0) {
    errors.push(`${path}.sourceCopy must be empty unless origin is source-authored`);
  }
  if (origin === "supplemental-authorized"
    && !evidenceIds.some((id) => evidenceKinds.get(id) === "product-authorization")) {
    errors.push(`${path} supplemental copy requires product-authorization evidence`);
  }
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
    "compositionChecks",
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

  if (!Array.isArray(value.compositionChecks) || value.compositionChecks.length === 0) {
    errors.push(`${path}.compositionChecks must preserve at least one measurable source-to-target frame region`);
  } else {
    const compositionIds = new Set<string>();
    for (const [index, rawCheck] of value.compositionChecks.entries()) {
      const checkPath = `${path}.compositionChecks[${index}]`;
      if (!isRecord(rawCheck)) {
        errors.push(`${checkPath} must be an object`);
        continue;
      }
      const keys = [
        "id", "label", "sourceEvidenceIds", "targetRegionIds",
        "sourceBounds", "targetBounds", "maximumEdgeDelta",
      ] as const;
      checkKeys(rawCheck, keys, keys, checkPath, errors);
      if (checkId(rawCheck.id, `${checkPath}.id`, errors)) {
        if (compositionIds.has(rawCheck.id)) errors.push(`${checkPath}.id must be unique within the element`);
        compositionIds.add(rawCheck.id);
      }
      checkString(rawCheck.label, `${checkPath}.label`, errors);
      for (const evidenceId of checkUniqueStrings(rawCheck.sourceEvidenceIds, `${checkPath}.sourceEvidenceIds`, errors)) {
        if (!evidenceIds.has(evidenceId)) errors.push(`${checkPath}.sourceEvidenceIds references unknown evidence ${evidenceId}`);
      }
      for (const regionId of checkUniqueStrings(rawCheck.targetRegionIds, `${checkPath}.targetRegionIds`, errors)) {
        if (!targetRegionIds.has(regionId)) errors.push(`${checkPath}.targetRegionIds references unknown target region ${regionId}`);
      }
      const source = validateNormalizedBounds(rawCheck.sourceBounds, `${checkPath}.sourceBounds`, errors);
      const target = validateNormalizedBounds(rawCheck.targetBounds, `${checkPath}.targetBounds`, errors);
      const maximumEdgeDelta = rawCheck.maximumEdgeDelta;
      if (typeof maximumEdgeDelta !== "number" || !Number.isFinite(maximumEdgeDelta)
        || maximumEdgeDelta < 0 || maximumEdgeDelta > 1) {
        errors.push(`${checkPath}.maximumEdgeDelta must be a finite normalized value from 0 through 1`);
      } else if (source && target) {
        const sourceEdges = [source.x, source.y, source.x + source.width, source.y + source.height];
        const targetEdges = [target.x, target.y, target.x + target.width, target.y + target.height];
        if (sourceEdges.some((edge, edgeIndex) => Math.abs(edge - (targetEdges[edgeIndex] ?? edge)) > maximumEdgeDelta)) {
          errors.push(`${checkPath}.targetBounds changes the declared source composition beyond maximumEdgeDelta`);
        }
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
  const sourceSceneIds = checkUniqueStrings(value.sourceSceneIds, `${path}.sourceSceneIds`, errors);
  const targetSceneIds = checkUniqueStrings(value.targetSceneIds, `${path}.targetSceneIds`, errors);
  if (sourceSceneIds.length !== targetSceneIds.length) {
    errors.push(`${path} must declare one ordered target review anchor for every source review anchor`);
  }
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
      const elementKeys = ["id", "kind", "semanticRole", "evidence", "copy", "anchors", "allowedModernization", "render", "review"] as const;
      checkKeys(rawElement, elementKeys, elementKeys, elementPath, errors);
      if (checkId(rawElement.id, `${elementPath}.id`, errors)) {
        if (elementIds.has(rawElement.id)) errors.push(`${elementPath}.id must be globally unique`);
        elementIds.add(rawElement.id);
      }
      const kind = elementKinds.has(rawElement.kind as VisualElementKind) ? rawElement.kind as VisualElementKind : undefined;
      if (!kind) errors.push(`${elementPath}.kind is not supported`);
      checkString(rawElement.semanticRole, `${elementPath}.semanticRole`, errors);

      const evidenceIds = new Set<string>();
      const evidenceKinds = new Map<string, string>();
      if (!Array.isArray(rawElement.evidence) || rawElement.evidence.length === 0) {
        errors.push(`${elementPath}.evidence must contain source evidence`);
      } else {
        for (const [evidenceIndex, rawEvidence] of rawElement.evidence.entries()) {
          const evidenceId = validateEvidence(rawEvidence, `${elementPath}.evidence[${evidenceIndex}]`, errors);
          if (evidenceId) {
            if (evidenceIds.has(evidenceId)) errors.push(`${elementPath}.evidence[${evidenceIndex}].id must be unique`);
            evidenceIds.add(evidenceId);
            if (isRecord(rawEvidence) && typeof rawEvidence.kind === "string") evidenceKinds.set(evidenceId, rawEvidence.kind);
          }
        }
      }
      validateCopy(rawElement.copy, evidenceKinds, `${elementPath}.copy`, errors);

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
