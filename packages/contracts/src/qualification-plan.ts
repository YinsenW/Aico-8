export const QUALIFICATION_PLAN_SCHEMA_VERSION = "aico8.qualification-plan.v1" as const;

export const QUALIFICATION_RISK_DIMENSIONS = [
  "timing-30hz",
  "timing-60hz",
  "platforming-physics",
  "rng-entities",
  "audio-synthesis",
  "text-p8scii",
  "advanced-raster",
  "memory-persistence",
  "input-progression",
  "large-code-progression",
] as const;

export type QualificationRiskDimension = typeof QUALIFICATION_RISK_DIMENSIONS[number];
export type QualificationPlanStatus = "selection-locked" | "qualification-complete";
export type QualificationCandidateStatus = "selected" | "qualified" | "failed-retained";

export interface QualificationPlanV1 {
  readonly schemaVersion: typeof QUALIFICATION_PLAN_SCHEMA_VERSION;
  readonly programId: string;
  readonly status: QualificationPlanStatus;
  readonly inventory: {
    readonly sourceKind: "user-provided-private-research-corpus";
    readonly encodedCartCount: number;
    readonly decodedCartCount: number;
    readonly inventorySha256: string;
    readonly audioInventorySha256: string;
    readonly compileAuditSha256: string;
    readonly duplicateGroupCount: number;
    readonly compilePassCount: number;
    readonly compileFailureCount: number;
  };
  readonly policy: {
    readonly requiredCandidateCount: 12;
    readonly requiredQualificationCount: 10;
    readonly requiresPrivateResearchAuthorization: true;
    readonly requiresFiniteEnding: true;
    readonly requiresPinnedCompilePass: true;
    readonly requiresIndependentEvidence: true;
  };
  readonly candidates: readonly QualificationCandidateV1[];
  readonly coverage: Readonly<Record<QualificationRiskDimension, QualificationRiskCoverageV1>>;
}

export interface QualificationCandidateV1 {
  readonly priority: number;
  readonly gameId: string;
  readonly title: string;
  readonly byline: string;
  readonly cart: {
    readonly filename: string;
    readonly encodedSha256: string;
    readonly decodedSha256: string;
    readonly version: number;
    readonly luaChars: number;
  };
  readonly runtime: {
    readonly updateRate: 30 | 60;
    readonly compileStatus: "passed";
    readonly featureIds: readonly string[];
    readonly audio: {
      readonly activeNoteCount: number;
      readonly musicPatternCount: number;
      readonly customInstrumentCount: number;
      readonly filteredSfxCount: number;
    };
  };
  readonly rights: {
    readonly researchStatus: "authorized-private-research";
    readonly formalReleaseStatus: "not-authorized";
    readonly evidence: string;
  };
  readonly finiteness: {
    readonly status: "source-confirmed" | "replay-confirmed";
    readonly sourceAnchors: readonly string[];
    readonly boundaries: readonly QualificationBoundaryV1[];
  };
  readonly riskCoverage: readonly QualificationRiskDimension[];
  readonly qualification: {
    readonly status: QualificationCandidateStatus;
    readonly workspaceId: string;
    readonly canonicalReplaySha256?: string;
    readonly hdReviewDecisionSha256?: string;
    readonly webPackageSha256?: string;
    readonly failureClass?: string;
  };
}

export interface QualificationBoundaryV1 {
  readonly id: string;
  readonly kind: "title" | "level-set" | "stage-set" | "boss-set" | "course-set" | "victory" | "ending" | "credits" | "persistence" | "restart";
  readonly count?: number;
}

export interface QualificationRiskCoverageV1 {
  readonly selectedCandidateIds: readonly string[];
  readonly qualifiedCandidateIds: readonly string[];
}

export interface QualificationPlanValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

type UnknownRecord = Record<string, unknown>;

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const CART_PATTERN = /^[^/\\]+\.p8$/;
const SOURCE_ANCHOR_PATTERN = /^lua-line:[1-9][0-9]*(?:-[1-9][0-9]*)?$/;
const BOUNDARY_KINDS = [
  "title", "level-set", "stage-set", "boss-set", "course-set", "victory", "ending", "credits", "persistence", "restart",
] as const;
const PROGRESSION_BOUNDARY_KINDS = new Set(["level-set", "stage-set", "boss-set", "course-set"]);
const COMPLETION_BOUNDARY_KINDS = new Set(["victory", "ending", "credits"]);

function record(value: unknown, path: string, errors: string[]): UnknownRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  return value as UnknownRecord;
}

function exactKeys(value: UnknownRecord, required: readonly string[], optional: readonly string[], path: string, errors: string[]): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!(key in value)) errors.push(`${path}.${key} is required`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${path}.${key} is not allowed`);
}

function stringValue(value: unknown, path: string, errors: string[], pattern?: RegExp): value is string {
  if (typeof value !== "string" || value.length === 0 || (pattern && !pattern.test(value))) {
    errors.push(`${path} must be a valid non-empty string`);
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

function hashValue(value: unknown, path: string, errors: string[]): value is string {
  return stringValue(value, path, errors, HASH_PATTERN);
}

function sortedUniqueStrings(value: unknown, path: string, errors: string[], pattern?: RegExp): string[] {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return [];
  }
  const result: string[] = [];
  const seen = new Set<string>();
  value.forEach((item, index) => {
    if (!stringValue(item, `${path}[${index}]`, errors, pattern)) return;
    if (seen.has(item)) errors.push(`${path}[${index}] duplicates ${item}`);
    seen.add(item);
    result.push(item);
  });
  return result;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateBoundary(value: unknown, path: string, errors: string[]): QualificationBoundaryV1 | undefined {
  const item = record(value, path, errors);
  if (!item) return undefined;
  exactKeys(item, ["id", "kind"], ["count"], path, errors);
  const hasId = stringValue(item.id, `${path}.id`, errors, ID_PATTERN);
  const hasKind = BOUNDARY_KINDS.includes(item.kind as typeof BOUNDARY_KINDS[number]);
  if (!hasKind) errors.push(`${path}.kind is unsupported`);
  if ("count" in item) integer(item.count, `${path}.count`, errors, 1);
  if (PROGRESSION_BOUNDARY_KINDS.has(item.kind as string) && !("count" in item)) {
    errors.push(`${path}.count is required for a progression boundary`);
  }
  return hasId && hasKind ? item as unknown as QualificationBoundaryV1 : undefined;
}

export function validateQualificationPlan(value: unknown): QualificationPlanValidationResult {
  const errors: string[] = [];
  const root = record(value, "$", errors);
  if (!root) return { ok: false, errors };
  exactKeys(root, ["schemaVersion", "programId", "status", "inventory", "policy", "candidates", "coverage"], [], "$", errors);
  if (root.schemaVersion !== QUALIFICATION_PLAN_SCHEMA_VERSION) errors.push(`$.schemaVersion must equal ${QUALIFICATION_PLAN_SCHEMA_VERSION}`);
  stringValue(root.programId, "$.programId", errors, ID_PATTERN);
  if (root.status !== "selection-locked" && root.status !== "qualification-complete") errors.push("$.status is unsupported");

  const inventory = record(root.inventory, "$.inventory", errors);
  if (inventory) {
    exactKeys(inventory, ["sourceKind", "encodedCartCount", "decodedCartCount", "inventorySha256", "audioInventorySha256", "compileAuditSha256", "duplicateGroupCount", "compilePassCount", "compileFailureCount"], [], "$.inventory", errors);
    if (inventory.sourceKind !== "user-provided-private-research-corpus") errors.push("$.inventory.sourceKind is unsupported");
    const encoded = integer(inventory.encodedCartCount, "$.inventory.encodedCartCount", errors, 1);
    const decoded = integer(inventory.decodedCartCount, "$.inventory.decodedCartCount", errors, 1);
    hashValue(inventory.inventorySha256, "$.inventory.inventorySha256", errors);
    hashValue(inventory.audioInventorySha256, "$.inventory.audioInventorySha256", errors);
    hashValue(inventory.compileAuditSha256, "$.inventory.compileAuditSha256", errors);
    integer(inventory.duplicateGroupCount, "$.inventory.duplicateGroupCount", errors, 0);
    const passed = integer(inventory.compilePassCount, "$.inventory.compilePassCount", errors, 0);
    const failed = integer(inventory.compileFailureCount, "$.inventory.compileFailureCount", errors, 0);
    if (encoded && decoded && inventory.encodedCartCount !== inventory.decodedCartCount) errors.push("$.inventory encoded and decoded cart counts must match");
    if (decoded && passed && failed && (inventory.compilePassCount as number) + (inventory.compileFailureCount as number) !== inventory.decodedCartCount) {
      errors.push("$.inventory compile pass and failure counts must equal decodedCartCount");
    }
  }

  const policy = record(root.policy, "$.policy", errors);
  if (policy) {
    exactKeys(policy, ["requiredCandidateCount", "requiredQualificationCount", "requiresPrivateResearchAuthorization", "requiresFiniteEnding", "requiresPinnedCompilePass", "requiresIndependentEvidence"], [], "$.policy", errors);
    if (policy.requiredCandidateCount !== 12) errors.push("$.policy.requiredCandidateCount must equal 12");
    if (policy.requiredQualificationCount !== 10) errors.push("$.policy.requiredQualificationCount must equal 10");
    for (const key of ["requiresPrivateResearchAuthorization", "requiresFiniteEnding", "requiresPinnedCompilePass", "requiresIndependentEvidence"] as const) {
      if (policy[key] !== true) errors.push(`$.policy.${key} must equal true`);
    }
  }

  const candidateIds = new Set<string>();
  const cartHashes = new Set<string>();
  const priorities = new Set<number>();
  const candidates: QualificationCandidateV1[] = [];
  if (!Array.isArray(root.candidates)) {
    errors.push("$.candidates must be an array");
  } else {
    if (root.candidates.length !== 12) errors.push("$.candidates must contain exactly 12 candidates");
    root.candidates.forEach((value, index) => {
      const path = `$.candidates[${index}]`;
      const item = record(value, path, errors);
      if (!item) return;
      exactKeys(item, ["priority", "gameId", "title", "byline", "cart", "runtime", "rights", "finiteness", "riskCoverage", "qualification"], [], path, errors);
      if (integer(item.priority, `${path}.priority`, errors, 1)) {
        const priority = item.priority as number;
        if (priority > 12) errors.push(`${path}.priority must not exceed 12`);
        if (priorities.has(priority)) errors.push(`${path}.priority duplicates ${priority}`);
        priorities.add(priority);
      }
      if (stringValue(item.gameId, `${path}.gameId`, errors, ID_PATTERN)) {
        if (candidateIds.has(item.gameId)) errors.push(`${path}.gameId duplicates ${item.gameId}`);
        candidateIds.add(item.gameId);
      }
      stringValue(item.title, `${path}.title`, errors);
      stringValue(item.byline, `${path}.byline`, errors);

      const cart = record(item.cart, `${path}.cart`, errors);
      if (cart) {
        exactKeys(cart, ["filename", "encodedSha256", "decodedSha256", "version", "luaChars"], [], `${path}.cart`, errors);
        stringValue(cart.filename, `${path}.cart.filename`, errors, CART_PATTERN);
        if (hashValue(cart.encodedSha256, `${path}.cart.encodedSha256`, errors)) {
          if (cartHashes.has(cart.encodedSha256)) errors.push(`${path}.cart.encodedSha256 duplicates another candidate`);
          cartHashes.add(cart.encodedSha256);
        }
        hashValue(cart.decodedSha256, `${path}.cart.decodedSha256`, errors);
        integer(cart.version, `${path}.cart.version`, errors, 1);
        integer(cart.luaChars, `${path}.cart.luaChars`, errors, 1);
      }

      const runtime = record(item.runtime, `${path}.runtime`, errors);
      if (runtime) {
        exactKeys(runtime, ["updateRate", "compileStatus", "featureIds", "audio"], [], `${path}.runtime`, errors);
        if (runtime.updateRate !== 30 && runtime.updateRate !== 60) errors.push(`${path}.runtime.updateRate must equal 30 or 60`);
        if (runtime.compileStatus !== "passed") errors.push(`${path}.runtime.compileStatus must equal passed`);
        sortedUniqueStrings(runtime.featureIds, `${path}.runtime.featureIds`, errors, ID_PATTERN);
        const audio = record(runtime.audio, `${path}.runtime.audio`, errors);
        if (audio) {
          exactKeys(audio, ["activeNoteCount", "musicPatternCount", "customInstrumentCount", "filteredSfxCount"], [], `${path}.runtime.audio`, errors);
          for (const key of ["activeNoteCount", "musicPatternCount", "customInstrumentCount", "filteredSfxCount"] as const) {
            integer(audio[key], `${path}.runtime.audio.${key}`, errors, 0);
          }
        }
      }

      const rights = record(item.rights, `${path}.rights`, errors);
      if (rights) {
        exactKeys(rights, ["researchStatus", "formalReleaseStatus", "evidence"], [], `${path}.rights`, errors);
        if (rights.researchStatus !== "authorized-private-research") errors.push(`${path}.rights.researchStatus must equal authorized-private-research`);
        if (rights.formalReleaseStatus !== "not-authorized") errors.push(`${path}.rights.formalReleaseStatus must equal not-authorized`);
        stringValue(rights.evidence, `${path}.rights.evidence`, errors, ID_PATTERN);
      }

      const finiteness = record(item.finiteness, `${path}.finiteness`, errors);
      if (finiteness) {
        exactKeys(finiteness, ["status", "sourceAnchors", "boundaries"], [], `${path}.finiteness`, errors);
        if (finiteness.status !== "source-confirmed" && finiteness.status !== "replay-confirmed") errors.push(`${path}.finiteness.status is unsupported`);
        const anchors = sortedUniqueStrings(finiteness.sourceAnchors, `${path}.finiteness.sourceAnchors`, errors, SOURCE_ANCHOR_PATTERN);
        if (anchors.length === 0) errors.push(`${path}.finiteness.sourceAnchors must not be empty`);
        if (!Array.isArray(finiteness.boundaries) || finiteness.boundaries.length === 0) {
          errors.push(`${path}.finiteness.boundaries must be a non-empty array`);
        } else {
          const boundaries = finiteness.boundaries.map((boundary, boundaryIndex) => validateBoundary(boundary, `${path}.finiteness.boundaries[${boundaryIndex}]`, errors)).filter((boundary): boundary is QualificationBoundaryV1 => Boolean(boundary));
          const boundaryIds = boundaries.map(({ id }) => id);
          if (new Set(boundaryIds).size !== boundaryIds.length) errors.push(`${path}.finiteness.boundaries contains duplicate ids`);
          if (!boundaries.some(({ kind }) => PROGRESSION_BOUNDARY_KINDS.has(kind))) errors.push(`${path}.finiteness requires a counted progression boundary`);
          if (!boundaries.some(({ kind }) => COMPLETION_BOUNDARY_KINDS.has(kind))) errors.push(`${path}.finiteness requires a victory, ending, or credits boundary`);
        }
      }

      const riskCoverage = sortedUniqueStrings(item.riskCoverage, `${path}.riskCoverage`, errors);
      if (riskCoverage.length === 0) errors.push(`${path}.riskCoverage must not be empty`);
      for (const risk of riskCoverage) if (!QUALIFICATION_RISK_DIMENSIONS.includes(risk as QualificationRiskDimension)) errors.push(`${path}.riskCoverage contains unsupported risk ${risk}`);

      const qualification = record(item.qualification, `${path}.qualification`, errors);
      if (qualification) {
        exactKeys(qualification, ["status", "workspaceId"], ["canonicalReplaySha256", "hdReviewDecisionSha256", "webPackageSha256", "failureClass"], `${path}.qualification`, errors);
        const status = qualification.status;
        if (status !== "selected" && status !== "qualified" && status !== "failed-retained") errors.push(`${path}.qualification.status is unsupported`);
        stringValue(qualification.workspaceId, `${path}.qualification.workspaceId`, errors, ID_PATTERN);
        const evidenceKeys = ["canonicalReplaySha256", "hdReviewDecisionSha256", "webPackageSha256"] as const;
        for (const key of evidenceKeys) if (key in qualification) hashValue(qualification[key], `${path}.qualification.${key}`, errors);
        if (status === "qualified" && evidenceKeys.some((key) => !(key in qualification))) errors.push(`${path}.qualification qualified status requires replay, HD decision, and Web package hashes`);
        if (status !== "qualified" && evidenceKeys.some((key) => key in qualification)) errors.push(`${path}.qualification unqualified status cannot carry completion hashes`);
        if (status === "failed-retained") stringValue(qualification.failureClass, `${path}.qualification.failureClass`, errors, ID_PATTERN);
        if (status !== "failed-retained" && "failureClass" in qualification) errors.push(`${path}.qualification.failureClass is only valid for failed-retained status`);
      }
      candidates.push(item as unknown as QualificationCandidateV1);
    });
  }
  for (let priority = 1; priority <= 12; priority += 1) if (!priorities.has(priority)) errors.push(`$.candidates must include priority ${priority}`);

  const coverage = record(root.coverage, "$.coverage", errors);
  const qualifiedCandidates = candidates.filter(({ qualification }) => qualification?.status === "qualified");
  if (coverage) {
    exactKeys(coverage, QUALIFICATION_RISK_DIMENSIONS, [], "$.coverage", errors);
    for (const risk of QUALIFICATION_RISK_DIMENSIONS) {
      const path = `$.coverage.${risk}`;
      const entry = record(coverage[risk], path, errors);
      if (!entry) continue;
      exactKeys(entry, ["selectedCandidateIds", "qualifiedCandidateIds"], [], path, errors);
      const selectedIds = sortedUniqueStrings(entry.selectedCandidateIds, `${path}.selectedCandidateIds`, errors, ID_PATTERN).sort();
      const qualifiedIds = sortedUniqueStrings(entry.qualifiedCandidateIds, `${path}.qualifiedCandidateIds`, errors, ID_PATTERN).sort();
      const expectedSelected = candidates.filter(({ riskCoverage }) => riskCoverage?.includes(risk)).map(({ gameId }) => gameId).sort();
      const expectedQualified = qualifiedCandidates.filter(({ riskCoverage }) => riskCoverage?.includes(risk)).map(({ gameId }) => gameId).sort();
      if (expectedSelected.length === 0) errors.push(`${path} must be covered by at least one selected candidate`);
      if (!arraysEqual(selectedIds, expectedSelected)) errors.push(`${path}.selectedCandidateIds must equal candidate declarations`);
      if (!arraysEqual(qualifiedIds, expectedQualified)) errors.push(`${path}.qualifiedCandidateIds must equal qualified candidate declarations`);
    }
  }

  if (root.status === "qualification-complete") {
    if (qualifiedCandidates.length < 10) errors.push("$.status qualification-complete requires at least 10 qualified candidates");
    for (const risk of QUALIFICATION_RISK_DIMENSIONS) {
      if (!qualifiedCandidates.some(({ riskCoverage }) => riskCoverage?.includes(risk))) errors.push(`$.status qualification-complete requires qualified coverage for ${risk}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function assertQualificationPlan(value: unknown): asserts value is QualificationPlanV1 {
  const result = validateQualificationPlan(value);
  if (!result.ok) throw new Error(`Invalid qualification plan:\n${result.errors.join("\n")}`);
}
