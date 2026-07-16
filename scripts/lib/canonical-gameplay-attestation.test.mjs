import test from "node:test";
import assert from "node:assert/strict";

import { assertCanonicalGameplayAttestation } from "./canonical-gameplay-attestation.mjs";

const valid = () => ({
  schema_version: 1,
  selector: "TEST-QUALIFICATION-GAMEPLAY-PRIVATE",
  observations: { audio_diagnostic_flags: 0 },
});

test("accepts a canonical gameplay attestation with explicit zero diagnostic audio", () => {
  assert.doesNotThrow(() => assertCanonicalGameplayAttestation(valid()));
});

test("rejects a stale attestation that omits the diagnostic execution fact", () => {
  const attestation = valid();
  delete attestation.observations.audio_diagnostic_flags;
  assert.throws(() => assertCanonicalGameplayAttestation(attestation), /must record/);
});

test("rejects any attestation that used unqualified diagnostic audio", () => {
  const attestation = valid();
  attestation.observations.audio_diagnostic_flags = 1;
  assert.throws(() => assertCanonicalGameplayAttestation(attestation), /cannot accept/);
});
