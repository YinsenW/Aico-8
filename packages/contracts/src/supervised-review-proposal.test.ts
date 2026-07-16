import fs from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  REQUIRED_FORBIDDEN_CLAIMS,
  REQUIRED_REVIEW_CRITERIA,
  SUPERVISED_REVIEW_PROPOSAL_SCHEMA_VERSION,
  validateSupervisedReviewProposal,
  type SupervisedReviewProposalV1,
} from "./supervised-review-proposal.js";
import type { SupervisedTransferStopId } from "./human-stop-decision.js";

const schema = JSON.parse(fs.readFileSync(
  new URL("../../../specs/schemas/supervised-review-proposal-v1.schema.json", import.meta.url), "utf8",
));
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

function validProposal(stopId: SupervisedTransferStopId = "semantic-intent", attempt = 1): SupervisedReviewProposalV1 {
  const evidence = [{
    id: "review-packet",
    path: "evidence/review-packet.json",
    sha256: "e".repeat(64),
    description: "Frozen evidence packet presented to the human reviewer.",
  }];
  return {
    schemaVersion: SUPERVISED_REVIEW_PROPOSAL_SCHEMA_VERSION,
    proposalId: `${stopId}.proposal.${attempt}`,
    jobId: "steps.supervised-transfer",
    gameId: "steps-private-research",
    transferInstanceId: "IIIIIIIIIIIIIIIIIIIIII",
    sourceIdentitySha256: "a".repeat(64),
    targetProfileSha256: "b".repeat(64),
    authorityProfileSha256: "c".repeat(64),
    stopId,
    attempt,
    upstreamDecisionSha256: stopId === "semantic-intent" ? null : "d".repeat(64),
    previousProposalSha256: attempt === 1 ? null : "1".repeat(64),
    previousRevisionDecisionSha256: attempt === 1 ? null : "2".repeat(64),
    title: `Review ${stopId} proposal`,
    summary: "Review the frozen source-relative evidence without expanding its declared scope.",
    evidence,
    reviewItems: REQUIRED_REVIEW_CRITERIA[stopId].map((criterionId) => ({
      criterionId,
      question: `Does the evidence satisfy the bounded ${criterionId} criterion?`,
      evidenceIds: [evidence[0]!.id],
    })),
    limitations: ["This proposal does not prove a complete game, portable acceptance, rights, or release readiness."],
    authorityLimits: {
      agentMayApprove: false,
      agentMaySign: false,
      agentMayAuthorizeFullValidation: false,
      agentMayRelease: false,
    },
    forbiddenClaims: REQUIRED_FORBIDDEN_CLAIMS,
    scopeDispositionOptions: stopId === "final-scope"
      ? ["retain-supervised-trial", "authorize-full-validation"]
      : [],
  };
}

describe("supervised review proposal contract", () => {
  it("accepts the exact review object for every ordered human stop", () => {
    for (const stopId of Object.keys(REQUIRED_REVIEW_CRITERIA) as SupervisedTransferStopId[]) {
      const proposal = validProposal(stopId);
      expect(validateSupervisedReviewProposal(proposal), stopId).toEqual({ valid: true, errors: [] });
      expect(validateSchema(proposal), JSON.stringify(validateSchema.errors)).toBe(true);
    }
  });

  it("rejects identity drift, missing stop criteria, evidence drift, and widened Agent authority", () => {
    const proposal = structuredClone(validProposal("representative-gameplay")) as unknown as {
      sourceIdentitySha256: string;
      evidence: Array<{ sha256: string }>;
      reviewItems: Array<{ criterionId: string }>;
      authorityLimits: { agentMayApprove: boolean };
    };
    proposal.sourceIdentitySha256 = "wrong";
    proposal.evidence[0]!.sha256 = "wrong";
    proposal.reviewItems = proposal.reviewItems.filter(({ criterionId }) => criterionId !== "hd-state-invariance");
    proposal.authorityLimits.agentMayApprove = true;
    const errors = validateSupervisedReviewProposal(proposal).errors.join("\n");
    expect(errors).toMatch(/sourceIdentitySha256/);
    expect(errors).toMatch(/evidence\[0\]\.sha256/);
    expect(errors).toMatch(/must include hd-state-invariance/);
    expect(errors).toMatch(/agentMayApprove must equal false/);
  });

  it("requires immediate rejected-attempt lineage and exact final-scope choices", () => {
    const revision = structuredClone(validProposal("final-scope", 2)) as unknown as {
      previousRevisionDecisionSha256: string | null;
      scopeDispositionOptions: string[];
      forbiddenClaims: string[];
    };
    revision.previousRevisionDecisionSha256 = null;
    revision.scopeDispositionOptions = ["retain-supervised-trial"];
    revision.forbiddenClaims = revision.forbiddenClaims.filter((claim) => claim !== "publication-authorized");
    const errors = validateSupervisedReviewProposal(revision).errors.join("\n");
    expect(errors).toMatch(/previous proposal and revision decision are required/);
    expect(errors).toMatch(/contain both final dispositions/);
    expect(errors).toMatch(/four required claim limits/);
    expect(validateSchema(revision)).toBe(false);
  });

  it("rejects duplicate claim or final-scope values that hide a missing required value", () => {
    const proposal = structuredClone(validProposal("final-scope")) as unknown as {
      forbiddenClaims: string[];
      scopeDispositionOptions: string[];
    };
    proposal.forbiddenClaims = [
      "complete-game-reviewed",
      "portable-ledger-accepted",
      "release-ready",
      "release-ready",
    ];
    proposal.scopeDispositionOptions = ["retain-supervised-trial", "retain-supervised-trial"];
    const errors = validateSupervisedReviewProposal(proposal).errors.join("\n");
    expect(errors).toMatch(/four required claim limits/);
    expect(errors).toMatch(/contain both final dispositions/);
    expect(validateSchema(proposal)).toBe(false);
  });
});
