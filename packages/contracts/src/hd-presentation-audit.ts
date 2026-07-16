import type { HdIdentityMapV1 } from "./hd-identity-map.js";

export const HD_PRESENTATION_AUDIT_SCHEMA_VERSION = "aico8.hd-presentation-audit.v1" as const;

export type SourceVisualTokenKind = "scene" | "tile" | "sprite" | "draw-command" | "text-role" | "ui";

export interface SourceVisualTokenDefinition {
  id: string;
  kind: SourceVisualTokenKind;
  identityElementId: string;
}

export interface HdFrameObservation {
  update: number;
  sceneId: string;
  sourceTokenIds: readonly string[];
  mixedIndexedFragments: number;
  diagnosticReferenceSwitches: number;
  compatibilityStateSha256: string;
}

export interface HdPresentationAuditV1 {
  schemaVersion: typeof HD_PRESENTATION_AUDIT_SCHEMA_VERSION;
  gameId: string;
  canonicalReplayId: string;
  identityMapSha256: string;
  visualGrammarId: string;
  status: "draft" | "accepted";
  totalLogicalUpdates: number;
  observationRuns: Array<{
    id: string;
    kind: "canonical-replay" | "reachable-state-probe";
    startUpdate: number;
    endUpdateExclusive: number;
  }>;
  observedSceneIds: string[];
  sourceTokens: Array<{
    id: string;
    kind: SourceVisualTokenKind | "unknown";
    identityElementId: string | null;
    observationCount: number;
  }>;
  coverage: {
    reachableElementIds: string[];
    mappedElementIds: string[];
    unmappedSourceTokenIds: string[];
    mixedIndexedFragments: number;
    diagnosticReferenceSwitches: number;
  };
  invariance: {
    mode: "hd-off-vs-hd-on";
    stateHashAlgorithm: "sha256";
    updatesCompared: number;
    mismatchUpdateIds: number[];
  };
  regressions: Array<{
    id: string;
    category: "coverage-mutation" | "state-mutation" | "mixed-presentation-mutation";
    rejected: true;
  }>;
}

export interface HdPresentationAuditValidationResult {
  valid: boolean;
  errors: string[];
}

type BuildAuditOptions = {
  identityMap: HdIdentityMapV1;
  identityMapSha256: string;
  catalog: readonly SourceVisualTokenDefinition[];
  hdOffFrames: readonly HdFrameObservation[];
  hdOnFrames: readonly HdFrameObservation[];
  status?: "draft" | "accepted";
  observationRuns?: HdPresentationAuditV1["observationRuns"];
  regressions?: HdPresentationAuditV1["regressions"];
};

const idPattern = /^[a-z0-9][a-z0-9._:-]{1,127}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const tokenKinds = new Set<SourceVisualTokenKind>(["scene", "tile", "sprite", "draw-command", "text-role", "ui"]);

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  const a = sortedUnique(left);
  const b = sortedUnique(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function frameSequenceErrors(frames: readonly HdFrameObservation[], label: string): string[] {
  const errors: string[] = [];
  for (const [index, frame] of frames.entries()) {
    if (frame.update !== index) errors.push(`${label}[${index}].update must equal ${index}`);
    if (!idPattern.test(frame.sceneId)) errors.push(`${label}[${index}].sceneId is invalid`);
    if (!hashPattern.test(frame.compatibilityStateSha256)) errors.push(`${label}[${index}].compatibilityStateSha256 is invalid`);
    if (!Number.isInteger(frame.mixedIndexedFragments) || frame.mixedIndexedFragments < 0) {
      errors.push(`${label}[${index}].mixedIndexedFragments must be a non-negative integer`);
    }
    if (!Number.isInteger(frame.diagnosticReferenceSwitches) || frame.diagnosticReferenceSwitches < 0) {
      errors.push(`${label}[${index}].diagnosticReferenceSwitches must be a non-negative integer`);
    }
    if (new Set(frame.sourceTokenIds).size !== frame.sourceTokenIds.length) {
      errors.push(`${label}[${index}].sourceTokenIds must not contain duplicates`);
    }
  }
  return errors;
}

/**
 * Aggregates raw, per-update source observations. Unknown source tokens are kept
 * as first-class failures instead of disappearing through renderer fallthrough.
 */
export function buildHdPresentationAudit(options: BuildAuditOptions): HdPresentationAuditV1 {
  const catalog = new Map<string, SourceVisualTokenDefinition>();
  for (const definition of options.catalog) {
    if (catalog.has(definition.id)) throw new TypeError(`Duplicate HD source token ${definition.id}`);
    catalog.set(definition.id, definition);
  }
  const sequenceErrors = [
    ...frameSequenceErrors(options.hdOffFrames, "hdOffFrames"),
    ...frameSequenceErrors(options.hdOnFrames, "hdOnFrames"),
  ];
  if (sequenceErrors.length > 0) throw new TypeError(`Invalid HD frame sequence:\n- ${sequenceErrors.join("\n- ")}`);
  if (options.hdOffFrames.length !== options.hdOnFrames.length) {
    throw new TypeError("HD off/on frame sequences must have identical lengths");
  }

  const counts = new Map<string, number>();
  let mixedIndexedFragments = 0;
  let diagnosticReferenceSwitches = 0;
  const mismatchUpdateIds: number[] = [];
  for (let index = 0; index < options.hdOnFrames.length; index += 1) {
    const on = options.hdOnFrames[index]!;
    const off = options.hdOffFrames[index]!;
    if (on.compatibilityStateSha256 !== off.compatibilityStateSha256) mismatchUpdateIds.push(index);
    mixedIndexedFragments += on.mixedIndexedFragments;
    diagnosticReferenceSwitches += on.diagnosticReferenceSwitches;
    for (const tokenId of on.sourceTokenIds) counts.set(tokenId, (counts.get(tokenId) ?? 0) + 1);
  }

  const sourceTokens = [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([id, observationCount]) => {
    const definition = catalog.get(id);
    return {
      id,
      kind: definition?.kind ?? "unknown" as const,
      identityElementId: definition?.identityElementId ?? null,
      observationCount,
    };
  });
  const unmappedSourceTokenIds = sourceTokens.filter(({ identityElementId }) => identityElementId === null).map(({ id }) => id);
  const reachableElementIds = sortedUnique(sourceTokens.flatMap(({ identityElementId }) => identityElementId ? [identityElementId] : []));
  const declaredMapped = new Set(options.identityMap.coverage.mappedElementIds);
  const mappedElementIds = reachableElementIds.filter((id) => declaredMapped.has(id));
  const observationRuns = options.observationRuns ?? [{
    id: "canonical-replay",
    kind: "canonical-replay" as const,
    startUpdate: 0,
    endUpdateExclusive: options.hdOnFrames.length,
  }];

  return {
    schemaVersion: HD_PRESENTATION_AUDIT_SCHEMA_VERSION,
    gameId: options.identityMap.gameId,
    canonicalReplayId: options.identityMap.canonicalReplayId,
    identityMapSha256: options.identityMapSha256,
    visualGrammarId: options.identityMap.visualGrammarId,
    status: options.status ?? "draft",
    totalLogicalUpdates: options.hdOnFrames.length,
    observationRuns,
    observedSceneIds: sortedUnique(options.hdOnFrames.map(({ sceneId }) => sceneId)),
    sourceTokens,
    coverage: {
      reachableElementIds,
      mappedElementIds,
      unmappedSourceTokenIds,
      mixedIndexedFragments,
      diagnosticReferenceSwitches,
    },
    invariance: {
      mode: "hd-off-vs-hd-on",
      stateHashAlgorithm: "sha256",
      updatesCompared: options.hdOnFrames.length,
      mismatchUpdateIds,
    },
    regressions: options.regressions ?? [],
  };
}

export function validateHdPresentationAudit(
  value: unknown,
  identityMap?: HdIdentityMapV1,
): HdPresentationAuditValidationResult {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { valid: false, errors: ["$ must be an object"] };
  const audit = value as Partial<HdPresentationAuditV1>;
  const accepted = audit.status === "accepted";
  if (audit.schemaVersion !== HD_PRESENTATION_AUDIT_SCHEMA_VERSION) errors.push(`$.schemaVersion must equal ${HD_PRESENTATION_AUDIT_SCHEMA_VERSION}`);
  for (const [path, candidate] of [["$.gameId", audit.gameId], ["$.canonicalReplayId", audit.canonicalReplayId], ["$.visualGrammarId", audit.visualGrammarId]] as const) {
    if (typeof candidate !== "string" || !idPattern.test(candidate)) errors.push(`${path} is invalid`);
  }
  if (typeof audit.identityMapSha256 !== "string" || !hashPattern.test(audit.identityMapSha256)) errors.push("$.identityMapSha256 is invalid");
  if (!accepted && audit.status !== "draft") errors.push("$.status must be draft or accepted");
  if (!Number.isInteger(audit.totalLogicalUpdates) || (audit.totalLogicalUpdates ?? 0) <= 0) errors.push("$.totalLogicalUpdates must be a positive integer");
  if (!Array.isArray(audit.observationRuns) || audit.observationRuns.length === 0) {
    errors.push("$.observationRuns must contain the canonical replay run");
  } else {
    let nextStart = 0;
    const runIds = new Set<string>();
    for (const [index, run] of audit.observationRuns.entries()) {
      if (!run || typeof run !== "object") { errors.push(`$.observationRuns[${index}] must be an object`); continue; }
      if (!idPattern.test(run.id) || runIds.has(run.id)) errors.push(`$.observationRuns[${index}].id is invalid or duplicate`);
      runIds.add(run.id);
      if (!(["canonical-replay", "reachable-state-probe"] as const).includes(run.kind)) errors.push(`$.observationRuns[${index}].kind is invalid`);
      if (run.startUpdate !== nextStart || !Number.isInteger(run.endUpdateExclusive) || run.endUpdateExclusive <= run.startUpdate) {
        errors.push(`$.observationRuns[${index}] must form a non-empty contiguous range`);
      }
      nextStart = run.endUpdateExclusive;
    }
    if (audit.observationRuns[0]?.kind !== "canonical-replay") errors.push("$.observationRuns[0] must be the canonical replay");
    if (nextStart !== audit.totalLogicalUpdates) errors.push("$.observationRuns must cover totalLogicalUpdates exactly");
  }
  if (!Array.isArray(audit.observedSceneIds) || audit.observedSceneIds.length === 0
    || new Set(audit.observedSceneIds).size !== audit.observedSceneIds.length
    || audit.observedSceneIds.some((id) => !idPattern.test(id))) {
    errors.push("$.observedSceneIds must be a non-empty unique list");
  }

  if (!Array.isArray(audit.sourceTokens) || audit.sourceTokens.length === 0) {
    errors.push("$.sourceTokens must contain observed raw source tokens");
  } else {
    const ids = new Set<string>();
    for (const [index, token] of audit.sourceTokens.entries()) {
      if (!token || typeof token !== "object") { errors.push(`$.sourceTokens[${index}] must be an object`); continue; }
      if (!idPattern.test(token.id)) errors.push(`$.sourceTokens[${index}].id is invalid`);
      else if (ids.has(token.id)) errors.push(`$.sourceTokens[${index}].id must be unique`);
      ids.add(token.id);
      if (token.kind !== "unknown" && !tokenKinds.has(token.kind)) errors.push(`$.sourceTokens[${index}].kind is invalid`);
      if (token.identityElementId !== null && !idPattern.test(token.identityElementId)) errors.push(`$.sourceTokens[${index}].identityElementId is invalid`);
      if (!Number.isInteger(token.observationCount) || token.observationCount <= 0) errors.push(`$.sourceTokens[${index}].observationCount must be positive`);
      if (accepted && (token.kind === "unknown" || token.identityElementId === null)) errors.push(`$.sourceTokens[${index}] is unmapped`);
    }
  }

  const coverage = audit.coverage;
  if (!coverage || typeof coverage !== "object") {
    errors.push("$.coverage is required");
  } else {
    for (const key of ["reachableElementIds", "mappedElementIds", "unmappedSourceTokenIds"] as const) {
      const list = coverage[key];
      if (!Array.isArray(list) || new Set(list).size !== list.length || list.some((id) => !idPattern.test(id))) errors.push(`$.coverage.${key} must be a unique ID list`);
    }
    for (const key of ["mixedIndexedFragments", "diagnosticReferenceSwitches"] as const) {
      if (!Number.isInteger(coverage[key]) || coverage[key] < 0) errors.push(`$.coverage.${key} must be a non-negative integer`);
      else if (accepted && coverage[key] !== 0) errors.push(`$.coverage.${key} must be zero before acceptance`);
    }
    if (accepted && coverage.unmappedSourceTokenIds.length !== 0) errors.push("$.coverage.unmappedSourceTokenIds must be empty before acceptance");
    if (accepted && !sameStrings(coverage.reachableElementIds, coverage.mappedElementIds)) errors.push("$.coverage must map every reachable element before acceptance");
  }

  const invariance = audit.invariance;
  if (!invariance || typeof invariance !== "object") {
    errors.push("$.invariance is required");
  } else {
    if (invariance.mode !== "hd-off-vs-hd-on" || invariance.stateHashAlgorithm !== "sha256") errors.push("$.invariance mode/hash algorithm is invalid");
    if (!Number.isInteger(invariance.updatesCompared) || invariance.updatesCompared !== audit.totalLogicalUpdates) errors.push("$.invariance.updatesCompared must equal totalLogicalUpdates");
    if (!Array.isArray(invariance.mismatchUpdateIds) || new Set(invariance.mismatchUpdateIds).size !== invariance.mismatchUpdateIds.length
      || invariance.mismatchUpdateIds.some((update) => !Number.isInteger(update) || update < 0 || update >= (audit.totalLogicalUpdates ?? 0))) {
      errors.push("$.invariance.mismatchUpdateIds is invalid");
    } else if (accepted && invariance.mismatchUpdateIds.length !== 0) errors.push("$.invariance.mismatchUpdateIds must be empty before acceptance");
  }

  if (!Array.isArray(audit.regressions)) errors.push("$.regressions is required");
  else if (accepted && !audit.regressions.some(({ category, rejected }) => category === "coverage-mutation" && rejected === true)) {
    errors.push("$.regressions must prove rejection of a coverage mutation before acceptance");
  }

  if (identityMap) {
    if (accepted && identityMap.status !== "accepted") errors.push("$.status cannot be accepted before the identity map is accepted");
    if (audit.gameId !== identityMap.gameId) errors.push("$.gameId does not match the identity map");
    if (audit.canonicalReplayId !== identityMap.canonicalReplayId) errors.push("$.canonicalReplayId does not match the identity map");
    if (audit.visualGrammarId !== identityMap.visualGrammarId) errors.push("$.visualGrammarId does not match the identity map");
    if (coverage && !sameStrings(coverage.reachableElementIds, identityMap.coverage.reachableElementIds)) {
      errors.push("$.coverage.reachableElementIds does not match the identity map");
    }
    const identityIds = new Set(identityMap.elements.map(({ id }) => id));
    for (const token of audit.sourceTokens ?? []) {
      if (token.identityElementId !== null && !identityIds.has(token.identityElementId)) errors.push(`$.sourceTokens references unknown identity element ${token.identityElementId}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function assertHdPresentationAudit(value: unknown, identityMap?: HdIdentityMapV1): asserts value is HdPresentationAuditV1 {
  const result = validateHdPresentationAudit(value, identityMap);
  if (!result.valid) throw new TypeError(`Invalid HD presentation audit:\n- ${result.errors.join("\n- ")}`);
}
