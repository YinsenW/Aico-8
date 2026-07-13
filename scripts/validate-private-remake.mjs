import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validationReplaySemanticsSha256 } from "./lib/release-identities.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceValue = process.env.AICO8_PRIVATE_WORKSPACE;
assert.ok(workspaceValue, "AICO8_PRIVATE_WORKSPACE must point to the authorized ignored workspace");
const workspace = path.resolve(workspaceValue);
const browserEvidencePath = path.join(workspace, "evidence/browser-validation.json");
const canonicalReplayPath = path.join(workspace, "validation/canonical-replay-v1.json");
const canonicalAuditPath = path.join(workspace, "validation/canonical-run-audit.json");
const identityMapPath = path.join(workspace, "validation/hd-identity-map.json");
const hdAuditPath = path.join(workspace, "validation/hd-presentation-audit.json");
for (const file of [browserEvidencePath, canonicalReplayPath, canonicalAuditPath, identityMapPath, hdAuditPath,
  path.join(workspace, "source.rom"), path.join(workspace, "code.p8.lua"),
  path.join(workspace, "web-overlay/dust-bunny-hd.ts")]) {
  assert.ok(fs.statSync(file, { throwIfNoEntry: false })?.isFile(), `Missing private trial input: ${file}`);
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aico8-private-remake-"));
const outputA = path.join(temporaryRoot, "build-a");
const outputB = path.join(temporaryRoot, "build-b");
const buildArguments = (output) => [
  path.join(root, "scripts/build-private-web.mjs"),
  "--workspace", workspace,
  "--out", output,
  "--id", "dust-bunny-private-research",
  "--title", "Dust Bunny",
  "--author", "Adam Atomic",
  "--presentation", "dust-bunny-hd",
  "--source-license", "CC-BY-NC-SA-4.0",
  "--source-url", "https://www.lexaloffle.com/bbs/?pid=dust_bunny",
  "--validation-replay", "validation/canonical-replay-v1.json",
];

function run(command, arguments_, extraEnv = {}) {
  execFileSync(command, arguments_, {
    cwd: root,
    env: { ...process.env, SOURCE_DATE_EPOCH: "0", TZ: "UTC", ...extraEnv },
    stdio: "inherit",
  });
}
function runNode(arguments_, extraEnv) {
  run(process.execPath, arguments_, extraEnv);
}
function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function jpegDimensions(file) {
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
    assert.ok(length >= 2 && offset + length <= bytes.length, `${file}: valid JPEG segment`);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  assert.fail(`${file}: JPEG dimensions were not found`);
}

try {
  runNode([path.join(root, "scripts/validate-private-qualification.mjs")]);
  run("pnpm", ["--filter", "@aico8/web", "test"]);
  run("make", ["-C", "runtime/core", "wasm-test"]);
  runNode(buildArguments(outputA));
  runNode([path.join(root, "scripts/verify-web-package.mjs"), outputA]);
  runNode(buildArguments(outputB));
  runNode([path.join(root, "scripts/verify-web-package.mjs"), outputB]);
  const manifestA = fs.readFileSync(path.join(outputA, "release-manifest.json"));
  const manifestB = fs.readFileSync(path.join(outputB, "release-manifest.json"));
  assert.deepEqual(manifestA, manifestB, "Two clean private builds must have byte-identical release manifests");

  const release = JSON.parse(manifestA);
  const replay = JSON.parse(fs.readFileSync(canonicalReplayPath, "utf8"));
  const canonicalAudit = JSON.parse(fs.readFileSync(canonicalAuditPath, "utf8"));
  const identityMap = JSON.parse(fs.readFileSync(identityMapPath, "utf8"));
  const hdAudit = JSON.parse(fs.readFileSync(hdAuditPath, "utf8"));
  const browser = JSON.parse(fs.readFileSync(browserEvidencePath, "utf8"));
  assert.equal(replay.schemaVersion, "aico8.replay.v1");
  assert.equal(replay.result.completed, true);
  assert.equal(replay.canonicality.testHooks, false);
  assert.equal(replay.canonicality.cartMutation, "none");
  assert.equal(canonicalAudit.levelsCompleted, 30);
  assert.equal(canonicalAudit.ending.reached, true);
  assert.equal(canonicalAudit.ending.restartCompleted, true);
  assert.equal(canonicalAudit.persistenceBoundaries.at(-1).storedLevel, 0);
  assert.equal(identityMap.status, "draft", "human side-by-side identity review remains an independent gate");
  assert.ok(identityMap.elements.every((element) => element.review.reviewer === "pending-human-side-by-side-review"));
  assert.equal(hdAudit.status, "draft");
  assert.equal(hdAudit.totalLogicalUpdates, 9224);
  assert.deepEqual(hdAudit.coverage.unmappedSourceTokenIds, []);
  assert.equal(hdAudit.coverage.mixedIndexedFragments, 0);
  assert.equal(hdAudit.coverage.diagnosticReferenceSwitches, 0);
  assert.deepEqual(hdAudit.invariance.mismatchUpdateIds, []);
  const sourceText = fs.readFileSync(path.join(workspace, "code.p8.lua"), "utf8");
  assert.equal(/\b(?:sfx|music)\s*\(/.test(sourceText), false, "Dust Bunny source audio profile changed");
  assert.equal(browser.schemaVersion, 4);
  assert.equal(browser.build.target, release.target);
  assert.equal(browser.build.outputProfile, release.output_profile);
  assert.equal(browser.build.artifactCount, release.artifacts.length);
  assert.match(browser.build.captureReleaseManifestSha256, /^[a-f0-9]{64}$/);
  assert.equal(browser.build.visualRuntimeIdentitySchema, release.identities.visual_runtime_schema);
  assert.equal(browser.build.visualRuntimeSha256, release.identities.visual_runtime_sha256,
    "Browser evidence must bind the same visual runtime even when replay provenance metadata is regenerated");
  assert.equal(browser.interaction.inputSurface, "visible touch-control buttons");
  assert.equal(browser.interaction.path, "RRRRULLDDRR");
  assert.equal(browser.interaction.resultScene, "scene.win");
  assert.equal(browser.interaction.resultStatus, "Level 1 complete. Spotless.");
  assert.equal(browser.interaction.testHooks, false);
  assert.equal(browser.interaction.stateWrites, false);
  const gameCompleteMilestone = replay.milestones.find(({ id }) => id === "game-complete");
  assert.ok(gameCompleteMilestone, "Canonical replay must declare game-complete");
  assert.match(browser.validationReplay.capturedArtifactSha256, /^[a-f0-9]{64}$/);
  assert.equal(browser.validationReplay.semanticIdentitySchema,
    release.identities.validation_replay_semantics_schema);
  assert.equal(browser.validationReplay.semanticsSha256,
    release.identities.validation_replay_semantics_sha256);
  assert.equal(browser.validationReplay.semanticsSha256,
    validationReplaySemanticsSha256(replay));
  assert.equal(release.identities.validation_replay_sha256, sha256(canonicalReplayPath));
  assert.equal(browser.validationReplay.replayId, replay.replayId);
  assert.equal(browser.validationReplay.cartSha256, replay.cartSha256);
  assert.equal(browser.validationReplay.initialStateKind, replay.trace.initialState.kind);
  assert.equal(browser.validationReplay.initialPersistenceSha256, replay.trace.initialState.persistenceSha256);
  assert.equal(browser.validationReplay.milestoneId, gameCompleteMilestone.id);
  assert.equal(browser.validationReplay.updatesExecuted, gameCompleteMilestone.atUpdate);
  assert.equal(browser.validationReplay.totalUpdates, replay.trace.totalUpdates);
  assert.equal(browser.validationReplay.inputSource, replay.canonicality.inputSource);
  assert.equal(browser.validationReplay.logicalUpdatePolicy, replay.canonicality.logicalUpdatePolicy);
  assert.equal(browser.validationReplay.wallClockAcceleration, replay.canonicality.wallClockAcceleration);
  assert.equal(browser.validationReplay.testHooks, false);
  assert.equal(browser.validationReplay.compatibilityStateMutation, "none");
  assert.equal(browser.validationReplay.externalStateWrites, false);
  assert.equal(browser.validationReplay.cartPersistenceWrites, "source-authored-only");
  assert.equal(browser.mobile.canvasInternal.width, 1024);
  assert.equal(browser.mobile.canvasInternal.height, 1024);
  assert.ok(browser.mobile.directionButtonCss.width >= 44 && browser.mobile.directionButtonCss.height >= 44);
  assert.ok(browser.mobile.actionButtonCss.width >= 44 && browser.mobile.actionButtonCss.height >= 44);
  assert.equal(browser.mobile.bundledFontsLoaded, true);
  assert.equal(browser.presentationDiagnostics.unmappedVisualTokens, 0);
  assert.equal(browser.presentationDiagnostics.mixedIndexedFragments, 0);
  assert.equal(browser.presentationDiagnostics.diagnosticReferenceSwitches, 0);
  assert.equal(browser.presentationDiagnostics.referenceAndHdAreAtomicModes, true);
  assert.equal(browser.checks.copyProvenanceEnforced, true);
  assert.deepEqual(browser.presentationDiagnostics.observedScenes,
    ["scene.title", "scene.intro", "scene.gameplay", "scene.win", "scene.ending"]);
  assert.equal(browser.identityReview.status, "pending-human-side-by-side-review");
  assert.equal(browser.identityReview.reviewer, "pending-human-side-by-side-review");
  assert.equal(browser.identityReview.scenePairsComplete, true);
  assert.equal(browser.identityReview.accepted, false);
  const screenshotsById = new Map();
  for (const screenshot of browser.screenshots) {
    assert.ok(!screenshotsById.has(screenshot.id), `${screenshot.id}: duplicate screenshot ID`);
    screenshotsById.set(screenshot.id, screenshot);
    const screenshotPath = path.resolve(workspace, screenshot.path);
    assert.ok(screenshotPath.startsWith(`${workspace}${path.sep}`), `${screenshot.id}: screenshot escapes workspace`);
    assert.equal(sha256(screenshotPath), screenshot.sha256, `${screenshot.id}: screenshot hash`);
    assert.deepEqual(jpegDimensions(screenshotPath), { width: screenshot.width, height: screenshot.height },
      `${screenshot.id}: screenshot dimensions`);
    assert.equal(screenshot.visualRuntimeSha256, browser.build.visualRuntimeSha256,
      `${screenshot.id}: screenshot must bind the reviewed visual runtime`);
    assert.ok(["hd", "reference"].includes(screenshot.presentationMode), `${screenshot.id}: presentation mode`);
    assert.match(screenshot.sceneId, /^scene\.[a-z][a-z0-9-]*$/);
    assert.ok(typeof screenshot.stateBoundary === "string" && screenshot.stateBoundary.length > 0,
      `${screenshot.id}: state boundary`);
  }
  assert.deepEqual(browser.sceneComparisons.map(({ id }) => id), ["title", "intro", "gameplay", "win", "ending"]);
  for (const comparison of browser.sceneComparisons) {
    const source = screenshotsById.get(comparison.sourceScreenshotId);
    const target = screenshotsById.get(comparison.targetScreenshotId);
    assert.ok(source && target, `${comparison.id}: source and target screenshots must exist`);
    assert.equal(source.presentationMode, "reference", `${comparison.id}: source mode`);
    assert.equal(target.presentationMode, "hd", `${comparison.id}: target mode`);
    assert.equal(source.sceneId, comparison.sceneId, `${comparison.id}: source scene`);
    assert.equal(target.sceneId, comparison.sceneId, `${comparison.id}: target scene`);
    assert.equal(source.stateBoundary, target.stateBoundary, `${comparison.id}: atomic state boundary`);
    assert.equal(comparison.sameRuntimeState, true, `${comparison.id}: same-runtime-state declaration`);
  }
  for (const element of identityMap.elements) {
    for (const sceneId of element.review.sourceSceneIds) {
      assert.equal(screenshotsById.get(sceneId)?.presentationMode, "reference",
        `${element.id}: source review scene must resolve to retained reference evidence`);
    }
    for (const sceneId of element.review.targetSceneIds) {
      assert.equal(screenshotsById.get(sceneId)?.presentationMode, "hd",
        `${element.id}: target review scene must resolve to retained HD evidence`);
    }
  }
  const releaseArtifacts = new Map(release.artifacts.map((artifact) => [artifact.path, artifact]));
  assert.equal(releaseArtifacts.get("fonts/AtkinsonHyperlegible-Regular.woff2")?.sha256, browser.fonts.regularSha256);
  assert.equal(releaseArtifacts.get("fonts/AtkinsonHyperlegible-Bold.woff2")?.sha256, browser.fonts.boldSha256);
  assert.ok(Object.values(browser.checks).every((value) => value === true), "Every browser review check must pass");
  assert.equal(release.rights.sourceLicense, "CC-BY-NC-SA-4.0");

  const attestation = {
    schema_version: 2,
    subject: "first-private-web-remake",
    game: "Dust Bunny",
    distribution: "private-research-and-testing-only",
    public_payload_included: false,
    rights: {
      source_license: release.rights.sourceLicense,
      source_url: release.rights.sourceUrl,
      project_license: "Apache-2.0",
      formal_release: false,
    },
    content: {
      canonical_real_input: true,
      unchanged_cart: true,
      levels_completed: canonicalAudit.levelsCompleted,
      logical_updates: canonicalAudit.logicalUpdates,
      ending: canonicalAudit.ending.reached,
      ending_restart: canonicalAudit.ending.restartCompleted,
      progress_reset: canonicalAudit.persistenceBoundaries.at(-1).storedLevel === 0,
      audio_profile: "original-silent-cart",
    },
    presentation: {
      automated_audit_status: hdAudit.status,
      total_observed_updates: hdAudit.totalLogicalUpdates,
      source_tokens: hdAudit.sourceTokens.length,
      unmapped_source_tokens: hdAudit.coverage.unmappedSourceTokenIds.length,
      mixed_indexed_fragments: hdAudit.coverage.mixedIndexedFragments,
      state_mismatches: hdAudit.invariance.mismatchUpdateIds.length,
      browser_checks: browser.checks,
      identity_human_review_accepted: false,
    },
    package: {
      target: release.target,
      output_profile: release.output_profile,
      artifact_count: release.artifacts.length,
      visual_runtime_sha256: release.identities.visual_runtime_sha256,
      validation_replay_semantics_sha256: release.identities.validation_replay_semantics_sha256,
      two_builds_byte_identical: true,
    },
    private_evidence: {
      lifecycle: "ignored authorized workspace",
      retained: true,
      public_cart_or_derived_payload: false,
      canonical_run_audit_sha256: sha256(canonicalAuditPath),
      hd_presentation_audit_sha256: sha256(hdAuditPath),
      browser_validation_sha256: sha256(browserEvidencePath),
    },
  };
  const attestationPath = path.join(root, "governance/evidence/first-private-web-remake.json");
  const serialized = `${JSON.stringify(attestation, null, 2)}\n`;
  if (process.env.AICO8_WRITE_ATTESTATION === "1") {
    fs.writeFileSync(attestationPath, serialized);
  } else {
    assert.equal(fs.readFileSync(attestationPath, "utf8"), serialized,
      "Public attestation is stale; rerun once with AICO8_WRITE_ATTESTATION=1 and review the diff");
  }
  process.stdout.write("Private remake selector: PASS (canonical content, automated HD audit, real touch browser evidence, PWA, two-build identity; human identity review pending)\n");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
