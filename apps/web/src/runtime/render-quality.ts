export interface RenderQualityProfile {
  readonly edgeSupersampleFactor: number;
  readonly antialias: boolean;
  readonly autoDensity: boolean;
  readonly containerScaled: boolean;
}

export const HD_RENDER_QUALITY: Readonly<RenderQualityProfile> = Object.freeze({
  edgeSupersampleFactor: 2,
  antialias: true,
  autoDensity: false,
  containerScaled: true,
});

export function renderQualityErrors(profile: Readonly<RenderQualityProfile> = HD_RENDER_QUALITY): string[] {
  const errors: string[] = [];
  if (!Number.isSafeInteger(profile.edgeSupersampleFactor) || profile.edgeSupersampleFactor < 2) {
    errors.push("edge supersampling must be at least 2x");
  }
  if (!profile.antialias) errors.push("vector antialiasing must be enabled");
  if (profile.autoDensity || !profile.containerScaled) {
    errors.push("the supersampled canvas must retain container-controlled CSS sizing");
  }
  return errors;
}
