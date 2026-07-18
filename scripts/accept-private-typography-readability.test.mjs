import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const acceptScript = path.join(repository, "scripts/accept-private-typography-readability.ts");
const verifyScript = path.join(repository, "scripts/validate-private-typography-accessibility.ts");
const tsx = path.join(repository, "node_modules/.bin/tsx");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function write(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

function sample(id, size = 16) {
  return {
    id,
    role: "menu",
    fontSizeCssPx: size,
    minimumCssPx: 16,
    measuredWidthCssPx: 40,
    availableWidthCssPx: 80,
    measuredLineHeightCssPx: 20,
    availableHeightCssPx: 24,
    foreground: "#ffffff",
    background: "#002b4f",
    contrastRatio: 14.399,
    requiredContrastRatio: size >= 24 ? 3 : 4.5,
    fits: true,
    overflowed: false,
  };
}

function makeWorkspace() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "aico8-type-accept-"));
  const sourceBytes = Buffer.from("private source rom");
  const inventoryBytes = Buffer.from("private text inventory");
  write(path.join(workspace, "source.rom"), sourceBytes);
  write(path.join(workspace, "validation/text-inventory.json"), inventoryBytes);
  const manifestBytes = fs.readFileSync(path.join(repository, "apps/web/public/typography/latin-ui-v1.json"));
  const audit = {
    schemaVersion: "aico8.typography-accessibility-audit.v1",
    status: "draft",
    gameId: "dust-bunny",
    sourceSha256: sha256(sourceBytes),
    typographyManifestSha256: sha256(manifestBytes),
    textInventorySha256: sha256(inventoryBytes),
    languageCoverage: [{ locale: "en-US", script: "Latn", status: "complete", missingCodePoints: [] }],
    unsupportedScripts: ["Hans", "Hant", "Jpan", "Hang"].map((script) => ({
      script, reason: "no-bundled-font-coverage",
    })),
    deliveryProfiles: [
      { id: "square-handheld-1024x1024", viewport: { width: 1024, height: 1024 }, samples: [sample("square-menu", 32)] },
      { id: "android-handheld-landscape-1280x720", viewport: { width: 1280, height: 720 }, samples: [sample("landscape-menu", 22)] },
      { id: "phone-portrait-390x844", viewport: { width: 390, height: 844 }, samples: [sample("phone-menu", 16)] },
    ],
    assistiveText: {
      descriptionsObserved: 3,
      sceneIds: ["scene.title", "scene.gameplay", "scene.ending"],
      missingSceneIds: [],
      unprovenDescriptionIds: [],
      compatibilityStateMutations: 0,
    },
    manualReadability: { status: "pending" },
    regressions: [
      "undersized-text", "low-contrast", "unsupported-code-point",
      "unproven-assistive-copy", "compatibility-state-drift",
    ].map((category) => ({ category, rejected: true })),
  };
  const auditBytes = Buffer.from(`${JSON.stringify(audit, null, 2)}\n`);
  write(path.join(workspace, "validation/typography-accessibility-audit.json"), auditBytes);
  const screenshotDefinitions = [
    ["phone-title", 390, 844, "scene.title"],
    ["phone-gameplay", 390, 844, "scene.gameplay"],
    ["square-gameplay", 1024, 1024, "scene.gameplay"],
    ["landscape-gameplay", 1280, 720, "scene.gameplay"],
  ];
  const screenshots = screenshotDefinitions.map(([id, width, height, sceneId]) => {
    const bytes = Buffer.from(`review screenshot ${id}`);
    const relativePath = `evidence/accessibility-review/${id}.png`;
    write(path.join(workspace, relativePath), bytes);
    return { id, path: relativePath, sha256: sha256(bytes), viewport: { width, height }, sceneId };
  });
  const packet = {
    schemaVersion: "aico8.typography-accessibility-review.v1",
    status: "pending-human-readability-decision",
    gameId: audit.gameId,
    sourceSha256: audit.sourceSha256,
    build: {
      target: "web-pwa",
      outputProfile: "hd-1024-square",
      releaseManifestSha256: "a".repeat(64),
      visualRuntimeSha256: "b".repeat(64),
      validationReplaySemanticsSha256: "c".repeat(64),
    },
    audit: { path: "validation/typography-accessibility-audit.json", sha256: sha256(auditBytes) },
    screenshots,
    humanCriteria: ["phone title", "HUD labels", "complete glyphs", "visual hierarchy"],
  };
  write(path.join(workspace, "evidence/typography-accessibility-review.json"),
    Buffer.from(`${JSON.stringify(packet, null, 2)}\n`));
  return workspace;
}

function accept(workspace, overrides = {}) {
  return spawnSync(process.execPath, [
    "--experimental-strip-types", acceptScript,
    "--workspace", workspace,
    "--reviewer", "independent-reviewer",
    "--phone-title", overrides.phoneTitle ?? "passed",
    "--hud-labels", "passed",
    "--glyphs", "passed",
    "--hierarchy", "passed",
    "--notes", "Reviewed every declared profile and criterion.",
    "--write", overrides.write ?? "true",
  ], { cwd: repository, encoding: "utf8" });
}

test("records and re-verifies an immutable all-pass typography decision", () => {
  const workspace = makeWorkspace();
  try {
    const result = accept(workspace);
    assert.equal(result.status, 0, result.stderr);
    const audit = JSON.parse(fs.readFileSync(
      path.join(workspace, "validation/typography-accessibility-audit.json"), "utf8",
    ));
    assert.equal(audit.status, "accepted");
    assert.equal(audit.manualReadability.reviewer, "independent-reviewer");
    const verification = spawnSync(tsx, [verifyScript], {
      cwd: repository,
      env: { ...process.env, AICO8_PRIVATE_WORKSPACE: workspace },
      encoding: "utf8",
    });
    assert.equal(verification.status, 0, verification.stderr);
    assert.match(verification.stdout, /Private typography accessibility: PASS/);

    const decisionPath = path.join(workspace, "evidence/typography-readability-decision.json");
    const decisionBytes = fs.readFileSync(decisionPath);
    const decision = JSON.parse(fs.readFileSync(decisionPath, "utf8"));
    const pendingAuditPath = path.join(
      workspace,
      `evidence/readability-reviews/${decision.subject.reviewPacketSha256}/pending-typography-accessibility-audit.json`,
    );
    fs.copyFileSync(pendingAuditPath, path.join(workspace, "validation/typography-accessibility-audit.json"));
    const replay = accept(workspace);
    assert.equal(replay.status, 0, replay.stderr);
    assert.deepEqual(fs.readFileSync(decisionPath), decisionBytes,
      "replaying an exact decision must not rewrite its immutable bytes");
    const replayedAudit = JSON.parse(fs.readFileSync(
      path.join(workspace, "validation/typography-accessibility-audit.json"), "utf8",
    ));
    assert.equal(replayedAudit.status, "accepted");

    decision.reviewer = "forged-reviewer";
    fs.writeFileSync(decisionPath, `${JSON.stringify(decision, null, 2)}\n`);
    const forged = spawnSync(tsx, [verifyScript], {
      cwd: repository,
      env: { ...process.env, AICO8_PRIVATE_WORKSPACE: workspace },
      encoding: "utf8",
    });
    assert.notEqual(forged.status, 0);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("requires explicit mutation authority and derives rejection from a failed check", () => {
  const dryWorkspace = makeWorkspace();
  const rejectedWorkspace = makeWorkspace();
  try {
    const dry = accept(dryWorkspace, { write: "false" });
    assert.notEqual(dry.status, 0);
    assert.equal(fs.existsSync(path.join(dryWorkspace, "evidence/typography-readability-decision.json")), false);

    const rejected = accept(rejectedWorkspace, { phoneTitle: "failed" });
    assert.equal(rejected.status, 0, rejected.stderr);
    const audit = JSON.parse(fs.readFileSync(
      path.join(rejectedWorkspace, "validation/typography-accessibility-audit.json"), "utf8",
    ));
    assert.equal(audit.status, "draft");
    assert.equal(audit.manualReadability.status, "rejected");
  } finally {
    fs.rmSync(dryWorkspace, { recursive: true, force: true });
    fs.rmSync(rejectedWorkspace, { recursive: true, force: true });
  }
});
