import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { CartFormat } from "@aico8/contracts";

import type { IngestCodec } from "./job.js";

const execute = promisify(execFile);

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export interface Shrinko8CodecOptions {
  readonly command: string;
  readonly prefixArgs?: readonly string[];
  readonly revisionPath?: string;
  readonly expectedRevisionSha256: string;
  readonly version: string;
  readonly timeoutMs?: number;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function revisionFiles(current: string): Promise<string[]> {
  const status = await lstat(current);
  if (status.isSymbolicLink()) throw new TypeError(`codec revision path must not contain symlinks: ${current}`);
  if (status.isFile()) return [current];
  if (!status.isDirectory()) throw new TypeError(`codec revision path must be a file or directory: ${current}`);
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => lexicalCompare(left.name, right.name))) {
    if (entry.name === "__pycache__" || entry.name.endsWith(".pyc")) continue;
    files.push(...await revisionFiles(path.join(current, entry.name)));
  }
  return files;
}

export async function hashCodecRevision(revisionPath: string): Promise<string> {
  const status = await lstat(revisionPath);
  if (status.isFile()) return sha256(await readFile(revisionPath));
  const files = await revisionFiles(revisionPath);
  if (files.length === 0) throw new TypeError("codec revision directory must contain at least one file");
  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(path.relative(revisionPath, file).split(path.sep).join("/"));
    digest.update("\0");
    digest.update(await readFile(file));
    digest.update("\0");
  }
  return digest.digest("hex");
}

async function inTemporaryDirectory<T>(operation: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aico8-shrinko8-"));
  try { return await operation(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

export async function createShrinko8Codec(options: Shrinko8CodecOptions): Promise<IngestCodec> {
  if (!/^[a-f0-9]{64}$/.test(options.expectedRevisionSha256)) throw new TypeError("expected shrinko8 revision must be a sha256");
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/.test(options.version)) throw new TypeError("shrinko8 version must be semantic version");
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    throw new TypeError("shrinko8 timeout must be an integer from 100 through 120000 milliseconds");
  }
  const actualRevision = await hashCodecRevision(options.revisionPath ?? options.command);
  if (actualRevision !== options.expectedRevisionSha256) throw new TypeError("shrinko8 executable revision does not match the pinned sha256");
  const prefixArgs = [...(options.prefixArgs ?? [])];

  const convert = async (source: string, target: string, format?: string): Promise<void> => {
    const args = [...prefixArgs, source, target];
    if (format) args.push("--format", format);
    try {
      await execute(options.command, args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 16, timeout: timeoutMs });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new TypeError(`shrinko8 conversion failed: ${detail}`);
    }
  };

  return {
    id: "shrinko8",
    version: options.version,
    revisionSha256: actualRevision,
    async decodeToP8(source: Uint8Array, format: CartFormat): Promise<Uint8Array> {
      if (format === "p8-text") return new Uint8Array(source);
      return inTemporaryDirectory(async (directory) => {
        const extension = format === "p8-png" ? "p8.png" : "rom";
        const input = path.join(directory, `source.${extension}`);
        const output = path.join(directory, "decoded.p8");
        await writeFile(input, source);
        await convert(input, output);
        return readFile(output);
      });
    },
    async encodeRom(p8Text: Uint8Array): Promise<Uint8Array> {
      return inTemporaryDirectory(async (directory) => {
        const input = path.join(directory, "source.p8");
        const output = path.join(directory, "source.rom");
        await writeFile(input, p8Text);
        await convert(input, output, "rom");
        const rom = await readFile(output);
        if (rom.byteLength !== 0x8000) throw new TypeError("shrinko8 ROM output must be exactly 32 KiB");
        return rom;
      });
    },
  };
}
