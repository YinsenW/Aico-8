import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createShrinko8Codec, hashCodecRevision } from "./shrinko8-codec.js";

const temporary: string[] = [];
const decoded = Buffer.from("pico-8 cartridge // http://www.pico-8.com\nversion 42\n__lua__\nprint(1)\n");

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fakeCodecScript(): Promise<{ root: string; script: string; hash: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "aico8-shrinko8-test-"));
  temporary.push(root);
  const script = path.join(root, "fake-shrinko8.mjs");
  const body = `import fs from "node:fs";\nconst [source,target,flag,format]=process.argv.slice(2);\nif(flag==="--format"&&format==="rom")fs.writeFileSync(target,Buffer.alloc(0x8000,7));\nelse fs.writeFileSync(target,Buffer.from("${decoded.toString("base64")}","base64"));\n`;
  await writeFile(script, body);
  return { root, script, hash: sha256(Buffer.from(body)) };
}

afterEach(async () => Promise.all(temporary.splice(0).map((item) => rm(item, { recursive: true, force: true }))));

describe("shrinko8 codec adapter", () => {
  it("pins the invoked revision and converts encoded inputs and P8 ROM output without a shell", async () => {
    const fake = await fakeCodecScript();
    const codec = await createShrinko8Codec({
      command: process.execPath,
      prefixArgs: [fake.script],
      revisionPath: fake.script,
      expectedRevisionSha256: fake.hash,
      version: "1.0.0",
    });
    expect(codec.revisionSha256).toBe(fake.hash);
    expect(await codec.decodeToP8(Buffer.from("encoded"), "p8-png")).toEqual(decoded);
    expect((await codec.encodeRom(decoded)).byteLength).toBe(0x8000);
    expect(Buffer.from(await codec.decodeToP8(decoded, "p8-text"))).toEqual(decoded);
  });

  it("rejects floating revisions and invalid version declarations before execution", async () => {
    const fake = await fakeCodecScript();
    await expect(createShrinko8Codec({
      command: process.execPath,
      prefixArgs: [fake.script],
      revisionPath: fake.script,
      expectedRevisionSha256: "a".repeat(64),
      version: "1.0.0",
    })).rejects.toThrow(/pinned sha256/);
    await expect(createShrinko8Codec({
      command: process.execPath,
      revisionPath: fake.script,
      expectedRevisionSha256: fake.hash,
      version: "latest",
    })).rejects.toThrow(/semantic version/);
    await expect(createShrinko8Codec({
      command: process.execPath,
      revisionPath: fake.script,
      expectedRevisionSha256: fake.hash,
      version: "1.0.0",
      timeoutMs: 0,
    })).rejects.toThrow(/timeout/);
  });

  it("hashes a sorted source tree while rejecting symlinks and ignoring Python caches", async () => {
    const fake = await fakeCodecScript();
    const directory = path.join(fake.root, "revision");
    await mkdir(path.join(directory, "__pycache__"), { recursive: true });
    await writeFile(path.join(directory, "b.py"), "b");
    await writeFile(path.join(directory, "a.py"), "a");
    await writeFile(path.join(directory, "__pycache__/a.pyc"), "ignored");
    const first = await hashCodecRevision(directory);
    await writeFile(path.join(directory, "__pycache__/a.pyc"), "changed but ignored");
    expect(await hashCodecRevision(directory)).toBe(first);
    await symlink(path.join(directory, "a.py"), path.join(directory, "alias.py"));
    await expect(hashCodecRevision(directory)).rejects.toThrow(/symlinks/);
  });
});
