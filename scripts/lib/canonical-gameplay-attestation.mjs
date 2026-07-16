import assert from "node:assert/strict";

export function assertCanonicalGameplayAttestation(attestation) {
  assert.ok(attestation && typeof attestation === "object" && !Array.isArray(attestation),
    "canonical gameplay attestation must be an object");
  assert.equal(attestation.schema_version, 1,
    "canonical gameplay attestation schema_version must be 1");
  assert.equal(attestation.selector, "TEST-QUALIFICATION-GAMEPLAY-PRIVATE",
    "canonical gameplay attestation must name its private selector");
  assert.ok(attestation.observations && typeof attestation.observations === "object"
    && !Array.isArray(attestation.observations),
  "canonical gameplay attestation observations must be an object");
  assert.ok(Object.hasOwn(attestation.observations, "audio_diagnostic_flags"),
    "canonical gameplay attestation must record audio_diagnostic_flags");
  assert.equal(attestation.observations.audio_diagnostic_flags, 0,
    "canonical gameplay attestation cannot accept unqualified diagnostic audio");
}
