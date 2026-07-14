export const INPUT_TRACE_SCHEMA_VERSION = "aico8.input-trace.v1" as const;
export const REPLAY_SCHEMA_VERSION = "aico8.replay.v1" as const;

export type UpdateRate = 30 | 60;
export type ButtonMask = number;

export interface CleanInitialState {
  kind: "clean";
  persistenceSha256: string;
}

export interface PriorReplayInitialState {
  kind: "prior-replay";
  persistenceSha256: string;
  priorReplayId: string;
}

export type InitialState = CleanInitialState | PriorReplayInitialState;

export interface InputSpan {
  startUpdate: number;
  endUpdateExclusive: number;
  players: [ButtonMask] | [ButtonMask, ButtonMask];
}

export interface InputTraceV1 {
  schemaVersion: typeof INPUT_TRACE_SCHEMA_VERSION;
  updateHz: UpdateRate;
  totalUpdates: number;
  initialState: InitialState;
  spans: InputSpan[];
}

export interface CanonicalityDeclaration {
  mode: "canonical-real-input";
  cartMutation: "none";
  compatibilityStateMutation: "none";
  inputSource: "pico8-buttons-only" | "pico8-buttons-plus-source-menuitems";
  logicalUpdatePolicy: "execute-all";
  testHooks: false;
  wallClockAcceleration: boolean;
}

export interface ReplayHostAction {
  kind: "source-authored-pause-menu-item";
  atUpdate: number;
  index: number;
  label: string;
  filter: ButtonMask;
  buttons: ButtonMask;
  keepOpen: boolean;
}

export type MilestoneKind =
  | "level-complete"
  | "progression-boundary"
  | "ending-reached"
  | "game-complete"
  | "restart-complete";

export interface ReplayMilestone {
  id: string;
  kind: MilestoneKind;
  atUpdate: number;
  levelOrdinal?: number;
}

export interface ReplayCheckpoint {
  id: string;
  atUpdate: number;
  hashes: {
    stateSha256: string;
    rasterSha256?: string;
    audioSha256?: string;
    semanticSha256?: string;
    persistenceSha256?: string;
  };
}

export interface ReplayV1 {
  schemaVersion: typeof REPLAY_SCHEMA_VERSION;
  replayId: string;
  gameId: string;
  cartSha256: string;
  runtime: {
    id: string;
    revision: string;
  };
  canonicality: CanonicalityDeclaration;
  trace: InputTraceV1;
  hostActions?: ReplayHostAction[];
  requiredMilestoneIds: string[];
  milestones: ReplayMilestone[];
  checkpoints: ReplayCheckpoint[];
  result: {
    completed: boolean;
    finalMilestoneId: string;
    finalStateSha256: string;
  };
  producer: {
    name: string;
    version: string;
    sourceRevision: string;
  };
}

export interface ReplayValidationResult {
  valid: boolean;
  errors: string[];
}

type JsonRecord = Record<string, unknown>;

const idPattern = /^[a-z0-9][a-z0-9._-]{1,127}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const milestoneKinds = new Set<MilestoneKind>([
  "level-complete",
  "progression-boundary",
  "ending-reached",
  "game-complete",
  "restart-complete",
]);

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
  for (const key of required) {
    if (!(key in value)) errors.push(`${path}.${key} is required`);
  }
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) errors.push(`${path}.${key} is not allowed`);
  }
}

function checkId(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    errors.push(`${path} must match ${idPattern.source}`);
    return false;
  }
  return true;
}

function checkHash(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value !== "string" || !hashPattern.test(value)) {
    errors.push(`${path} must be a lowercase SHA-256 hex digest`);
    return false;
  }
  return true;
}

function checkInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  path: string,
  errors: string[],
): value is number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    errors.push(`${path} must be an integer from ${minimum} through ${maximum}`);
    return false;
  }
  return true;
}

function validateInitialState(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("$.trace.initialState must be an object");
    return;
  }
  if (value.kind === "clean") {
    checkKeys(value, ["kind", "persistenceSha256"], ["kind", "persistenceSha256"], "$.trace.initialState", errors);
  } else if (value.kind === "prior-replay") {
    checkKeys(
      value,
      ["kind", "persistenceSha256", "priorReplayId"],
      ["kind", "persistenceSha256", "priorReplayId"],
      "$.trace.initialState",
      errors,
    );
    checkId(value.priorReplayId, "$.trace.initialState.priorReplayId", errors);
  } else {
    errors.push("$.trace.initialState.kind must be clean or prior-replay");
  }
  checkHash(value.persistenceSha256, "$.trace.initialState.persistenceSha256", errors);
}

function validateTrace(value: unknown, errors: string[]): number | undefined {
  if (!isRecord(value)) {
    errors.push("$.trace must be an object");
    return undefined;
  }
  checkKeys(
    value,
    ["schemaVersion", "updateHz", "totalUpdates", "initialState", "spans"],
    ["schemaVersion", "updateHz", "totalUpdates", "initialState", "spans"],
    "$.trace",
    errors,
  );
  if (value.schemaVersion !== INPUT_TRACE_SCHEMA_VERSION) {
    errors.push(`$.trace.schemaVersion must equal ${INPUT_TRACE_SCHEMA_VERSION}`);
  }
  if (value.updateHz !== 30 && value.updateHz !== 60) errors.push("$.trace.updateHz must be 30 or 60");
  const totalValid = checkInteger(value.totalUpdates, 1, Number.MAX_SAFE_INTEGER, "$.trace.totalUpdates", errors);
  validateInitialState(value.initialState, errors);
  if (!Array.isArray(value.spans) || value.spans.length === 0) {
    errors.push("$.trace.spans must contain at least one span");
    return totalValid ? (value.totalUpdates as number) : undefined;
  }

  let expectedStart = 0;
  for (const [index, rawSpan] of value.spans.entries()) {
    const path = `$.trace.spans[${index}]`;
    if (!isRecord(rawSpan)) {
      errors.push(`${path} must be an object`);
      continue;
    }
    checkKeys(rawSpan, ["startUpdate", "endUpdateExclusive", "players"], ["startUpdate", "endUpdateExclusive", "players"], path, errors);
    const startValid = checkInteger(rawSpan.startUpdate, 0, Number.MAX_SAFE_INTEGER, `${path}.startUpdate`, errors);
    const endValid = checkInteger(rawSpan.endUpdateExclusive, 1, Number.MAX_SAFE_INTEGER, `${path}.endUpdateExclusive`, errors);
    if (startValid && rawSpan.startUpdate !== expectedStart) {
      errors.push(`${path}.startUpdate must be ${expectedStart}; trace spans must be contiguous`);
    }
    if (startValid && endValid && (rawSpan.endUpdateExclusive as number) <= (rawSpan.startUpdate as number)) {
      errors.push(`${path}.endUpdateExclusive must be greater than startUpdate`);
    }
    if (endValid) expectedStart = rawSpan.endUpdateExclusive as number;

    if (!Array.isArray(rawSpan.players) || rawSpan.players.length < 1 || rawSpan.players.length > 2) {
      errors.push(`${path}.players must contain one or two button masks`);
    } else {
      rawSpan.players.forEach((mask, player) => {
        checkInteger(mask, 0, 63, `${path}.players[${player}]`, errors);
      });
    }
  }
  if (totalValid && expectedStart !== value.totalUpdates) {
    errors.push(`$.trace.spans must end at totalUpdates ${value.totalUpdates}`);
  }
  return totalValid ? (value.totalUpdates as number) : undefined;
}

function validateCanonicality(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("$.canonicality must be an object");
    return;
  }
  const expected = {
    mode: "canonical-real-input",
    cartMutation: "none",
    compatibilityStateMutation: "none",
    logicalUpdatePolicy: "execute-all",
    testHooks: false,
  } as const;
  checkKeys(
    value,
    [...Object.keys(expected), "inputSource", "wallClockAcceleration"],
    [...Object.keys(expected), "inputSource", "wallClockAcceleration"],
    "$.canonicality",
    errors,
  );
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue) errors.push(`$.canonicality.${key} must equal ${String(expectedValue)}`);
  }
  if (value.inputSource !== "pico8-buttons-only"
    && value.inputSource !== "pico8-buttons-plus-source-menuitems") {
    errors.push("$.canonicality.inputSource must name the supported button/menuitem input boundary");
  }
  if (typeof value.wallClockAcceleration !== "boolean") {
    errors.push("$.canonicality.wallClockAcceleration must be boolean");
  }
}

function validateHostActions(
  value: unknown,
  totalUpdates: number | undefined,
  inputSource: unknown,
  errors: string[],
): void {
  if (value === undefined) {
    if (inputSource === "pico8-buttons-plus-source-menuitems") {
      errors.push("$.hostActions is required when canonicality declares source menuitems");
    }
    return;
  }
  if (!Array.isArray(value) || value.length === 0) {
    errors.push("$.hostActions must contain at least one source-authored menu action");
    return;
  }
  if (inputSource !== "pico8-buttons-plus-source-menuitems") {
    errors.push("$.canonicality.inputSource must declare source menuitems when $.hostActions is present");
  }
  let lastUpdate = -1;
  for (const [index, rawAction] of value.entries()) {
    const path = `$.hostActions[${index}]`;
    if (!isRecord(rawAction)) {
      errors.push(`${path} must be an object`);
      continue;
    }
    const keys = ["kind", "atUpdate", "index", "label", "filter", "buttons", "keepOpen"];
    checkKeys(rawAction, keys, keys, path, errors);
    if (rawAction.kind !== "source-authored-pause-menu-item") {
      errors.push(`${path}.kind must equal source-authored-pause-menu-item`);
    }
    const maximum = totalUpdates === undefined ? Number.MAX_SAFE_INTEGER : Math.max(0, totalUpdates - 1);
    if (checkInteger(rawAction.atUpdate, 0, maximum, `${path}.atUpdate`, errors)) {
      if ((rawAction.atUpdate as number) < lastUpdate) errors.push(`${path}.atUpdate must be ordered`);
      lastUpdate = rawAction.atUpdate as number;
    }
    checkInteger(rawAction.index, 1, 5, `${path}.index`, errors);
    if (typeof rawAction.label !== "string" || rawAction.label.length < 1 || rawAction.label.length > 16) {
      errors.push(`${path}.label must contain 1 through 16 characters`);
    }
    checkInteger(rawAction.filter, 0, 63, `${path}.filter`, errors);
    checkInteger(rawAction.buttons, 0, 63, `${path}.buttons`, errors);
    if (typeof rawAction.keepOpen !== "boolean") errors.push(`${path}.keepOpen must be boolean`);
  }
}

function validateMilestones(value: unknown, totalUpdates: number | undefined, errors: string[]): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(value) || value.length === 0) {
    errors.push("$.milestones must contain at least one milestone");
    return ids;
  }
  let lastUpdate = 0;
  for (const [index, rawMilestone] of value.entries()) {
    const path = `$.milestones[${index}]`;
    if (!isRecord(rawMilestone)) {
      errors.push(`${path} must be an object`);
      continue;
    }
    checkKeys(rawMilestone, ["id", "kind", "atUpdate", "levelOrdinal"], ["id", "kind", "atUpdate"], path, errors);
    if (checkId(rawMilestone.id, `${path}.id`, errors)) {
      if (ids.has(rawMilestone.id)) errors.push(`${path}.id must be unique`);
      ids.add(rawMilestone.id);
    }
    if (typeof rawMilestone.kind !== "string" || !milestoneKinds.has(rawMilestone.kind as MilestoneKind)) {
      errors.push(`${path}.kind is not a supported milestone kind`);
    }
    const maximum = totalUpdates ?? Number.MAX_SAFE_INTEGER;
    if (checkInteger(rawMilestone.atUpdate, 1, maximum, `${path}.atUpdate`, errors)) {
      if ((rawMilestone.atUpdate as number) < lastUpdate) errors.push(`${path}.atUpdate must be ordered`);
      lastUpdate = rawMilestone.atUpdate as number;
    }
    if ("levelOrdinal" in rawMilestone) {
      checkInteger(rawMilestone.levelOrdinal, 1, Number.MAX_SAFE_INTEGER, `${path}.levelOrdinal`, errors);
      if (rawMilestone.kind !== "level-complete") errors.push(`${path}.levelOrdinal is allowed only for level-complete`);
    } else if (rawMilestone.kind === "level-complete") {
      errors.push(`${path}.levelOrdinal is required for level-complete`);
    }
  }
  return ids;
}

function validateCheckpoints(value: unknown, totalUpdates: number | undefined, errors: string[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push("$.checkpoints must contain at least one checkpoint");
    return;
  }
  const ids = new Set<string>();
  let lastUpdate = 0;
  for (const [index, rawCheckpoint] of value.entries()) {
    const path = `$.checkpoints[${index}]`;
    if (!isRecord(rawCheckpoint)) {
      errors.push(`${path} must be an object`);
      continue;
    }
    checkKeys(rawCheckpoint, ["id", "atUpdate", "hashes"], ["id", "atUpdate", "hashes"], path, errors);
    if (checkId(rawCheckpoint.id, `${path}.id`, errors)) {
      if (ids.has(rawCheckpoint.id)) errors.push(`${path}.id must be unique`);
      ids.add(rawCheckpoint.id);
    }
    const maximum = totalUpdates ?? Number.MAX_SAFE_INTEGER;
    if (checkInteger(rawCheckpoint.atUpdate, 0, maximum, `${path}.atUpdate`, errors)) {
      if ((rawCheckpoint.atUpdate as number) < lastUpdate) errors.push(`${path}.atUpdate must be ordered`);
      lastUpdate = rawCheckpoint.atUpdate as number;
    }
    if (!isRecord(rawCheckpoint.hashes)) {
      errors.push(`${path}.hashes must be an object`);
      continue;
    }
    const hashKeys = ["stateSha256", "rasterSha256", "audioSha256", "semanticSha256", "persistenceSha256"];
    checkKeys(rawCheckpoint.hashes, hashKeys, ["stateSha256"], `${path}.hashes`, errors);
    for (const key of hashKeys) {
      if (key in rawCheckpoint.hashes) checkHash(rawCheckpoint.hashes[key], `${path}.hashes.${key}`, errors);
    }
  }
}

export function validateReplay(value: unknown): ReplayValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ["$ must be an object"] };
  const topLevelKeys = [
    "schemaVersion",
    "replayId",
    "gameId",
    "cartSha256",
    "runtime",
    "canonicality",
    "trace",
    "hostActions",
    "requiredMilestoneIds",
    "milestones",
    "checkpoints",
    "result",
    "producer",
  ];
  checkKeys(value, topLevelKeys, topLevelKeys.filter((key) => key !== "hostActions"), "$", errors);
  if (value.schemaVersion !== REPLAY_SCHEMA_VERSION) errors.push(`$.schemaVersion must equal ${REPLAY_SCHEMA_VERSION}`);
  checkId(value.replayId, "$.replayId", errors);
  checkId(value.gameId, "$.gameId", errors);
  checkHash(value.cartSha256, "$.cartSha256", errors);

  if (!isRecord(value.runtime)) {
    errors.push("$.runtime must be an object");
  } else {
    checkKeys(value.runtime, ["id", "revision"], ["id", "revision"], "$.runtime", errors);
    checkId(value.runtime.id, "$.runtime.id", errors);
    if (typeof value.runtime.revision !== "string" || value.runtime.revision.length === 0) {
      errors.push("$.runtime.revision must be a non-empty string");
    }
  }
  validateCanonicality(value.canonicality, errors);
  const totalUpdates = validateTrace(value.trace, errors);
  validateHostActions(
    value.hostActions,
    totalUpdates,
    isRecord(value.canonicality) ? value.canonicality.inputSource : undefined,
    errors,
  );
  const milestoneIds = validateMilestones(value.milestones, totalUpdates, errors);
  validateCheckpoints(value.checkpoints, totalUpdates, errors);

  if (!Array.isArray(value.requiredMilestoneIds) || value.requiredMilestoneIds.length === 0) {
    errors.push("$.requiredMilestoneIds must contain at least one ID");
  } else {
    const required = new Set<string>();
    value.requiredMilestoneIds.forEach((id, index) => {
      if (checkId(id, `$.requiredMilestoneIds[${index}]`, errors)) {
        if (required.has(id)) errors.push(`$.requiredMilestoneIds[${index}] must be unique`);
        required.add(id);
        if (!milestoneIds.has(id)) errors.push(`$.requiredMilestoneIds[${index}] does not resolve to a milestone`);
      }
    });
  }

  if (!isRecord(value.result)) {
    errors.push("$.result must be an object");
  } else {
    checkKeys(value.result, ["completed", "finalMilestoneId", "finalStateSha256"], ["completed", "finalMilestoneId", "finalStateSha256"], "$.result", errors);
    if (typeof value.result.completed !== "boolean") errors.push("$.result.completed must be boolean");
    if (checkId(value.result.finalMilestoneId, "$.result.finalMilestoneId", errors) && !milestoneIds.has(value.result.finalMilestoneId)) {
      errors.push("$.result.finalMilestoneId does not resolve to a milestone");
    }
    checkHash(value.result.finalStateSha256, "$.result.finalStateSha256", errors);
    if (value.result.completed === true && Array.isArray(value.requiredMilestoneIds)) {
      const missing = value.requiredMilestoneIds.filter((id) => typeof id === "string" && !milestoneIds.has(id));
      if (missing.length > 0) errors.push("$.result.completed cannot be true while required milestones are missing");
    }
  }

  if (!isRecord(value.producer)) {
    errors.push("$.producer must be an object");
  } else {
    checkKeys(value.producer, ["name", "version", "sourceRevision"], ["name", "version", "sourceRevision"], "$.producer", errors);
    for (const key of ["name", "version", "sourceRevision"] as const) {
      if (typeof value.producer[key] !== "string" || value.producer[key].length === 0) {
        errors.push(`$.producer.${key} must be a non-empty string`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function assertReplay(value: unknown): asserts value is ReplayV1 {
  const result = validateReplay(value);
  if (!result.valid) throw new Error(`Invalid Replay v1:\n${result.errors.join("\n")}`);
}
