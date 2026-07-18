import { createHash } from "node:crypto";

import { validateGameModule, type GameModuleFileReferenceV1, type GameModuleV1 } from "./game-module.js";
import { validateFixedCollection, type FixedCollectionV1 } from "./fixed-collection.js";
import { validateTargetProfile, type WebTargetProfileV1 } from "./release.js";
import { selectAcceptedBatchAssemblyInputs, type BatchV1 } from "./batch.js";

export const ASSEMBLY_PLAN_SCHEMA_VERSION = "aico8.assembly-plan.v1" as const;

export interface AssemblyPlanArtifactV1 extends GameModuleFileReferenceV1 {
  readonly role: string;
  readonly packaged: boolean;
  readonly destination?: string;
}

export interface SingleGameAssemblyPlanV1 {
  readonly schemaVersion: typeof ASSEMBLY_PLAN_SCHEMA_VERSION;
  readonly kind: "single-game-web-pwa";
  readonly moduleId: string;
  readonly moduleSchemaVersion: string;
  readonly saveNamespace: string;
  readonly targetProfile: {
    readonly id: string;
    readonly sha256: string;
    readonly outputProfile: string;
  };
  readonly artifacts: readonly AssemblyPlanArtifactV1[];
}

export interface AssemblyPlanResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly plan?: SingleGameAssemblyPlanV1;
}

export interface FixedCollectionModuleAssemblyInput {
  readonly manifestBytes: Uint8Array;
}

export interface FixedCollectionAssemblyArtifactV1 extends AssemblyPlanArtifactV1 {
  readonly moduleId: string;
  readonly source: "manifest" | "module-root";
}

export interface FixedCollectionAssemblyPlanV1 {
  readonly schemaVersion: typeof ASSEMBLY_PLAN_SCHEMA_VERSION;
  readonly kind: "fixed-collection-web-pwa";
  readonly collectionId: string;
  readonly title: string;
  readonly launcher: { readonly initialModuleId: string; readonly orderedModuleIds: readonly string[] };
  readonly isolation: {
    readonly resetCompatibilityStateOnSwitch: true;
    readonly saveNamespaces: Readonly<Record<string, string>>;
  };
  readonly targetProfile: {
    readonly id: string;
    readonly sha256: string;
    readonly outputProfile: string;
  };
  readonly budgets: {
    readonly maxPackagedBytes: number;
    readonly maxPersistentBytes: number;
    readonly declaredPersistentBytes: number;
  };
  readonly artifacts: readonly FixedCollectionAssemblyArtifactV1[];
}

export interface FixedCollectionAssemblyPlanResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly plan?: FixedCollectionAssemblyPlanV1;
}

export interface AcceptedBatchAssemblyPlanV1 {
  readonly gameId: string;
  readonly moduleId: string;
  readonly plan: SingleGameAssemblyPlanV1;
}

export interface TargetProfileAssemblyInput {
  readonly bytes: Uint8Array;
}

function parseTargetProfileBytes(bytes: Uint8Array, errors: string[]): {
  readonly value?: unknown;
  readonly sha256?: string;
} {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    errors.push("targetProfileBytes must be non-empty bytes");
    return {};
  }
  try {
    return {
      value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch (error) {
    errors.push(`targetProfileBytes must contain UTF-8 JSON: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

export function planSingleGameAssembly(
  moduleValue: unknown,
  targetProfileBytes: Uint8Array,
): AssemblyPlanResult {
  const errors: string[] = [];
  const moduleValidation = validateGameModule(moduleValue);
  errors.push(...moduleValidation.errors.map((error) => `module: ${error}`));
  const parsedProfile = parseTargetProfileBytes(targetProfileBytes, errors);
  const profileValidation = validateTargetProfile(parsedProfile.value);
  errors.push(...profileValidation.errors.map((error) => `targetProfile: ${error}`));
  if (errors.length > 0) return { ok: false, errors };

  const module = moduleValue as GameModuleV1;
  const profile = parsedProfile.value as WebTargetProfileV1;
  const targetProfileSha256 = parsedProfile.sha256!;
  if (module.status !== "validated" || module.validation.status !== "passed") {
    errors.push("module must be validated before assembly");
  }
  const binding = module.runtime.targetBindings[0];
  if (binding.targetProfileId !== profile.id) errors.push("module targetProfileId must match target profile");
  if (binding.targetProfileSha256 !== targetProfileSha256) errors.push("module targetProfileSha256 must match target profile bytes");
  if (profile.target !== "web-pwa") errors.push("single-game assembly supports web-pwa only");
  if (errors.length > 0) return { ok: false, errors };

  const runtimeArtifacts: readonly [string, GameModuleFileReferenceV1][] = [
    ["rom", module.payload.rom],
    ["source-code", module.payload.sourceCode],
    ["presentation-module", module.payload.presentationModule],
    ["hd-identity-map", module.mappings.hdIdentityMap],
    ["asset-pack", module.mappings.assetPack],
    ["typography-manifest", module.mappings.typographyManifest],
    ["audio-manifest", module.mappings.audioManifest],
  ];
  const artifacts: AssemblyPlanArtifactV1[] = runtimeArtifacts.map(([role, reference]) => ({
    role,
    path: reference.path,
    sha256: reference.sha256,
    packaged: true,
    destination: `module/${reference.path}`,
  }));
  for (const evidence of module.validation.evidence) {
    artifacts.push({ role: `evidence:${evidence.kind}`, path: evidence.path, sha256: evidence.sha256, packaged: false });
  }
  artifacts.sort((left, right) => left.path.localeCompare(right.path));
  return {
    ok: true,
    errors: [],
    plan: {
      schemaVersion: ASSEMBLY_PLAN_SCHEMA_VERSION,
      kind: "single-game-web-pwa",
      moduleId: module.moduleId,
      moduleSchemaVersion: module.schemaVersion,
      saveNamespace: module.save.namespace,
      targetProfile: { id: profile.id, sha256: targetProfileSha256, outputProfile: profile.outputProfile },
      artifacts,
    },
  };
}

function parseModuleManifestBytes(bytes: Uint8Array, moduleId: string, errors: string[]): unknown {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    errors.push(`module ${moduleId}: manifestBytes must be non-empty bytes`);
    return undefined;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    errors.push(`module ${moduleId}: manifestBytes must contain UTF-8 JSON: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

export function planFixedCollectionAssembly(
  collectionValue: unknown,
  modulesById: ReadonlyMap<string, FixedCollectionModuleAssemblyInput>,
  targetProfileBytes: Uint8Array,
): FixedCollectionAssemblyPlanResult {
  const errors: string[] = [];
  const collectionValidation = validateFixedCollection(collectionValue);
  errors.push(...collectionValidation.errors.map((error) => `collection: ${error}`));
  const parsedProfile = parseTargetProfileBytes(targetProfileBytes, errors);
  const profileValidation = validateTargetProfile(parsedProfile.value);
  errors.push(...profileValidation.errors.map((error) => `targetProfile: ${error}`));
  if (errors.length > 0) return { ok: false, errors };

  const collection = collectionValue as FixedCollectionV1;
  const profile = parsedProfile.value as WebTargetProfileV1;
  const targetProfileSha256 = parsedProfile.sha256!;
  if (profile.target !== "web-pwa") errors.push("fixed-collection assembly supports web-pwa only");
  if (collection.targetProfile.id !== profile.id) errors.push("collection targetProfile.id must match target profile");
  if (collection.targetProfile.sha256 !== targetProfileSha256) {
    errors.push("collection targetProfile.sha256 must match target profile bytes");
  }

  const artifacts: FixedCollectionAssemblyArtifactV1[] = [];
  const saveNamespaces: Record<string, string> = {};
  let declaredPersistentBytes = 0;
  for (const entry of collection.modules) {
    const input = modulesById.get(entry.moduleId);
    if (!input) { errors.push(`module ${entry.moduleId}: input is missing`); continue; }
    const manifestSha256 = createHash("sha256").update(input.manifestBytes).digest("hex");
    if (manifestSha256 !== entry.manifestSha256) {
      errors.push(`module ${entry.moduleId}: manifestSha256 must match manifest bytes`);
    }
    const moduleValue = parseModuleManifestBytes(input.manifestBytes, entry.moduleId, errors);
    const moduleValidation = validateGameModule(moduleValue);
    errors.push(...moduleValidation.errors.map((error) => `module ${entry.moduleId}: ${error}`));
    if (!moduleValidation.ok) continue;
    const module = moduleValue as GameModuleV1;
    if (module.moduleId !== entry.moduleId) errors.push(`module ${entry.moduleId}: manifest moduleId must match collection entry`);
    if (module.status !== "validated" || module.validation.status !== "passed") {
      errors.push(`module ${entry.moduleId}: must be independently validated before collection assembly`);
    }
    if (module.save.namespace !== entry.saveNamespace) errors.push(`module ${entry.moduleId}: saveNamespace must match manifest`);
    if (module.provenance.rightsProfile !== entry.rightsProfile) errors.push(`module ${entry.moduleId}: rightsProfile must match manifest`);
    const binding = module.runtime.targetBindings[0];
    if (binding.targetProfileId !== profile.id || binding.targetProfileSha256 !== targetProfileSha256) {
      errors.push(`module ${entry.moduleId}: target binding must match collection target profile bytes`);
    }
    declaredPersistentBytes += module.save.persistentBytes;
    saveNamespaces[entry.moduleId] = module.save.namespace;
    artifacts.push({
      moduleId: entry.moduleId,
      source: "manifest",
      role: "module-manifest",
      path: `${entry.moduleId}.module.json`,
      sha256: entry.manifestSha256,
      packaged: true,
      destination: `modules/${entry.moduleId}/module.json`,
    });
    artifacts.push({
      moduleId: entry.moduleId,
      source: "module-root",
      role: "license-notice",
      path: entry.license.notice.path,
      sha256: entry.license.notice.sha256,
      packaged: true,
      destination: `modules/${entry.moduleId}/license/${entry.license.notice.path}`,
    });
    const single = planSingleGameAssembly(moduleValue, targetProfileBytes);
    if (!single.ok || !single.plan) {
      errors.push(...single.errors.map((error) => `module ${entry.moduleId}: ${error}`));
      continue;
    }
    for (const artifact of single.plan.artifacts) {
      artifacts.push(artifact.packaged ? {
        ...artifact,
        moduleId: entry.moduleId,
        source: "module-root",
        destination: `modules/${entry.moduleId}/${artifact.destination}`,
      } : {
        moduleId: entry.moduleId,
        source: "module-root",
        role: artifact.role,
        path: artifact.path,
        sha256: artifact.sha256,
        packaged: false,
      });
    }
  }
  for (const moduleId of modulesById.keys()) {
    if (!collection.modules.some((entry) => entry.moduleId === moduleId)) {
      errors.push(`module ${moduleId}: undeclared input is not allowed`);
    }
  }
  if (declaredPersistentBytes > collection.budgets.maxPersistentBytes) {
    errors.push("collection declared persistent bytes exceed maxPersistentBytes");
  }
  if (errors.length > 0) return { ok: false, errors };
  artifacts.sort((left, right) => {
    const leftKey = `${left.moduleId}\0${left.packaged ? "0" : "1"}\0${left.destination ?? left.path}`;
    const rightKey = `${right.moduleId}\0${right.packaged ? "0" : "1"}\0${right.destination ?? right.path}`;
    return leftKey.localeCompare(rightKey);
  });
  return {
    ok: true,
    errors: [],
    plan: {
      schemaVersion: ASSEMBLY_PLAN_SCHEMA_VERSION,
      kind: "fixed-collection-web-pwa",
      collectionId: collection.collectionId,
      title: collection.metadata.title,
      launcher: {
        initialModuleId: collection.launcher.initialModuleId,
        orderedModuleIds: collection.modules.map(({ moduleId }) => moduleId),
      },
      isolation: { resetCompatibilityStateOnSwitch: true, saveNamespaces },
      targetProfile: { id: profile.id, sha256: targetProfileSha256, outputProfile: profile.outputProfile },
      budgets: {
        maxPackagedBytes: collection.budgets.maxPackagedBytes,
        maxPersistentBytes: collection.budgets.maxPersistentBytes,
        declaredPersistentBytes,
      },
      artifacts,
    },
  };
}

export function planAcceptedBatchAssemblies(
  batch: BatchV1,
  modulesById: ReadonlyMap<string, unknown>,
  targetProfilesById: ReadonlyMap<string, TargetProfileAssemblyInput>,
): readonly AcceptedBatchAssemblyPlanV1[] {
  return selectAcceptedBatchAssemblyInputs(batch, modulesById).map(({ gameId, moduleId, module }) => {
    const game = batch.games.find((candidate) => candidate.gameId === gameId)!;
    const acceptedAttempt = game.attempts.at(-1);
    if (!acceptedAttempt || acceptedAttempt.outcome !== "accepted") {
      throw new Error(`Accepted game ${gameId} has no accepted attempt evidence`);
    }
    const targetProfile = targetProfilesById.get(game.request.targetProfileId);
    if (!targetProfile) throw new Error(`Missing target profile ${game.request.targetProfileId} for ${gameId}`);
    const result = planSingleGameAssembly(module, targetProfile.bytes);
    if (!result.ok || !result.plan) {
      throw new Error(`Accepted module ${moduleId} cannot be assembled:\n${result.errors.join("\n")}`);
    }
    if (result.plan.moduleId !== moduleId) throw new Error(`Accepted module ID mismatch for ${gameId}`);
    if (result.plan.targetProfile.id !== game.request.targetProfileId) {
      throw new Error(`Batch target profile ID mismatch for ${gameId}`);
    }
    if (result.plan.targetProfile.sha256 !== game.request.targetProfileSha256) {
      throw new Error(`Batch target profile hash mismatch for ${gameId}`);
    }
    const validatedModule = module as GameModuleV1;
    const moduleEvidence = new Map(validatedModule.validation.evidence.map(({ kind, sha256 }) => [kind, sha256]));
    const evidenceBindings = [
      ["canonicalReplaySha256", "canonical-replay"],
      ["hdReviewDecisionSha256", "hd-review-decision"],
    ] as const;
    for (const [attemptKey, moduleKind] of evidenceBindings) {
      if (acceptedAttempt.evidence[attemptKey] !== moduleEvidence.get(moduleKind)) {
        throw new Error(`Accepted attempt ${attemptKey} does not match module ${moduleKind} evidence for ${gameId}`);
      }
    }
    return { gameId, moduleId, plan: result.plan };
  });
}
