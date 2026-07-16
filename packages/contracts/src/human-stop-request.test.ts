import fs from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { createSupervisedTransfer, submitSupervisedProposal } from "./supervised-transfer.js";
import { createHumanStopRequest, validateHumanStopRequest } from "./human-stop-request.js";

const schema = JSON.parse(fs.readFileSync(
  new URL("../../../specs/schemas/human-stop-request-v1.schema.json", import.meta.url), "utf8",
));
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

function pending(stopId: "semantic-intent" | "final-scope" = "semantic-intent") {
  let job = createSupervisedTransfer({
    jobId: "steps.supervised-transfer",
    gameId: "steps-private-research",
    transferInstanceId: "IIIIIIIIIIIIIIIIIIIIII",
    sourceIdentitySha256: "a".repeat(64),
    targetProfileSha256: "b".repeat(64),
    authorityProfileId: "human-review.primary",
    authorityProfileSha256: "c".repeat(64),
    trustedReviewerKeys: [{ keyId: "reviewer.primary", publicKeySha256: "d".repeat(64) }],
  });
  if (stopId === "final-scope") {
    job = structuredClone(job) as typeof job;
    const mutable = job as unknown as {
      status: string;
      stops: Array<{ attempts: Array<unknown> }>;
    };
    let upstream: string | null = null;
    for (let index = 0; index < 3; index += 1) {
      const decisionSha256 = String(index + 1).repeat(64);
      mutable.stops[index]!.attempts.push({
        attempt: 1,
        proposal: {
          path: `proposals/stop-${index + 1}.json`,
          sha256: String(index + 4).repeat(64),
          upstreamDecisionSha256: upstream,
          decisionNonce: String.fromCharCode(65 + index).repeat(22),
        },
        decision: {
          path: `decisions/stop-${index + 1}.json`,
          sha256: decisionSha256,
          outcome: "approved",
          scopeDisposition: null,
          reviewerKeyId: "reviewer.primary",
        },
      });
      upstream = decisionSha256;
    }
    mutable.status = "working";
  }
  return submitSupervisedProposal(job, {
    stopId,
    path: `proposals/${stopId}-1.json`,
    sha256: "e".repeat(64),
    decisionNonce: "NNNNNNNNNNNNNNNNNNNNNN",
  });
}

describe("human stop request contract", () => {
  it("derives an exact non-signing request from the pending proposal", () => {
    const request = createHumanStopRequest(pending());
    expect(validateHumanStopRequest(request)).toEqual({ valid: true, errors: [] });
    expect(validateSchema(request), JSON.stringify(validateSchema.errors)).toBe(true);
    expect(request).toMatchObject({
      stopId: "semantic-intent",
      proposalPath: "proposals/semantic-intent-1.json",
      proposalSha256: "e".repeat(64),
      priorDecisionSha256: null,
      nonce: "NNNNNNNNNNNNNNNNNNNNNN",
      allowedOutcomes: ["approved", "revision-requested"],
      allowedScopeDispositions: [],
      agentMaySign: false,
    });
  });

  it("exposes scope disposition choices only at the final stop", () => {
    const request = createHumanStopRequest(pending("final-scope"));
    expect(request.allowedScopeDispositions).toEqual(["retain-supervised-trial", "authorize-full-validation"]);
    expect(request.priorDecisionSha256).toBe("3".repeat(64));
  });

  it("rejects altered outcome order, signing authority, and unsafe proposal paths", () => {
    const request = structuredClone(createHumanStopRequest(pending())) as unknown as {
      allowedOutcomes: string[];
      agentMaySign: boolean;
      proposalPath: string;
    };
    request.allowedOutcomes.reverse();
    request.agentMaySign = true;
    request.proposalPath = "../proposal.json";
    const errors = validateHumanStopRequest(request).errors.join("\n");
    expect(errors).toMatch(/allowedOutcomes must equal/);
    expect(errors).toMatch(/agentMaySign must equal false/);
    expect(errors).toMatch(/safe relative path/);
  });

  it("cannot create a request before a proposal is awaiting review", () => {
    const job = createSupervisedTransfer({
      jobId: "steps.supervised-transfer",
      gameId: "steps-private-research",
      transferInstanceId: "IIIIIIIIIIIIIIIIIIIIII",
      sourceIdentitySha256: "a".repeat(64),
      targetProfileSha256: "b".repeat(64),
      authorityProfileId: "human-review.primary",
      authorityProfileSha256: "c".repeat(64),
      trustedReviewerKeys: [{ keyId: "reviewer.primary", publicKeySha256: "d".repeat(64) }],
    });
    expect(() => createHumanStopRequest(job)).toThrow(/not awaiting/);
  });
});
