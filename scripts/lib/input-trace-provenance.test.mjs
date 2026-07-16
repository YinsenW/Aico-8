import assert from "node:assert/strict";
import test from "node:test";
import {
  inputTraceSha256,
  validateInputTraceProvenance,
} from "./input-trace-provenance.mjs";

const hash = "a".repeat(64);

function internalProvenance() {
  return {
    schemaVersion: "aico8.input-trace-provenance.v1",
    traceSha256: hash,
    derivation: {
      kind: "first-party-search",
      generatorName: "aico8-search",
      generatorVersion: "1",
      sourceRevision: "abc1234",
    },
    externalSources: [],
  };
}

test("accepts a first-party trace with no external seed", () => {
  assert.deepEqual(validateInputTraceProvenance(internalProvenance()), { valid: true, errors: [] });
});

test("rejects a NOASSERTION external seed", () => {
  const value = internalProvenance();
  value.derivation.kind = "external-action-seed";
  value.externalSources.push({
    sourceUrl: "https://example.test/repository",
    revision: "abc1234",
    artifactPath: "solutions/game.json",
    artifactSha256: hash,
    actionSha256: hash,
    declaredLicense: "NOASSERTION",
    licenseEvidenceUrl: "https://example.test/repository/license",
    reuseDecision: "approved-private-research",
    reviewedBy: "qualification-agent",
  });
  const result = validateInputTraceProvenance(value);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /not an explicit reusable license/);
});

test("requires an external source for external-action-seed derivation", () => {
  const value = internalProvenance();
  value.derivation.kind = "external-action-seed";
  const result = validateInputTraceProvenance(value);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /must contain the contributing external action source/);
});

test("binds provenance to the complete canonical trace structure", () => {
  const first = { updateHz: 30, spans: [{ startUpdate: 0, endUpdateExclusive: 2, players: [0] }] };
  const second = structuredClone(first);
  second.spans[0].players[0] = 1;
  assert.notEqual(inputTraceSha256(first), inputTraceSha256(second));
});
