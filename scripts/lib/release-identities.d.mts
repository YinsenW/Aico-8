export interface ReleaseIdentityArtifact {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

export function validationReplaySemanticsSha256(replay: unknown): string;

export function visualRuntimeSha256(
  artifacts: readonly ReleaseIdentityArtifact[],
  validationReplayArtifactPath?: string,
): string;

export function packageTreeSha256(
  releaseManifestBytes: Uint8Array,
  artifacts: readonly ReleaseIdentityArtifact[],
): string;
