import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  CART_WORKSPACE_SCHEMA_VERSION,
  assertCartInput,
  assertCartWorkspace,
  type CartFormat,
  type CartInputV1,
  type CartWorkspaceResourceV1,
  type CartWorkspaceV1,
  type IngestFileReferenceV1,
} from "@aico8/contracts";

import { applyP8TextEdits, decodeP8TextResources, parseP8Text, rebuildP8Text, type P8TextEdits } from "./p8-text.js";

export interface IngestCodec {
  readonly id: string;
  readonly version: string;
  readonly revisionSha256: string;
  decodeToP8(source: Uint8Array, format: CartFormat): Promise<Uint8Array>;
  encodeRom(p8Text: Uint8Array): Promise<Uint8Array>;
}

export interface RunIngestJobOptions {
  readonly input: CartInputV1;
  readonly inputBytes: Uint8Array;
  readonly destination: string;
  readonly codec: IngestCodec;
  readonly readEvidence: (relativePath: string) => Promise<Uint8Array>;
}

export interface RunIngestJobResult {
  readonly workspace: CartWorkspaceV1;
  readonly workspacePath: string;
  readonly sourceRomSha256: string;
}

const GENERATED_PATHS = new Set([
  "cart-input.json",
  "workspace.json",
  "rebuild/rebuilt.p8",
  "rebuild/source.rom.hex",
  "resources/code.p8.lua",
  "resources/gfx-pixels.json",
  "resources/shared-map-alias.json",
  "resources/map.json",
  "resources/sprite-flags.json",
  "resources/sfx.json",
  "resources/music.json",
  "resources/label-pixels.json",
]);

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function firstByteDifference(left: Uint8Array, right: Uint8Array): number {
  const sharedLength = Math.min(left.byteLength, right.byteLength);
  for (let index = 0; index < sharedLength; index += 1) if (left[index] !== right[index]) return index;
  return sharedLength;
}

function jsonBytes(value: unknown): Uint8Array {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => lexicalCompare(left, right)).map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

function semanticHash(value: unknown): string {
  return sha256(Buffer.from(JSON.stringify(canonical(value))));
}

function reference(relativePath: string, bytes: Uint8Array): IngestFileReferenceV1 {
  return { path: relativePath, sha256: sha256(bytes), byteLength: bytes.byteLength };
}

async function writeRelative(root: string, relativePath: string, bytes: Uint8Array): Promise<void> {
  const target = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx" });
}

async function destinationState(destination: string): Promise<"absent" | "empty"> {
  try {
    await access(destination, constants.F_OK);
  } catch {
    return "absent";
  }
  const entries = await readdir(destination);
  if (entries.length !== 0) throw new TypeError(`ingest destination must be absent or empty: ${destination}`);
  return "empty";
}

function collectEvidence(input: CartInputV1): Map<string, IngestFileReferenceV1> {
  const result = new Map<string, IngestFileReferenceV1>();
  const records = [...input.provenance.declaredLicense.evidence, ...input.provenance.releasePermission.evidence];
  for (const record of records) {
    if (GENERATED_PATHS.has(record.path)) throw new TypeError(`rights evidence collides with generated path: ${record.path}`);
    const previous = result.get(record.path);
    if (previous && (previous.sha256 !== record.sha256 || previous.byteLength !== record.byteLength)) {
      throw new TypeError(`rights evidence path has conflicting identities: ${record.path}`);
    }
    result.set(record.path, record);
  }
  return result;
}

function resource(
  id: CartWorkspaceResourceV1["id"],
  sourceSection: CartWorkspaceResourceV1["sourceSection"],
  presentInSource: boolean,
  artifact: IngestFileReferenceV1,
  semanticSha256: string,
): CartWorkspaceResourceV1 {
  return { id, sourceSection, presentInSource, artifact, semanticSha256 };
}

export async function runIngestJob(options: RunIngestJobOptions): Promise<RunIngestJobResult> {
  assertCartInput(options.input);
  if (GENERATED_PATHS.has(options.input.source.path)) throw new TypeError(`source path collides with generated path: ${options.input.source.path}`);
  if (options.inputBytes.byteLength !== options.input.source.byteLength || sha256(options.inputBytes) !== options.input.source.sha256) {
    throw new TypeError("input bytes do not match the declared source identity");
  }
  const evidence = collectEvidence(options.input);
  if (evidence.has(options.input.source.path)) throw new TypeError(`source path collides with rights evidence: ${options.input.source.path}`);
  const evidenceBytes = new Map<string, Uint8Array>();
  for (const [relativePath, declared] of evidence) {
    const bytes = await options.readEvidence(relativePath);
    if (bytes.byteLength !== declared.byteLength || sha256(bytes) !== declared.sha256) {
      throw new TypeError(`rights evidence does not match its declared identity: ${relativePath}`);
    }
    evidenceBytes.set(relativePath, bytes);
  }

  const decodedBytes = await options.codec.decodeToP8(options.inputBytes, options.input.format);
  const cart = parseP8Text(decodedBytes);
  const decoded = decodeP8TextResources(cart);
  const present = decoded.presentSections;
  const resourceEdits: P8TextEdits = {
    lua: decoded.lua,
    ...(present.has("gfx") ? { gfx: decoded.gfx, sharedMapAlias: decoded.sharedMapAlias } : {}),
    ...(present.has("map") ? { map: decoded.map } : {}),
    ...(present.has("gff") ? { gff: decoded.gff } : {}),
    ...(present.has("sfx") ? { sfxLines: decoded.sfxLines } : {}),
    ...(present.has("music") ? { musicLines: decoded.musicLines } : {}),
    ...(present.has("label") ? { label: decoded.label } : {}),
  };
  const rebuiltBytes = Buffer.from(rebuildP8Text(applyP8TextEdits(cart, resourceEdits)));
  const [sourceRom, rebuiltRom] = await Promise.all([
    options.codec.encodeRom(decodedBytes),
    options.codec.encodeRom(rebuiltBytes),
  ]);
  if (sourceRom.byteLength !== 0x8000 || rebuiltRom.byteLength !== 0x8000) {
    throw new TypeError("codec ROM output must be exactly 32 KiB");
  }
  if (!sameBytes(sourceRom, rebuiltRom)) {
    const offset = firstByteDifference(sourceRom, rebuiltRom).toString(16).padStart(4, "0");
    throw new TypeError(`decoded workspace did not rebuild to the same ROM (first difference at 0x${offset})`);
  }

  const artifacts = new Map<string, Uint8Array>();
  artifacts.set("resources/code.p8.lua", Buffer.from(decoded.lua));
  artifacts.set("resources/gfx-pixels.json", jsonBytes({ width: 128, height: 128, rows: decoded.gfx }));
  artifacts.set("resources/shared-map-alias.json", jsonBytes({ width: 128, height: 32, rows: decoded.sharedMapAlias }));
  artifacts.set("resources/map.json", jsonBytes({ width: 128, height: 32, rows: decoded.map }));
  artifacts.set("resources/sprite-flags.json", jsonBytes({ flags: decoded.gff }));
  artifacts.set("resources/sfx.json", jsonBytes({ lines: decoded.sfxLines }));
  artifacts.set("resources/music.json", jsonBytes({ lines: decoded.musicLines }));
  artifacts.set("resources/label-pixels.json", jsonBytes({ width: 128, height: 128, rows: decoded.label }));
  artifacts.set("rebuild/rebuilt.p8", rebuiltBytes);
  artifacts.set("rebuild/source.rom.hex", Buffer.from(`${Buffer.from(sourceRom).toString("hex")}\n`));

  const manifestBytes = jsonBytes(options.input);
  const manifestRef = reference("cart-input.json", manifestBytes);
  const sectionSet = present;
  const resourceRecords: CartWorkspaceResourceV1[] = [
    resource("lua", "lua", sectionSet.has("lua"), reference("resources/code.p8.lua", artifacts.get("resources/code.p8.lua") as Uint8Array), sha256(Buffer.from(decoded.lua))),
    resource("gfx", "gfx", sectionSet.has("gfx"), reference("resources/gfx-pixels.json", artifacts.get("resources/gfx-pixels.json") as Uint8Array), semanticHash(decoded.gfx)),
    resource("shared-map-alias", "gfx", sectionSet.has("gfx"), reference("resources/shared-map-alias.json", artifacts.get("resources/shared-map-alias.json") as Uint8Array), semanticHash(decoded.sharedMapAlias)),
    resource("map", "map", sectionSet.has("map"), reference("resources/map.json", artifacts.get("resources/map.json") as Uint8Array), semanticHash(decoded.map)),
    resource("gff", "gff", sectionSet.has("gff"), reference("resources/sprite-flags.json", artifacts.get("resources/sprite-flags.json") as Uint8Array), semanticHash(decoded.gff)),
    resource("sfx", "sfx", sectionSet.has("sfx"), reference("resources/sfx.json", artifacts.get("resources/sfx.json") as Uint8Array), semanticHash(decoded.sfxLines)),
    resource("music", "music", sectionSet.has("music"), reference("resources/music.json", artifacts.get("resources/music.json") as Uint8Array), semanticHash(decoded.musicLines)),
    resource("label", "label", sectionSet.has("label"), reference("resources/label-pixels.json", artifacts.get("resources/label-pixels.json") as Uint8Array), semanticHash(decoded.label)),
  ];
  const shared = resourceRecords.find((item) => item.id === "shared-map-alias") as CartWorkspaceResourceV1;
  const rightsEvidenceSha256 = [...new Set([
    ...options.input.provenance.declaredLicense.evidence,
    ...options.input.provenance.releasePermission.evidence,
  ].map((item) => item.sha256))];
  const workspace: CartWorkspaceV1 = {
    schemaVersion: CART_WORKSPACE_SCHEMA_VERSION,
    workspaceId: options.input.inputId,
    status: "decoded-lossless",
    input: { manifest: manifestRef, format: options.input.format, sourceSha256: options.input.source.sha256 },
    codec: { id: options.codec.id, version: options.codec.version, revisionSha256: options.codec.revisionSha256 },
    pico8: { version: cart.version, sections: [...sectionSet], sectionOrder: decoded.sectionOrder },
    resources: resourceRecords,
    aliases: [{
      id: "gfx-shared-map",
      kind: "shared-memory",
      offset: 4096,
      length: 4096,
      resourceIds: ["gfx", "shared-map-alias"],
      baselineSemanticSha256: shared.semanticSha256,
      conflictPolicy: "reject-divergent-dual-edit",
    }],
    rebuild: {
      rebuiltCart: reference("rebuild/rebuilt.p8", rebuiltBytes),
      decodedRomHex: reference("rebuild/source.rom.hex", artifacts.get("rebuild/source.rom.hex") as Uint8Array),
      comparison: "exact-decoded-rom-and-resources",
      sourceEquivalent: true,
    },
    provenance: {
      cartInputManifestSha256: manifestRef.sha256,
      sourceSha256: options.input.source.sha256,
      declaredLicenseSpdx: options.input.provenance.declaredLicense.spdx,
      releasePermissionStatus: options.input.provenance.releasePermission.status,
      rightsEvidenceSha256,
    },
  };
  assertCartWorkspace(workspace, options.input);

  const state = await destinationState(options.destination);
  const parent = path.dirname(options.destination);
  await mkdir(parent, { recursive: true });
  const temporary = await mkdtemp(path.join(parent, ".aico8-ingest-"));
  try {
    await writeRelative(temporary, options.input.source.path, options.inputBytes);
    for (const [relativePath, bytes] of evidenceBytes) await writeRelative(temporary, relativePath, bytes);
    await writeRelative(temporary, "cart-input.json", manifestBytes);
    for (const [relativePath, bytes] of artifacts) await writeRelative(temporary, relativePath, bytes);
    await writeRelative(temporary, "workspace.json", jsonBytes(workspace));
    if (state === "empty") await rmdir(options.destination);
    await rename(temporary, options.destination);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  const persisted = JSON.parse(await readFile(path.join(options.destination, "workspace.json"), "utf8")) as unknown;
  assertCartWorkspace(persisted, options.input);
  return { workspace, workspacePath: path.join(options.destination, "workspace.json"), sourceRomSha256: sha256(sourceRom) };
}
