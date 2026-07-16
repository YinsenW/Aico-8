import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repository, "scripts/ingest-cart.ts");
const tsx = path.join(repository, "node_modules/.bin/tsx");
const fixture = path.join(repository, "tests/fixtures/ingest/synthetic-alias");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aico8-ingest-cli-"));
  fs.mkdirSync(path.join(root, "source"));
  fs.mkdirSync(path.join(root, "rights"));
  const source = fs.readFileSync(path.join(fixture, "source/source.p8"));
  const rights = fs.readFileSync(path.join(fixture, "rights/CC0-1.0.txt"));
  fs.writeFileSync(path.join(root, "source/source.p8"), source);
  fs.writeFileSync(path.join(root, "rights/CC0-1.0.txt"), rights);
  const fake = path.join(root, "fake-shrinko8.mjs");
  const fakeBody = "import fs from 'node:fs';const [s,t,f,v]=process.argv.slice(2);if(f==='--format'&&v==='rom')fs.writeFileSync(t,Buffer.alloc(0x8000,9));else fs.copyFileSync(s,t);\n";
  fs.writeFileSync(fake, fakeBody);
  const manifest = {
    schemaVersion: "aico8.cart-input.v1",
    inputId: "synthetic-cli",
    format: "p8-text",
    source: { path: "source/source.p8", sha256: sha256(source), byteLength: source.length },
    provenance: {
      suppliedBy: "cli-test",
      intendedUse: "public-synthetic-fixture",
      sourceUrl: null,
      declaredLicense: { spdx: "CC0-1.0", evidence: [{ path: "rights/CC0-1.0.txt", sha256: sha256(rights), byteLength: rights.length }] },
      releasePermission: { status: "granted", evidence: [{ path: "rights/CC0-1.0.txt", sha256: sha256(rights), byteLength: rights.length }] },
    },
  };
  fs.writeFileSync(path.join(root, "cart-input.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { root, fake, fakeHash: sha256(Buffer.from(fakeBody)) };
}

function run(item, sha = item.fakeHash, pnpmSeparator = false) {
  return execFileSync(tsx, [
    cli,
    ...(pnpmSeparator ? ["--"] : []),
    "--manifest", path.join(item.root, "cart-input.json"),
    "--output", path.join(item.root, "workspace"),
    "--codec-command", process.execPath,
    "--codec-prefix", item.fake,
    "--codec-revision", item.fake,
    "--codec-sha256", sha,
    "--codec-version", "1.0.0",
  ], { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

test("CLI materializes a provenance-bound TypeScript ingest workspace", () => {
  const item = setup();
  try {
    const output = JSON.parse(run(item));
    assert.equal(output.workspaceId, "synthetic-cli");
    const workspace = JSON.parse(fs.readFileSync(path.join(item.root, "workspace/workspace.json"), "utf8"));
    assert.equal(workspace.codec.revisionSha256, item.fakeHash);
    assert.equal(workspace.rebuild.sourceEquivalent, true);
    assert.deepEqual(fs.readFileSync(path.join(item.root, "workspace/source/source.p8")), fs.readFileSync(path.join(fixture, "source/source.p8")));
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("CLI rejects an unpinned codec before creating a workspace", () => {
  const item = setup();
  try {
    assert.throws(() => run(item, "a".repeat(64)), /pinned sha256/);
    assert.equal(fs.existsSync(path.join(item.root, "workspace")), false);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("CLI accepts pnpm's preserved option separator", () => {
  const item = setup();
  try {
    const output = JSON.parse(run(item, item.fakeHash, true));
    assert.equal(output.workspaceId, "synthetic-cli");
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("CLI rejects a manifest file that escapes its root through a symlink", () => {
  const item = setup();
  try {
    fs.rmSync(path.join(item.root, "source/source.p8"));
    fs.symlinkSync(path.join(fixture, "source/source.p8"), path.join(item.root, "source/source.p8"));
    assert.throws(() => run(item), /escapes its root through a symlink/);
    assert.equal(fs.existsSync(path.join(item.root, "workspace")), false);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});
