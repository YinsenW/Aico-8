import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  validateReleaseManifest,
  validateReleaseValidation,
  validateTargetProfile,
} from "../packages/contracts/src/release.ts";

function argumentsMap(values: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Expected --name value pairs, received ${key ?? "end of input"}`);
    }
    result.set(key.slice(2), value);
  }
  return result;
}

function required(values: Map<string, string>, name: string): string {
  const value = values.get(name);
  if (!value) throw new Error(`Missing required --${name}`);
  return path.resolve(value);
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const arguments_ = argumentsMap(process.argv.slice(2));
const packageRoot = required(arguments_, "package");
const evidencePath = required(arguments_, "evidence");
const browserEvidencePath = required(arguments_, "browser-evidence");
const attestationPath = required(arguments_, "attestation");
const write = arguments_.get("write") === "true";

const profilePath = path.join(packageRoot, "target-profile.json");
const manifestPath = path.join(packageRoot, "release-manifest.json");
const profile = readJson(profilePath);
const manifest = readJson(manifestPath) as Record<string, any>;
const report = readJson(evidencePath) as Record<string, any>;
const browser = readJson(browserEvidencePath) as Record<string, any>;

const profileValidation = validateTargetProfile(profile);
assert.equal(profileValidation.ok, true, profileValidation.errors.join("\n"));
const manifestValidation = validateReleaseManifest(manifest);
assert.equal(manifestValidation.ok, true, manifestValidation.errors.join("\n"));
const reportValidation = validateReleaseValidation(report, profile);
assert.equal(reportValidation.ok, true, reportValidation.errors.join("\n"));

assert.equal(report.subject.gameId, manifest.game.id);
assert.equal(report.subject.target, manifest.target);
assert.equal(report.subject.visualRuntimeSha256, manifest.identities.visual_runtime_sha256);
assert.equal(report.targetProfile.id, manifest.target_profile.id);
assert.equal(report.targetProfile.sha256, manifest.target_profile.sha256);
assert.equal(report.targetProfile.sha256, sha256(profilePath));
assert.equal(report.package.artifactCount, manifest.measurements.artifact_count);
assert.equal(report.package.unpackedBytes, manifest.measurements.unpacked_bytes);
assert.equal(report.package.largestArtifactBytes, manifest.measurements.largest_artifact_bytes);

for (const artifact of manifest.artifacts) {
  const artifactPath = path.resolve(packageRoot, artifact.path);
  assert.ok(artifactPath.startsWith(`${packageRoot}${path.sep}`), `${artifact.path}: unsafe release artifact path`);
  assert.equal(fs.statSync(artifactPath).size, artifact.bytes, `${artifact.path}: byte count`);
  assert.equal(sha256(artifactPath), artifact.sha256, `${artifact.path}: sha256`);
}
for (const notice of ["PRIVATE-RESEARCH-ONLY.txt", "fonts/OFL-Atkinson-Hyperlegible.txt"]) {
  assert.ok(fs.statSync(path.join(packageRoot, notice), { throwIfNoEntry: false })?.isFile(), `Missing notice: ${notice}`);
}

assert.equal(browser.build.visualRuntimeSha256, report.subject.visualRuntimeSha256,
  "Browser evidence and technical release report must bind the same visual runtime");
assert.equal(browser.build.artifactCount, report.package.artifactCount);
for (const check of ["packagedBuildLoaded", "mobileLayoutFitsViewport", "touchTargetsMeetFloor", "bundledFontsLoaded", "hdDiagnosticsClean"]) {
  assert.equal(browser.checks[check], true, `Browser accessibility/package evidence failed: ${check}`);
}
assert.equal(report.checks.manifest, true);
assert.equal(report.checks.checksums, true);
assert.equal(report.checks.notices, true);
assert.equal(report.checks.accessibility, true);
assert.equal(report.checks.packageBudgets, true);
assert.equal(report.checks.runtimeBudgets, true);
assert.equal(report.status, "passed");

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (write) {
  fs.writeFileSync(attestationPath, serialized);
} else {
  assert.equal(fs.readFileSync(attestationPath, "utf8"), serialized,
    "Public technical release attestation is stale; regenerate and review it");
}

process.stdout.write(
  `Technical release validation: PASS (${report.package.artifactCount} package files, `
  + `${report.package.unpackedBytes} bytes, ${report.runtime.startupMilliseconds} ms startup, `
  + `${report.runtime.p95FrameMilliseconds} ms p95)\n`,
);
