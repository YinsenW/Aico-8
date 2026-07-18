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

export function packageTreeSha256(releaseManifestBytes, artifacts) {
  if (!(releaseManifestBytes instanceof Uint8Array)) {
    throw new TypeError("releaseManifestBytes must be bytes");
  }
  const paths = new Set();
  const normalizedArtifacts = artifacts.map(({ path, sha256, bytes }) => {
    const segments = typeof path === "string" ? path.split("/") : [];
    if (typeof path !== "string" || path.length === 0 || path.includes("\\") || path.startsWith("/")
      || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
      throw new Error(`Unsafe package artifact path: ${String(path)}`);
    }
    if (paths.has(path)) throw new Error(`Duplicate package artifact path: ${path}`);
    paths.add(path);
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`Invalid package artifact sha256: ${path}`);
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error(`Invalid package artifact byte count: ${path}`);
    return { path, sha256, bytes };
  }).sort((left, right) => left.path.localeCompare(right.path));
  return canonicalSha256({
    schemaVersion: "aico8.package-tree-identity.v1",
    releaseManifestSha256: createHash("sha256").update(releaseManifestBytes).digest("hex"),
    artifacts: normalizedArtifacts,
  });
}
