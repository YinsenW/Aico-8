#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { assertCartInput, type CartInputV1 } from "../packages/contracts/src/ingest.ts";
import { createShrinko8Codec, runIngestJob } from "../packages/ingest/src/index.ts";

const usage = "Usage: pnpm ingest:cart -- --manifest <cart-input.json> --output <workspace> --codec-command <shrinko8> --codec-sha256 <sha256> --codec-version <semver> [--codec-revision <file>] [--codec-prefix <arg> ...] [--codec-timeout-ms <milliseconds>]";

async function containedRegularFile(root: string, relativePath: string): Promise<string> {
  const candidate = path.resolve(root, ...relativePath.split("/"));
  if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) throw new TypeError(`manifest path escapes its root: ${relativePath}`);
  const realCandidate = await fs.realpath(candidate);
  if (!realCandidate.startsWith(`${root}${path.sep}`)) throw new TypeError(`manifest path escapes its root through a symlink: ${relativePath}`);
  if (!(await fs.stat(realCandidate)).isFile()) throw new TypeError(`manifest path is not a regular file: ${relativePath}`);
  return realCandidate;
}

async function main(): Promise<void> {
  const rawArguments = process.argv.slice(2);
  const argumentsToParse = rawArguments[0] === "--" ? rawArguments.slice(1) : rawArguments;
  const { values } = parseArgs({
    args: argumentsToParse,
    options: {
      manifest: { type: "string" },
      output: { type: "string" },
      "codec-command": { type: "string" },
      "codec-prefix": { type: "string", multiple: true, default: [] },
      "codec-revision": { type: "string" },
      "codec-sha256": { type: "string" },
      "codec-version": { type: "string" },
      "codec-timeout-ms": { type: "string" },
    },
    strict: true,
  });
  const required = ["manifest", "output", "codec-command", "codec-sha256", "codec-version"] as const;
  for (const key of required) if (!values[key]) throw new TypeError(`${usage}\nMissing --${key}`);

  const manifestPath = await fs.realpath(path.resolve(values.manifest as string));
  const manifestRoot = path.dirname(manifestPath);
  const parsed = JSON.parse(await fs.readFile(manifestPath, "utf8")) as unknown;
  assertCartInput(parsed);
  const input = parsed as CartInputV1;
  const codec = await createShrinko8Codec({
    command: path.resolve(values["codec-command"] as string),
    prefixArgs: values["codec-prefix"],
    ...(values["codec-revision"] ? { revisionPath: path.resolve(values["codec-revision"] as string) } : {}),
    expectedRevisionSha256: values["codec-sha256"] as string,
    version: values["codec-version"] as string,
    ...(values["codec-timeout-ms"] === undefined ? {} : { timeoutMs: Number(values["codec-timeout-ms"]) }),
  });
  const result = await runIngestJob({
    input,
    inputBytes: await fs.readFile(await containedRegularFile(manifestRoot, input.source.path)),
    destination: path.resolve(values.output as string),
    codec,
    readEvidence: async (relativePath) => fs.readFile(await containedRegularFile(manifestRoot, relativePath)),
  });
  process.stdout.write(`${JSON.stringify({
    workspace: result.workspacePath,
    workspaceId: result.workspace.workspaceId,
    sourceSha256: result.workspace.input.sourceSha256,
    sourceRomSha256: result.sourceRomSha256,
    codecRevisionSha256: result.workspace.codec.revisionSha256,
  })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
