export function assertFullViewportScreenshot(profile, dimensions) {
  const label = profile?.id ?? "layout profile";
  for (const [name, value] of Object.entries({
    viewportWidth: profile?.viewport?.width,
    viewportHeight: profile?.viewport?.height,
    screenshotWidth: dimensions?.width,
    screenshotHeight: dimensions?.height,
  })) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${label}: ${name} must be a positive integer`);
    }
  }
  if (dimensions.width !== profile.viewport.width || dimensions.height !== profile.viewport.height) {
    throw new Error(
      `${label}: screenshot ${dimensions.width}x${dimensions.height} must cover the declared full viewport `
      + `${profile.viewport.width}x${profile.viewport.height}`,
    );
  }
}
