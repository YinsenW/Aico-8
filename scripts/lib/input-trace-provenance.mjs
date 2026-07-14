import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const INPUT_TRACE_PROVENANCE_SCHEMA_VERSION = "aico8.input-trace-provenance.v1";

const HASH = /^[a-f0-9]{64}$/;
const DERIVATION_KINDS = new Set([
  "human-recorded",
  "first-party-search",
  "agent-authored",
  "external-action-seed",
]);
const INELIGIBLE_LICENSES = new Set([
  "",
  "none",
  "noassertion",
  "unknown",
  "unlicensed",
]);

function record(value, path, errors) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  return true;
}

function exactKeys(value, allowed, required, path, errors) {
  for (const key of required) if (!(key in value)) errors.push(`${path}.${key} is required`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${path}.${key} is not allowed`);
}

function nonEmpty(value, path, errors) {
  if (typeof value !== "string" || value.trim().length === 0) errors.push(`${path} must be a non-empty string`);
}

function sha256(value, path, errors) {
  if (typeof value !== "string" || !HASH.test(value)) errors.push(`${path} must be a lowercase SHA-256 digest`);
}

function httpsUrl(value, path, errors) {
  if (typeof value !== "string" || !/^https:\/\/[^\s]+$/.test(value)) errors.push(`${path} must be an HTTPS URL`);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function inputTraceSha256(trace) {
  return createHash("sha256").update(stableJson(trace)).digest("hex");
}

export function validateInputTraceProvenance(value) {
  const errors = [];
  if (!record(value, "$", errors)) return { valid: false, errors };
  exactKeys(value, ["schemaVersion", "traceSha256", "derivation", "externalSources"],
    ["schemaVersion", "traceSha256", "derivation", "externalSources"], "$", errors);
  if (value.schemaVersion !== INPUT_TRACE_PROVENANCE_SCHEMA_VERSION) {
    errors.push(`$.schemaVersion must equal ${INPUT_TRACE_PROVENANCE_SCHEMA_VERSION}`);
  }
  sha256(value.traceSha256, "$.traceSha256", errors);

  let derivationKind;
  if (record(value.derivation, "$.derivation", errors)) {
    exactKeys(value.derivation, ["kind", "generatorName", "generatorVersion", "sourceRevision"],
      ["kind", "generatorName", "generatorVersion", "sourceRevision"], "$.derivation", errors);
    derivationKind = value.derivation.kind;
    if (!DERIVATION_KINDS.has(derivationKind)) errors.push("$.derivation.kind is unsupported");
    nonEmpty(value.derivation.generatorName, "$.derivation.generatorName", errors);
    nonEmpty(value.derivation.generatorVersion, "$.derivation.generatorVersion", errors);
    nonEmpty(value.derivation.sourceRevision, "$.derivation.sourceRevision", errors);
  }

  if (!Array.isArray(value.externalSources)) {
    errors.push("$.externalSources must be an array");
  } else {
    if (derivationKind === "external-action-seed" && value.externalSources.length === 0) {
      errors.push("$.externalSources must contain the contributing external action source");
    }
    if (derivationKind !== "external-action-seed" && value.externalSources.length !== 0) {
      errors.push("$.externalSources is allowed only for external-action-seed derivation");
    }
    for (const [index, source] of value.externalSources.entries()) {
      const path = `$.externalSources[${index}]`;
      if (!record(source, path, errors)) continue;
      const keys = ["sourceUrl", "revision", "artifactPath", "artifactSha256", "actionSha256",
        "declaredLicense", "licenseEvidenceUrl", "reuseDecision", "reviewedBy"];
      exactKeys(source, keys, keys, path, errors);
      httpsUrl(source.sourceUrl, `${path}.sourceUrl`, errors);
      nonEmpty(source.revision, `${path}.revision`, errors);
      nonEmpty(source.artifactPath, `${path}.artifactPath`, errors);
      sha256(source.artifactSha256, `${path}.artifactSha256`, errors);
      sha256(source.actionSha256, `${path}.actionSha256`, errors);
      nonEmpty(source.declaredLicense, `${path}.declaredLicense`, errors);
      if (typeof source.declaredLicense === "string"
          && INELIGIBLE_LICENSES.has(source.declaredLicense.trim().toLowerCase())) {
        errors.push(`${path}.declaredLicense is not an explicit reusable license`);
      }
      httpsUrl(source.licenseEvidenceUrl, `${path}.licenseEvidenceUrl`, errors);
      if (source.reuseDecision !== "approved-private-research") {
        errors.push(`${path}.reuseDecision must equal approved-private-research`);
      }
      nonEmpty(source.reviewedBy, `${path}.reviewedBy`, errors);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function assertInputTraceProvenance(value) {
  const result = validateInputTraceProvenance(value);
  assert.equal(result.valid, true, `Invalid input-trace provenance:\n${result.errors.join("\n")}`);
}
