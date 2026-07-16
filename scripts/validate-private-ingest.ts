#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { CartFormat, CartInputV1 } from "../packages/contracts/src/ingest.ts";
import { createShrinko8Codec, runIngestJob } from "../packages/ingest/src/index.ts";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRIVATE_EVIDENCE_PATH = "rights/private-research-basis.md";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new TypeError(`${name} is required`);
  return value;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function cartFormat(filename: string): CartFormat | undefined {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".p8.png")) return "p8-png";
  if (lower.endsWith(".p8")) return "p8-text";
  if (lower.endsWith(".rom")) return "raw-rom";
  return undefined;
}

async function mapConcurrent<T, R>(values: readonly T[], limit: number, operation: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor++;
      if (index >= values.length) return;
      results[index] = await operation(values[index] as T, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

async function main(): Promise<void> {
  const cartsRoot = path.resolve(required("AICO8_PRIVATE_CARTS"));
  const reportPath = path.resolve(required("AICO8_PRIVATE_INGEST_REPORT"));
  const evidencePath = path.resolve(required("AICO8_INGEST_RIGHTS_EVIDENCE"));
  const attestationPath = path.resolve(process.env.AICO8_INGEST_ATTESTATION
    ?? path.join(repository, "governance/evidence/ingest-roundtrip.json"));
  const concurrency = Number.parseInt(process.env.AICO8_INGEST_CONCURRENCY ?? "4", 10);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new TypeError("AICO8_INGEST_CONCURRENCY must be an integer from 1 through 8");
  }

  const [directoryEntries, evidenceBytes] = await Promise.all([
    fs.readdir(cartsRoot, { withFileTypes: true }),
    fs.readFile(evidencePath),
  ]);
  const candidates: Array<{ filename: string; format: CartFormat }> = [];
  for (const entry of directoryEntries) {
    const format = cartFormat(entry.name);
    if (!format) continue;
    if (!entry.isFile()) throw new TypeError(`private cart input must be a regular file: ${entry.name}`);
    candidates.push({ filename: entry.name, format });
  }
  candidates.sort((left, right) => lexicalCompare(left.filename, right.filename));
  if (candidates.length === 0) throw new TypeError("private cart directory contains no supported carts");

  const codec = await createShrinko8Codec({
    command: path.resolve(required("AICO8_INGEST_CODEC_COMMAND")),
    revisionPath: path.resolve(process.env.AICO8_INGEST_CODEC_REVISION ?? required("AICO8_INGEST_CODEC_COMMAND")),
    expectedRevisionSha256: required("AICO8_INGEST_CODEC_SHA256"),
    version: required("AICO8_INGEST_CODEC_VERSION"),
    ...(process.env.AICO8_INGEST_CODEC_TIMEOUT_MS === undefined
      ? {} : { timeoutMs: Number(process.env.AICO8_INGEST_CODEC_TIMEOUT_MS) }),
  });
  const scratchRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aico8-private-ingest-"));
  const evidenceIdentity = {
    path: PRIVATE_EVIDENCE_PATH,
    sha256: sha256(evidenceBytes),
    byteLength: evidenceBytes.byteLength,
  };
  try {
    const results = await mapConcurrent(candidates, concurrency, async (candidate, index) => {
      const sourceBytes = await fs.readFile(path.join(cartsRoot, candidate.filename));
      const sourceSha256 = sha256(sourceBytes);
      const input: CartInputV1 = {
        schemaVersion: "aico8.cart-input.v1",
        inputId: `private-corpus-${String(index + 1).padStart(4, "0")}`,
        format: candidate.format,
        source: {
          path: `source/cart-${String(index + 1).padStart(4, "0")}.${candidate.format === "p8-png" ? "p8.png" : candidate.format === "p8-text" ? "p8" : "rom"}`,
          sha256: sourceSha256,
          byteLength: sourceBytes.byteLength,
        },
        provenance: {
          suppliedBy: "project-owner",
          intendedUse: "private-research",
          sourceUrl: null,
          declaredLicense: { spdx: "NOASSERTION", evidence: [evidenceIdentity] },
          releasePermission: { status: "unknown", evidence: [] },
        },
      };
      const destination = path.join(scratchRoot, `cart-${String(index + 1).padStart(4, "0")}`);
      try {
        const result = await runIngestJob({
          input,
          inputBytes: sourceBytes,
          destination,
          codec,
          readEvidence: async (relativePath) => {
            if (relativePath !== PRIVATE_EVIDENCE_PATH) throw new TypeError(`undeclared private evidence read: ${relativePath}`);
            return evidenceBytes;
          },
        });
        const semanticResult = result.workspace.resources.map((resource) => ({
          id: resource.id,
          presentInSource: resource.presentInSource,
          semanticSha256: resource.semanticSha256,
        }));
        return {
          ordinal: index + 1,
          format: candidate.format,
          sourceSha256,
          sourceByteLength: sourceBytes.byteLength,
          sourceRomSha256: result.sourceRomSha256,
          semanticResultSha256: sha256(JSON.stringify(semanticResult)),
          status: "passed" as const,
        };
      } catch (error) {
        return {
          ordinal: index + 1,
          format: candidate.format,
          sourceSha256,
          sourceByteLength: sourceBytes.byteLength,
          status: "failed" as const,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        await fs.rm(destination, { recursive: true, force: true });
      }
    });

    const failures = results.filter((result) => result.status === "failed");
    const corpusIdentities = results.map(({ format, sourceSha256, sourceByteLength }) => ({ format, sourceSha256, sourceByteLength }))
      .sort((left, right) => lexicalCompare(left.sourceSha256, right.sourceSha256) || left.sourceByteLength - right.sourceByteLength);
    const passedIdentities = results.filter((result) => result.status === "passed").map((result) => ({
      sourceSha256: result.sourceSha256,
      sourceRomSha256: result.sourceRomSha256,
      semanticResultSha256: result.semanticResultSha256,
    })).sort((left, right) => lexicalCompare(left.sourceSha256, right.sourceSha256));
    const report = {
      schemaVersion: "aico8.private-ingest-validation.v1",
      rightsScope: "Project-owner supplied carts; private research and testing only; no publication permission inferred.",
      codec: { id: codec.id, version: codec.version, revisionSha256: codec.revisionSha256 },
      evidence: evidenceIdentity,
      summary: { total: results.length, passed: results.length - failures.length, failed: failures.length },
      corpusIdentitySha256: sha256(JSON.stringify(corpusIdentities)),
      roundTripResultSha256: sha256(JSON.stringify(passedIdentities)),
      results,
    };
    const reportBytes = stableBytes(report);
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, reportBytes);
    if (failures.length !== 0) {
      throw new TypeError(`private ingest failed for ${failures.length}/${results.length} carts; see ${reportPath}`);
    }

    const attestation = {
      schema_version: 1,
      subject: "TypeScript lossless ingest over the authorized private corpus",
      status: "verified",
      rights_scope: report.rightsScope,
      observations: {
        total_cart_count: report.summary.total,
        passed_cart_count: report.summary.passed,
        failed_cart_count: report.summary.failed,
        exact_rom_round_trip: true,
        resource_semantics_bound: true,
        provenance_bound: true,
      },
      codec: report.codec,
      private_artifact_sha256: {
        corpus_report: sha256(reportBytes),
        corpus_identity: report.corpusIdentitySha256,
        round_trip_result: report.roundTripResultSha256,
        rights_evidence: evidenceIdentity.sha256,
      },
      selector: "TEST-INGEST-ROUNDTRIP-PRIVATE",
    };
    const attestationBytes = stableBytes(attestation);
    if (process.env.AICO8_WRITE_ATTESTATION === "1") {
      await fs.mkdir(path.dirname(attestationPath), { recursive: true });
      await fs.writeFile(attestationPath, attestationBytes);
    } else {
      const retained = await fs.readFile(attestationPath);
      if (!retained.equals(attestationBytes)) throw new TypeError("retained ingest attestation does not match recomputed private evidence");
    }
    process.stdout.write(`Private TypeScript ingest: PASS (${results.length}/${results.length}; codec ${codec.version}; report ${reportPath})\n`);
  } finally {
    await fs.rm(scratchRoot, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
