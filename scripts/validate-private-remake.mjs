import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceValue = process.env.AICO8_PRIVATE_WORKSPACE;
assert.ok(workspaceValue, "AICO8_PRIVATE_WORKSPACE must point to the authorized ignored workspace");
const workspace = path.resolve(workspaceValue);
const contentEvidencePath = path.join(workspace, "evidence/first-remake-validation.json");
const browserEvidencePath = path.join(workspace, "evidence/browser-validation.json");
for (const file of [contentEvidencePath, browserEvidencePath, path.join(workspace, "source.rom"),
  path.join(workspace, "code.p8.lua"), path.join(workspace, "web-overlay/dust-bunny-hd.ts")]) {
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

try {
  run("pnpm", ["--filter", "@aico8/web", "test"]);
  run("make", ["-C", "runtime/core", "wasm-test"]);
  runNode(buildArguments(outputA));
  runNode([path.join(root, "scripts/verify-web-package.mjs"), outputA]);
  runNode([path.join(workspace, "validation/verify-content.mjs")], { AICO8_REPO: root });
  runNode(buildArguments(outputB));
  runNode([path.join(root, "scripts/verify-web-package.mjs"), outputB]);
  const manifestA = fs.readFileSync(path.join(outputA, "release-manifest.json"));
  const manifestB = fs.readFileSync(path.join(outputB, "release-manifest.json"));
  assert.deepEqual(manifestA, manifestB, "Two clean private builds must have byte-identical release manifests");

  const release = JSON.parse(manifestA);
  const content = JSON.parse(fs.readFileSync(contentEvidencePath, "utf8"));
  const browser = JSON.parse(fs.readFileSync(browserEvidencePath, "utf8"));
  assert.equal(content.semanticReplay.result, "win-and-persist-level-2");
  assert.equal(content.completeContent.levels.length, 30);
  assert.equal(content.completeContent.winTransitions, 30);
  assert.equal(content.completeContent.ending, true);
  assert.equal(content.completeContent.restartFromEnding, true);
  assert.equal(content.completeContent.completedProgressReset, true);
  assert.equal(content.audio.profile, "original-silent-cart");
  assert.equal(content.audio.sfxOrMusicCalls, false);
  assert.ok(Object.values(browser.checks).every((value) => value === true), "Every browser review check must pass");
  assert.equal(release.rights.sourceLicense, content.license.id);

  const attestation = {
    schema_version: 1,
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
      unchanged_level_one_replay: true,
      real_level_maps_loaded: content.completeContent.levels.length,
      win_transitions: content.completeContent.winTransitions,
      ending: content.completeContent.ending,
      ending_restart: content.completeContent.restartFromEnding,
      progress_reset: content.completeContent.completedProgressReset,
      audio_profile: content.audio.profile,
    },
    presentation_and_hosts: browser.checks,
    package: {
      target: release.target,
      output_profile: release.output_profile,
      artifact_count: release.artifacts.length,
      release_manifest_sha256: sha256(path.join(outputA, "release-manifest.json")),
      two_builds_byte_identical: true,
    },
    private_evidence: {
      lifecycle: "ignored authorized workspace",
      retained: true,
      public_cart_or_derived_payload: false,
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
  process.stdout.write("Private remake selector: PASS (content, browser review, PWA, two-build identity)\n");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
