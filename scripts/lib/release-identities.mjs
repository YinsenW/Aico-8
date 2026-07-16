import { createHash } from "node:crypto";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalSha256(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export function replaySemantics(replay) {
  const { revision: _runtimeRevision, ...runtime } = replay.runtime ?? {};
  const { sourceRevision: _producerRevision, ...producer } = replay.producer ?? {};
  return {
    schemaVersion: replay.schemaVersion,
    replayId: replay.replayId,
    gameId: replay.gameId,
    cartSha256: replay.cartSha256,
    runtime,
    canonicality: replay.canonicality,
    trace: replay.trace,
    hostActions: replay.hostActions ?? [],
    requiredMilestoneIds: replay.requiredMilestoneIds,
    milestones: replay.milestones,
    checkpoints: replay.checkpoints,
    result: replay.result,
    producer,
  };
}

export function validationReplaySemanticsSha256(replay) {
  return canonicalSha256({
    schemaVersion: "aico8.validation-replay-semantics.v1",
    replay: replaySemantics(replay),
  });
}

export function visualRuntimeSha256(artifacts, validationReplayArtifactPath) {
  const normalizedReplayPath = validationReplayArtifactPath?.replaceAll("\\", "/");
  const visualArtifacts = artifacts
    .filter(({ path }) => path !== normalizedReplayPath)
    .map(({ path, sha256, bytes }) => ({ path, sha256, bytes }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (normalizedReplayPath && !artifacts.some(({ path }) => path === normalizedReplayPath)) {
    throw new Error(`Validation replay artifact is not declared: ${normalizedReplayPath}`);
  }
  return canonicalSha256({
    schemaVersion: "aico8.visual-runtime-identity.v1",
    artifacts: visualArtifacts,
  });
}
