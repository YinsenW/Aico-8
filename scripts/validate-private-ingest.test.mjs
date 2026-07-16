import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(repository, "scripts/validate-private-ingest.ts");
const tsx = path.join(repository, "node_modules/.bin/tsx");
const sourceFixture = path.join(repository, "tests/fixtures/ingest/synthetic-alias/source/source.p8");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function setup({ malformed = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aico8-private-ingest-test-"));
  const carts = path.join(root, "carts");
  fs.mkdirSync(carts);
  const source = fs.readFileSync(sourceFixture);
  fs.writeFileSync(path.join(carts, "one.p8.png"), source);
  fs.writeFileSync(path.join(carts, "two.p8"), malformed ? "not a cart\n" : source);
  const evidence = path.join(root, "rights.md");
  fs.writeFileSync(evidence, "private test authorization\n");
  const fake = path.join(root, "fake-shrinko8.mjs");
  const fakeBody = "#!/usr/bin/env node\nimport fs from 'node:fs';const [s,t,f,v]=process.argv.slice(2);if(f==='--format'&&v==='rom')fs.writeFileSync(t,Buffer.alloc(0x8000,7));else fs.copyFileSync(s,t);\n";
  fs.writeFileSync(fake, fakeBody);
  fs.chmodSync(fake, 0o755);
  const environment = {
    ...process.env,
    AICO8_PRIVATE_CARTS: carts,
    AICO8_PRIVATE_INGEST_REPORT: path.join(root, "private/report.json"),
    AICO8_INGEST_RIGHTS_EVIDENCE: evidence,
    AICO8_INGEST_ATTESTATION: path.join(root, "attestation.json"),
    AICO8_INGEST_CODEC_COMMAND: fake,
    AICO8_INGEST_CODEC_REVISION: fake,
    AICO8_INGEST_CODEC_SHA256: sha256(Buffer.from(fakeBody)),
    AICO8_INGEST_CODEC_VERSION: "1.0.0",
    AICO8_INGEST_CONCURRENCY: "2",
  };
  return { root, environment };
}

test("private validator covers every cart and verifies its retained aggregate evidence", () => {
  const item = setup();
  try {
    execFileSync(tsx, [script], { cwd: repository, env: { ...item.environment, AICO8_WRITE_ATTESTATION: "1" } });
    execFileSync(tsx, [script], { cwd: repository, env: item.environment });
    const report = JSON.parse(fs.readFileSync(item.environment.AICO8_PRIVATE_INGEST_REPORT, "utf8"));
    assert.deepEqual(report.summary, { total: 2, passed: 2, failed: 0 });
    const attestation = JSON.parse(fs.readFileSync(item.environment.AICO8_INGEST_ATTESTATION, "utf8"));
    assert.equal(attestation.observations.exact_rom_round_trip, true);
    assert.equal(attestation.private_artifact_sha256.corpus_report, sha256(fs.readFileSync(item.environment.AICO8_PRIVATE_INGEST_REPORT)));
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("private validator records all failures and refuses a passing attestation", () => {
  const item = setup({ malformed: true });
  try {
    const result = spawnSync(tsx, [script], { cwd: repository, env: { ...item.environment, AICO8_WRITE_ATTESTATION: "1" }, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /failed for 1\/2 carts/);
    const report = JSON.parse(fs.readFileSync(item.environment.AICO8_PRIVATE_INGEST_REPORT, "utf8"));
    assert.deepEqual(report.summary, { total: 2, passed: 1, failed: 1 });
    assert.equal(fs.existsSync(item.environment.AICO8_INGEST_ATTESTATION), false);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});
