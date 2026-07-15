import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createSupervisedTransfer, submitSupervisedProposal } from "./supervised-transfer.js";
import { exportHumanStopRequestArtifact } from "../../../scripts/export-human-stop-request.ts";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function job() {
  return createSupervisedTransfer({
    jobId: "steps.supervised-transfer",
    gameId: "steps-private-research",
    transferInstanceId: "IIIIIIIIIIIIIIIIIIIIII",
    sourceIdentitySha256: "a".repeat(64),
    targetProfileSha256: "b".repeat(64),
    authorityProfileId: "human-review.primary",
    authorityProfileSha256: "c".repeat(64),
    trustedReviewerKeys: [{ keyId: "reviewer.primary", publicKeySha256: "d".repeat(64) }],
  });
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aico8-human-request-"));
  temporaryRoots.push(root);
  return root;
}

describe("human stop request exporter", () => {
  it("writes an immutable content-identical request and resumes idempotently", async () => {
    const root = await fixture();
    const pending = submitSupervisedProposal(job(), {
      stopId: "semantic-intent",
      path: "proposals/semantic-intent-1.json",
      sha256: "e".repeat(64),
      decisionNonce: "NNNNNNNNNNNNNNNNNNNNNN",
    });
    const request = await exportHumanStopRequestArtifact(pending, root, "requests/semantic-intent-1.json");
    expect(JSON.parse(await fs.readFile(path.join(root, "requests/semantic-intent-1.json"), "utf8"))).toEqual(request);
    expect(await exportHumanStopRequestArtifact(pending, root, "requests/semantic-intent-1.json")).toEqual(request);
  });

  it("rejects request-byte drift, path escape, and a symlinked output parent", async () => {
    const root = await fixture();
    const pending = submitSupervisedProposal(job(), {
      stopId: "semantic-intent",
      path: "proposals/semantic-intent-1.json",
      sha256: "e".repeat(64),
      decisionNonce: "NNNNNNNNNNNNNNNNNNNNNN",
    });
    await fs.mkdir(path.join(root, "requests"));
    await fs.writeFile(path.join(root, "requests/request.json"), "{}\n");
    await expect(exportHumanStopRequestArtifact(pending, root, "requests/request.json"))
      .rejects.toThrow(/different bytes/);
    await expect(exportHumanStopRequestArtifact(pending, root, "../request.json"))
      .rejects.toThrow(/safe relative path/);

    const outside = await fixture();
    await fs.symlink(outside, path.join(root, "alias"), "dir");
    await expect(exportHumanStopRequestArtifact(pending, root, "alias/request.json"))
      .rejects.toThrow(/must not traverse a symbolic link/);
  });

  it("cannot export before the runner reaches an awaiting-human state", async () => {
    const root = await fixture();
    await expect(exportHumanStopRequestArtifact(job(), root, "requests/request.json"))
      .rejects.toThrow(/not awaiting/);
  });
});
