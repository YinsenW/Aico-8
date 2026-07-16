import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const qualificationRoot = process.env.AICO8_PRIVATE_QUALIFICATION_ROOT;
const encodedDirectory = process.env.AICO8_PRIVATE_CARTS;
assert.ok(qualificationRoot, "AICO8_PRIVATE_QUALIFICATION_ROOT is required");
assert.ok(encodedDirectory, "AICO8_PRIVATE_CARTS is required");

execFileSync(process.execPath, [
  "--experimental-strip-types",
  path.join(repository, "scripts/build-private-qualification-plan.ts"),
  "--analysis", path.join(qualificationRoot, "evidence/corpus-analysis.json"),
  "--audio", path.join(qualificationRoot, "evidence/audio-analysis.json"),
  "--compile", path.join(qualificationRoot, "evidence/z8lua-compile-audit.json"),
  "--selection", path.join(qualificationRoot, "selection-input.json"),
  "--encoded-dir", encodedDirectory,
  "--out", path.join(qualificationRoot, "qualification-plan.json"),
  "--attestation", path.join(repository, "governance/evidence/qualification-corpus-plan.json"),
  "--write", "false",
], { cwd: repository, stdio: "inherit" });
