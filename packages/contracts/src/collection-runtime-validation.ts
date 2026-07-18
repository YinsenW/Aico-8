export const FIXED_COLLECTION_RUNTIME_VALIDATION_SCHEMA_VERSION =
  "aico8.fixed-collection-runtime-validation.v1" as const;

export const FIXED_COLLECTION_TIMING_METHODS = ["performance.now"] as const;
export const FIXED_COLLECTION_HEAP_METHODS = [
  "performance.memory.usedJSHeapSize",
] as const;
export const FIXED_COLLECTION_IDENTITY_METHODS = ["child-handshake-token"] as const;
export const FIXED_COLLECTION_STORAGE_METHODS = ["namespaced-local-storage-round-trip"] as const;

export type FixedCollectionTimingMethod = (typeof FIXED_COLLECTION_TIMING_METHODS)[number];
export type FixedCollectionHeapMethod = (typeof FIXED_COLLECTION_HEAP_METHODS)[number];
export type FixedCollectionIdentityMethod = (typeof FIXED_COLLECTION_IDENTITY_METHODS)[number];
export type FixedCollectionStorageMethod = (typeof FIXED_COLLECTION_STORAGE_METHODS)[number];
export type FixedCollectionRuntimeValidationStatus = "passed" | "failed";

export interface FixedCollectionRuntimeActivationV1 {
  readonly documentIdentity: string;
  readonly runtimeIdentity: string;
  readonly milliseconds: number;
  readonly jsHeapBytes: number;
}

export interface FixedCollectionRuntimeModuleValidationV1 {
  readonly moduleId: string;
  readonly startup: FixedCollectionRuntimeActivationV1;
  readonly switch: FixedCollectionRuntimeActivationV1 & { readonly fromModuleId: string };
  readonly save: {
    readonly logicalKey: string;
    readonly namespace: string;
    readonly writtenValue: string;
    readonly restoredValue: string;
  };
}

export interface FixedCollectionRuntimeFailureSwitchV1 {
  readonly fromModuleId: string;
  readonly toModuleId: string;
  readonly errorCode: string;
  readonly milliseconds: number;
  readonly activeModuleIdAfterFailure: null;
  readonly activeDocumentIdentityAfterFailure: null;
  readonly activeRuntimeIdentityAfterFailure: null;
}

export interface FixedCollectionRuntimeBudgetLimitsV1 {
  readonly startupMillisecondsMax: number;
  readonly switchMillisecondsMax: number;
  readonly jsHeapBytesMax: number;
}

export interface FixedCollectionRuntimeBudgetObservedV1 {
  readonly maxStartupMilliseconds: number;
  readonly maxSwitchMilliseconds: number;
  readonly maxJsHeapBytes: number;
}

export interface FixedCollectionRuntimeBudgetConclusionV1 {
  readonly limits: FixedCollectionRuntimeBudgetLimitsV1;
  readonly observed: FixedCollectionRuntimeBudgetObservedV1;
  readonly passed: boolean;
}

export interface FixedCollectionRuntimeValidationV1 {
  readonly schemaVersion: typeof FIXED_COLLECTION_RUNTIME_VALIDATION_SCHEMA_VERSION;
  readonly subject: {
    readonly collectionId: string;
    readonly collectionManifestSha256: string;
    readonly collectionLauncherSha256: string;
    readonly targetProfileSha256: string;
    readonly assembledTreeSha256: string;
  };
  readonly browser: {
    readonly name: string;
    readonly version: string;
  };
  readonly measurementMethod: {
    readonly timing: FixedCollectionTimingMethod;
    readonly heap: FixedCollectionHeapMethod;
    readonly identity: FixedCollectionIdentityMethod;
    readonly storage: FixedCollectionStorageMethod;
  };
  readonly modules: readonly FixedCollectionRuntimeModuleValidationV1[];
  readonly failedSwitches: readonly FixedCollectionRuntimeFailureSwitchV1[];
  readonly budgets: FixedCollectionRuntimeBudgetConclusionV1;
  readonly status: FixedCollectionRuntimeValidationStatus;
}

export interface FixedCollectionRuntimeValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

type UnknownRecord = Record<string, unknown>;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9-]*$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function object(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: UnknownRecord, required: readonly string[], path: string, errors: string[]): void {
  const allowed = new Set(required);
  for (const key of required) if (!(key in value)) errors.push(`${path}.${key} is required`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${path}.${key} is not allowed`);
}

function stringValue(
  value: unknown,
  path: string,
  errors: string[],
  pattern?: RegExp,
  maximumLength = 256,
): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength
    || (pattern && !pattern.test(value))) {
    errors.push(`${path} is invalid`);
    return false;
  }
  return true;
}

function finite(value: unknown, path: string, errors: string[], positive = false): value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (positive && value === 0)) {
    errors.push(`${path} must be a finite ${positive ? "positive" : "non-negative"} number`);
    return false;
  }
  return true;
}

function positiveSafeInteger(value: unknown, path: string, errors: string[]): value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    errors.push(`${path} must be a positive safe integer`);
    return false;
  }
  return true;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  errors: string[],
): value is T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    errors.push(`${path} is invalid`);
    return false;
  }
  return true;
}

function validateActivation(
  value: unknown,
  path: string,
  errors: string[],
  documentIdentities: Set<string>,
  runtimeIdentities: Set<string>,
  switchActivation: boolean,
): void {
  if (!object(value)) { errors.push(`${path} must be an object`); return; }
  exactKeys(value, switchActivation
    ? ["fromModuleId", "documentIdentity", "runtimeIdentity", "milliseconds", "jsHeapBytes"]
    : ["documentIdentity", "runtimeIdentity", "milliseconds", "jsHeapBytes"], path, errors);
  if (switchActivation) stringValue(value.fromModuleId, `${path}.fromModuleId`, errors, ID);
  if (stringValue(value.documentIdentity, `${path}.documentIdentity`, errors, TOKEN)) {
    if (documentIdentities.has(value.documentIdentity)) errors.push(`${path}.documentIdentity must be new`);
    else documentIdentities.add(value.documentIdentity);
  }
  if (stringValue(value.runtimeIdentity, `${path}.runtimeIdentity`, errors, TOKEN)) {
    if (runtimeIdentities.has(value.runtimeIdentity)) errors.push(`${path}.runtimeIdentity must be new`);
    else runtimeIdentities.add(value.runtimeIdentity);
  }
  finite(value.milliseconds, `${path}.milliseconds`, errors);
  positiveSafeInteger(value.jsHeapBytes, `${path}.jsHeapBytes`, errors);
}

export function deriveFixedCollectionRuntimeBudget(
  modules: readonly FixedCollectionRuntimeModuleValidationV1[],
  limits: FixedCollectionRuntimeBudgetLimitsV1,
): FixedCollectionRuntimeBudgetConclusionV1 {
  if (modules.length < 3) throw new TypeError("Collection runtime budget requires at least three modules");
  if (modules.some((module) => !Number.isFinite(module.startup.milliseconds)
    || module.startup.milliseconds < 0
    || !Number.isFinite(module.switch.milliseconds)
    || module.switch.milliseconds < 0
    || !Number.isSafeInteger(module.startup.jsHeapBytes)
    || module.startup.jsHeapBytes <= 0
    || !Number.isSafeInteger(module.switch.jsHeapBytes)
    || module.switch.jsHeapBytes <= 0)) {
    throw new TypeError("Collection runtime budget requires complete finite timing and heap measurements");
  }
  if (!Number.isFinite(limits.startupMillisecondsMax)
    || limits.startupMillisecondsMax <= 0
    || !Number.isFinite(limits.switchMillisecondsMax)
    || limits.switchMillisecondsMax <= 0
    || !Number.isSafeInteger(limits.jsHeapBytesMax)
    || limits.jsHeapBytesMax <= 0) {
    throw new TypeError("Collection runtime budget requires finite positive limits");
  }
  const observed = {
    maxStartupMilliseconds: Math.max(...modules.map((module) => module.startup.milliseconds)),
    maxSwitchMilliseconds: Math.max(...modules.map((module) => module.switch.milliseconds)),
    maxJsHeapBytes: Math.max(...modules.flatMap((module) => [module.startup.jsHeapBytes, module.switch.jsHeapBytes])),
  };
  return {
    limits,
    observed,
    passed: observed.maxStartupMilliseconds <= limits.startupMillisecondsMax
      && observed.maxSwitchMilliseconds <= limits.switchMillisecondsMax
      && observed.maxJsHeapBytes <= limits.jsHeapBytesMax,
  };
}

export function expectedFixedCollectionRuntimeValidationStatus(
  budgets: Pick<FixedCollectionRuntimeBudgetConclusionV1, "passed">,
): FixedCollectionRuntimeValidationStatus {
  return budgets.passed ? "passed" : "failed";
}

export function validateFixedCollectionRuntimeValidation(
  value: unknown,
): FixedCollectionRuntimeValidationResult {
  const errors: string[] = [];
  if (!object(value)) return { ok: false, errors: ["$ must be an object"] };
  exactKeys(value, [
    "schemaVersion", "subject", "browser", "measurementMethod", "modules", "failedSwitches", "budgets", "status",
  ], "$", errors);
  if (value.schemaVersion !== FIXED_COLLECTION_RUNTIME_VALIDATION_SCHEMA_VERSION) {
    errors.push(`$.schemaVersion must equal ${FIXED_COLLECTION_RUNTIME_VALIDATION_SCHEMA_VERSION}`);
  }

  if (!object(value.subject)) errors.push("$.subject must be an object");
  else {
    exactKeys(value.subject, [
      "collectionId", "collectionManifestSha256", "collectionLauncherSha256", "targetProfileSha256", "assembledTreeSha256",
    ], "$.subject", errors);
    stringValue(value.subject.collectionId, "$.subject.collectionId", errors, ID);
    for (const key of [
      "collectionManifestSha256", "collectionLauncherSha256", "targetProfileSha256", "assembledTreeSha256",
    ] as const) stringValue(value.subject[key], `$.subject.${key}`, errors, HASH, 64);
  }

  if (!object(value.browser)) errors.push("$.browser must be an object");
  else {
    exactKeys(value.browser, ["name", "version"], "$.browser", errors);
    stringValue(value.browser.name, "$.browser.name", errors, undefined, 120);
    stringValue(value.browser.version, "$.browser.version", errors, undefined, 120);
  }

  if (!object(value.measurementMethod)) errors.push("$.measurementMethod must be an object");
  else {
    exactKeys(value.measurementMethod, ["timing", "heap", "identity", "storage"], "$.measurementMethod", errors);
    oneOf(value.measurementMethod.timing, FIXED_COLLECTION_TIMING_METHODS, "$.measurementMethod.timing", errors);
    oneOf(value.measurementMethod.heap, FIXED_COLLECTION_HEAP_METHODS, "$.measurementMethod.heap", errors);
    oneOf(value.measurementMethod.identity, FIXED_COLLECTION_IDENTITY_METHODS, "$.measurementMethod.identity", errors);
    oneOf(value.measurementMethod.storage, FIXED_COLLECTION_STORAGE_METHODS, "$.measurementMethod.storage", errors);
  }

  const moduleIds = new Set<string>();
  const documentIdentities = new Set<string>();
  const runtimeIdentities = new Set<string>();
  const logicalKeys = new Set<string>();
  const namespaces = new Set<string>();
  const writtenValues = new Set<string>();
  if (!Array.isArray(value.modules) || value.modules.length < 3) {
    errors.push("$.modules must contain at least three modules");
  } else value.modules.forEach((module, index) => {
    const path = `$.modules[${index}]`;
    if (!object(module)) { errors.push(`${path} must be an object`); return; }
    exactKeys(module, ["moduleId", "startup", "switch", "save"], path, errors);
    if (stringValue(module.moduleId, `${path}.moduleId`, errors, ID)) {
      if (moduleIds.has(module.moduleId)) errors.push(`${path}.moduleId must be unique`);
      else moduleIds.add(module.moduleId);
    }
    validateActivation(module.startup, `${path}.startup`, errors, documentIdentities, runtimeIdentities, false);
    validateActivation(module.switch, `${path}.switch`, errors, documentIdentities, runtimeIdentities, true);
    if (!object(module.save)) errors.push(`${path}.save must be an object`);
    else {
      exactKeys(module.save, ["logicalKey", "namespace", "writtenValue", "restoredValue"], `${path}.save`, errors);
      if (stringValue(module.save.logicalKey, `${path}.save.logicalKey`, errors)) logicalKeys.add(module.save.logicalKey);
      if (stringValue(module.save.namespace, `${path}.save.namespace`, errors)) {
        if (namespaces.has(module.save.namespace)) errors.push(`${path}.save.namespace must be unique`);
        else namespaces.add(module.save.namespace);
      }
      if (stringValue(module.save.writtenValue, `${path}.save.writtenValue`, errors)) {
        if (writtenValues.has(module.save.writtenValue)) errors.push(`${path}.save.writtenValue must be unique`);
        else writtenValues.add(module.save.writtenValue);
      }
      if (stringValue(module.save.restoredValue, `${path}.save.restoredValue`, errors)
        && typeof module.save.writtenValue === "string"
        && module.save.restoredValue !== module.save.writtenValue) {
        errors.push(`${path}.save.restoredValue must equal writtenValue`);
      }
    }
  });
  if (logicalKeys.size > 1) errors.push("$.modules[*].save.logicalKey must be identical across modules");

  if (Array.isArray(value.modules)) value.modules.forEach((module, index) => {
    if (!object(module) || !object(module.switch) || typeof module.moduleId !== "string") return;
    if (typeof module.switch.fromModuleId === "string") {
      if (!moduleIds.has(module.switch.fromModuleId)) {
        errors.push(`$.modules[${index}].switch.fromModuleId must identify one measured module`);
      } else if (module.switch.fromModuleId === module.moduleId) {
        errors.push(`$.modules[${index}].switch.fromModuleId must identify a different module`);
      }
    }
  });

  if (!Array.isArray(value.failedSwitches) || value.failedSwitches.length < 1) {
    errors.push("$.failedSwitches must contain at least one failed switch");
  } else value.failedSwitches.forEach((failure, index) => {
    const path = `$.failedSwitches[${index}]`;
    if (!object(failure)) { errors.push(`${path} must be an object`); return; }
    exactKeys(failure, [
      "fromModuleId", "toModuleId", "errorCode", "milliseconds", "activeModuleIdAfterFailure",
      "activeDocumentIdentityAfterFailure", "activeRuntimeIdentityAfterFailure",
    ], path, errors);
    for (const key of ["fromModuleId", "toModuleId"] as const) {
      if (stringValue(failure[key], `${path}.${key}`, errors, ID) && !moduleIds.has(failure[key])) {
        errors.push(`${path}.${key} must identify one measured module`);
      }
    }
    if (failure.fromModuleId === failure.toModuleId) errors.push(`${path}.toModuleId must differ from fromModuleId`);
    stringValue(failure.errorCode, `${path}.errorCode`, errors, TOKEN);
    finite(failure.milliseconds, `${path}.milliseconds`, errors);
    for (const key of [
      "activeModuleIdAfterFailure", "activeDocumentIdentityAfterFailure", "activeRuntimeIdentityAfterFailure",
    ] as const) if (failure[key] !== null) errors.push(`${path}.${key} must equal null`);
  });

  let limits: FixedCollectionRuntimeBudgetLimitsV1 | undefined;
  let observed: FixedCollectionRuntimeBudgetObservedV1 | undefined;
  let claimedPassed: boolean | undefined;
  if (!object(value.budgets)) errors.push("$.budgets must be an object");
  else {
    exactKeys(value.budgets, ["limits", "observed", "passed"], "$.budgets", errors);
    if (!object(value.budgets.limits)) errors.push("$.budgets.limits must be an object");
    else {
      exactKeys(value.budgets.limits, ["startupMillisecondsMax", "switchMillisecondsMax", "jsHeapBytesMax"], "$.budgets.limits", errors);
      const startup = finite(value.budgets.limits.startupMillisecondsMax, "$.budgets.limits.startupMillisecondsMax", errors, true);
      const switching = finite(value.budgets.limits.switchMillisecondsMax, "$.budgets.limits.switchMillisecondsMax", errors, true);
      const heap = positiveSafeInteger(value.budgets.limits.jsHeapBytesMax, "$.budgets.limits.jsHeapBytesMax", errors);
      if (startup && switching && heap) limits = value.budgets.limits as unknown as FixedCollectionRuntimeBudgetLimitsV1;
    }
    if (!object(value.budgets.observed)) errors.push("$.budgets.observed must be an object");
    else {
      exactKeys(value.budgets.observed, ["maxStartupMilliseconds", "maxSwitchMilliseconds", "maxJsHeapBytes"], "$.budgets.observed", errors);
      const startup = finite(value.budgets.observed.maxStartupMilliseconds, "$.budgets.observed.maxStartupMilliseconds", errors);
      const switching = finite(value.budgets.observed.maxSwitchMilliseconds, "$.budgets.observed.maxSwitchMilliseconds", errors);
      const heap = positiveSafeInteger(value.budgets.observed.maxJsHeapBytes, "$.budgets.observed.maxJsHeapBytes", errors);
      if (startup && switching && heap) observed = value.budgets.observed as unknown as FixedCollectionRuntimeBudgetObservedV1;
    }
    if (typeof value.budgets.passed !== "boolean") errors.push("$.budgets.passed must be a boolean");
    else claimedPassed = value.budgets.passed;
  }

  const derivableModules = Array.isArray(value.modules)
    && value.modules.length >= 3
    && value.modules.every((module) => object(module)
      && object(module.startup) && finiteWithoutErrors(module.startup.milliseconds)
      && positiveIntegerWithoutErrors(module.startup.jsHeapBytes)
      && object(module.switch) && finiteWithoutErrors(module.switch.milliseconds)
      && positiveIntegerWithoutErrors(module.switch.jsHeapBytes));
  if (derivableModules && limits && observed && claimedPassed !== undefined) {
    const derived = deriveFixedCollectionRuntimeBudget(
      value.modules as unknown as FixedCollectionRuntimeModuleValidationV1[],
      limits,
    );
    if (JSON.stringify(observed) !== JSON.stringify(derived.observed)) {
      errors.push("$.budgets.observed must be derived from all module measurements");
    }
    if (claimedPassed !== derived.passed) errors.push("$.budgets.passed must be derived from measurements and limits");
    if (value.status !== expectedFixedCollectionRuntimeValidationStatus(derived)) {
      errors.push("$.status must be derived from the budget conclusion");
    }
  }
  if (!(value.status === "passed" || value.status === "failed")) errors.push("$.status is invalid");
  return { ok: errors.length === 0, errors };
}

function finiteWithoutErrors(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function positiveIntegerWithoutErrors(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

export function assertFixedCollectionRuntimeValidation(
  value: unknown,
): asserts value is FixedCollectionRuntimeValidationV1 {
  const result = validateFixedCollectionRuntimeValidation(value);
  if (!result.ok) throw new TypeError(`Invalid fixed collection runtime validation:\n${result.errors.join("\n")}`);
}
