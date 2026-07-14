import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  validateReleaseManifest,
  validateReleaseValidation,
  validateTargetProfile,
} from "../packages/contracts/src/release.ts";
import { assertFullViewportScreenshot } from "./lib/viewport-evidence.mjs";

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

function jpegDimensions(file: string): { width: number; height: number } {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes[0], 0xff, `${file}: JPEG start marker`);
  assert.equal(bytes[1], 0xd8, `${file}: JPEG start marker`);
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) throw new Error(`${file}: invalid JPEG segment`);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  throw new Error(`${file}: dimensions not found`);
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
assert.equal(browser.layoutQualification.source, "real-packaged-build-active-browser");
assert.equal(browser.layoutQualification.profiles.length, report.layouts.length);
const workspaceRoot = path.resolve(path.dirname(browserEvidencePath), "..");
const browserLayouts = browser.layoutQualification.profiles.map((profile: any) => {
  assert.equal(profile.screenshot.visualRuntimeSha256, report.subject.visualRuntimeSha256,
    `${profile.id}: layout screenshot visual-runtime identity`);
  const screenshotPath = path.resolve(workspaceRoot, profile.screenshot.path);
  assert.ok(screenshotPath.startsWith(`${workspaceRoot}${path.sep}`), `${profile.id}: unsafe layout screenshot path`);
  assert.equal(sha256(screenshotPath), profile.screenshot.sha256, `${profile.id}: layout screenshot sha256`);
  const dimensions = jpegDimensions(screenshotPath);
  assert.deepEqual(dimensions, {
    width: profile.screenshot.width,
    height: profile.screenshot.height,
  }, `${profile.id}: layout screenshot dimensions`);
  assertFullViewportScreenshot(profile, dimensions);
  const { screenshot, ...measurement } = profile;
  return { ...measurement, screenshotSha256: screenshot.sha256 };
});
assert.deepEqual(report.layouts, browserLayouts,
  "Technical layout report must reproduce every real-browser viewport measurement");
for (const check of ["packagedBuildLoaded", "mobileLayoutFitsViewport", "touchTargetsMeetFloor", "bundledFontsLoaded", "hdDiagnosticsClean"]) {
  assert.equal(browser.checks[check], true, `Browser accessibility/package evidence failed: ${check}`);
}
assert.equal(report.checks.manifest, true);
assert.equal(report.checks.checksums, true);
assert.equal(report.checks.notices, true);
assert.equal(report.checks.accessibility, true);
assert.equal(report.checks.packageBudgets, true);
assert.equal(report.checks.runtimeBudgets, true);
assert.equal(report.checks.layoutProfiles, true);
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
