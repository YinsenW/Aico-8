import { createHash } from "node:crypto";
import fs from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { type CartInputV1, validateCartWorkspace } from "@aico8/contracts";

import { type IngestCodec, runIngestJob } from "./job.js";
import { decodeP8TextResources, parseP8Text } from "./p8-text.js";

const fixtureRoot = new URL("../../../tests/fixtures/ingest/synthetic-alias/", import.meta.url);
const source = fs.readFileSync(new URL("source/source.p8", fixtureRoot));
const rights = fs.readFileSync(new URL("rights/CC0-1.0.txt", fixtureRoot));
const temporary: string[] = [];

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function input(format: CartInputV1["format"] = "p8-text", bytes: Uint8Array = source): CartInputV1 {
  return {
    schemaVersion: "aico8.cart-input.v1",
    inputId: "synthetic-job",
    format,
    source: { path: format === "p8-text" ? "source/source.p8" : "source/source.p8.png", sha256: hash(bytes), byteLength: bytes.byteLength },
    provenance: {
      suppliedBy: "contract-test",
      intendedUse: "public-synthetic-fixture",
      sourceUrl: null,
      declaredLicense: { spdx: "CC0-1.0", evidence: [{ path: "rights/CC0-1.0.txt", sha256: hash(rights), byteLength: rights.byteLength }] },
      releasePermission: { status: "granted", evidence: [{ path: "rights/CC0-1.0.txt", sha256: hash(rights), byteLength: rights.byteLength }] },
    },
  };
}

function codec(decoded: Uint8Array = source): IngestCodec {
  return {
    id: "synthetic-test-codec",
    version: "1.0.0",
    revisionSha256: "a".repeat(64),
    async decodeToP8() { return decoded; },
    async encodeRom(p8Text) {
      const cart = parseP8Text(p8Text);
      const resources = decodeP8TextResources(cart);
      const digest = createHash("sha256").update(JSON.stringify({
        version: cart.version,
        sectionOrder: resources.sectionOrder,
        lua: resources.lua,
        gfx: resources.gfx,
        map: resources.map,
        gff: resources.gff,
        sfxLines: resources.sfxLines,
        musicLines: resources.musicLines,
        label: resources.label,
      })).digest();
      return Buffer.concat(Array.from({ length: 1024 }, () => digest));
    },
  };
}

async function root(): Promise<string> {
  const value = await mkdtemp(path.join(os.tmpdir(), "aico8-ingest-test-"));
  temporary.push(value);
  return value;
}

afterEach(async () => Promise.all(temporary.splice(0).map((item) => rm(item, { recursive: true, force: true }))));

describe("JOB-INGEST-001", () => {
  it("materializes and validates a public synthetic P8 workspace atomically", async () => {
    const base = await root();
    const destination = path.join(base, "workspace");
    const result = await runIngestJob({
      input: input(), inputBytes: source, destination, codec: codec(), async readEvidence() { return rights; },
    });
    expect(validateCartWorkspace(result.workspace, input()).ok).toBe(true);
    expect(await readFile(path.join(destination, "source/source.p8"))).toEqual(source);
    expect(await readFile(path.join(destination, "rebuild/rebuilt.p8"))).not.toEqual(source);
    expect((await readFile(path.join(destination, "rebuild/rebuilt.p8"), "utf8"))).toContain(`__gfx__\n${"0".repeat(128)}\n`);
    expect((await readFile(path.join(destination, "rebuild/source.rom.hex"), "utf8")).length).toBe(0x10001);
    expect(result.workspace.resources.map((item) => item.id)).toEqual([
      "lua", "gfx", "shared-map-alias", "map", "gff", "sfx", "music", "label",
    ]);
  });

  it("keeps original encoded identity separate from decoded P8 and rebuilt ROM identity", async () => {
    const base = await root();
    const encoded = Buffer.from("synthetic encoded cart");
    const publicDeclaration = input("p8-png", encoded);
    const declared: CartInputV1 = {
      ...publicDeclaration,
      provenance: {
        ...publicDeclaration.provenance,
        intendedUse: "private-research",
        releasePermission: { status: "unknown", evidence: [] },
      },
    };
    const result = await runIngestJob({
      input: declared, inputBytes: encoded, destination: path.join(base, "workspace"), codec: codec(), async readEvidence() { return rights; },
    });
    expect(result.workspace.input.format).toBe("p8-png");
    expect(result.workspace.input.sourceSha256).toBe(hash(encoded));
    expect(result.workspace.provenance.rightsEvidenceSha256).toEqual([hash(rights)]);
    const rebuilt = await readFile(path.join(base, "workspace/rebuild/rebuilt.p8"));
    expect(result.workspace.rebuild.rebuiltCart.sha256).toBe(hash(rebuilt));
    expect(result.workspace.rebuild.rebuiltCart.sha256).not.toBe(hash(source));
  });

  it("rejects source/evidence drift, generated-path collisions, ROM drift, and non-empty destinations", async () => {
    const base = await root();
    await expect(runIngestJob({
      input: input(), inputBytes: Buffer.from("wrong"), destination: path.join(base, "hash"), codec: codec(), async readEvidence() { return rights; },
    })).rejects.toThrow(/source identity/);
    await expect(runIngestJob({
      input: input(), inputBytes: source, destination: path.join(base, "rights"), codec: codec(), async readEvidence() { return Buffer.from("wrong"); },
    })).rejects.toThrow(/rights evidence/);

    const collision = structuredClone(input()) as any;
    collision.provenance.declaredLicense.evidence[0]!.path = "workspace.json";
    collision.provenance.releasePermission.evidence[0]!.path = "workspace.json";
    await expect(runIngestJob({
      input: collision, inputBytes: source, destination: path.join(base, "collision"), codec: codec(), async readEvidence() { return rights; },
    })).rejects.toThrow(/collides/);

    const sourceEvidenceCollision = structuredClone(input()) as any;
    sourceEvidenceCollision.source.path = "rights/CC0-1.0.txt";
    sourceEvidenceCollision.source.sha256 = hash(source);
    await expect(runIngestJob({
      input: sourceEvidenceCollision, inputBytes: source, destination: path.join(base, "source-evidence-collision"), codec: codec(), async readEvidence() { return rights; },
    })).rejects.toThrow(/source path collides with rights evidence/);

    const drifting = codec();
    let call = 0;
    drifting.encodeRom = async () => Buffer.alloc(0x8000, call++);
    await expect(runIngestJob({
      input: input(), inputBytes: source, destination: path.join(base, "rom"), codec: drifting, async readEvidence() { return rights; },
    })).rejects.toThrow(/same ROM \(first difference at 0x0000\)/);

    const nonempty = path.join(base, "nonempty");
    await mkdir(nonempty);
    await writeFile(path.join(nonempty, "keep"), "user data");
    await expect(runIngestJob({
      input: input(), inputBytes: source, destination: nonempty, codec: codec(), async readEvidence() { return rights; },
    })).rejects.toThrow(/absent or empty/);
    expect(await readFile(path.join(nonempty, "keep"), "utf8")).toBe("user data");
  });
});
