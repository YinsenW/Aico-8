export const HD_REVIEW_SCREENSHOT_FIELDS = Object.freeze([
  "id",
  "path",
  "sha256",
  "width",
  "height",
  "presentationMode",
  "sceneId",
  "stateBoundary",
  "visualRuntimeSha256",
]);

export function normalizeHdReviewScreenshot(screenshot) {
  return Object.fromEntries(HD_REVIEW_SCREENSHOT_FIELDS.map((field) => [field, screenshot[field]]));
}
