import { createHash } from "node:crypto";

import { validateGameModule, type GameModuleFileReferenceV1, type GameModuleV1 } from "./game-module.js";
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
