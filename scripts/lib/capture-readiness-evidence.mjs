const identifierPattern = /^[a-z0-9][a-z0-9-]*$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

export function captureReadinessErrors(record, expected = {}) {
  const errors = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return ["capture readiness record must be an object"];
  }
  if (typeof record.id !== "string" || !identifierPattern.test(record.id)) {
    errors.push("id must be a kebab-case identifier");
  }
  if (record.status !== "ready") errors.push("status must be ready");
  if (record.loadingHiddenClass !== true) errors.push("loadingHiddenClass must be true");
  if (record.loadingOpacity !== 0) errors.push("loadingOpacity must be 0");
  if (record.loadingVisibility !== "hidden") errors.push("loadingVisibility must be hidden");
  if (!Number.isSafeInteger(record.presentedFrames) || record.presentedFrames < 2) {
    errors.push("presentedFrames must be an integer of at least 2");
  }
  for (const field of ["presentationMode", "sceneId", "stateBoundary"]) {
    if (typeof record[field] !== "string" || record[field].length === 0) {
      errors.push(`${field} must be a non-empty string`);
    }
  }
  if (typeof record.visualRuntimeSha256 !== "string" || !sha256Pattern.test(record.visualRuntimeSha256)) {
    errors.push("visualRuntimeSha256 must be a lowercase SHA-256 digest");
  }
  for (const [field, value] of Object.entries(expected)) {
    if (value !== undefined && record[field] !== value) {
      errors.push(`${field} must match ${value}, received ${String(record[field])}`);
    }
  }
  return errors;
}

export function assertCaptureReadinessEvidence(record, expected = {}) {
  const errors = captureReadinessErrors(record, expected);
  if (errors.length > 0) throw new Error(`Invalid capture readiness evidence: ${errors.join("; ")}`);
  return record;
}
