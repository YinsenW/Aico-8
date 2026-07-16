import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  TRANSFER_FINDINGS_SCHEMA_VERSION,
  validateTransferFindings,
  type TransferFindingsV1,
} from "./transfer-findings.js";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const schema = JSON.parse(fs.readFileSync(
  new URL("../../../specs/schemas/transfer-findings-v1.schema.json", import.meta.url), "utf8",
));
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

function finding(
  classification: TransferFindingsV1["findings"][number]["classification"],
  index: number,
): TransferFindingsV1["findings"][number] {
  const reusable = classification !== "source-relative-semantic-art";
  return {
    id: `finding-${index}`,
    title: `Finding ${index}`,
    classification,
    observation: "A source-backed observation that is long enough to be reviewable.",
    resolution: "A bounded resolution that states what the workflow is allowed to reuse.",
    evidence: ["governance/evidence/steps-semantic-v19e-preflight.json"],
    reusableRuleId: reusable ? `shared-rule-${index}` : null,
    sharedImplementation: reusable ? ["packages/contracts/src/transfer-findings.ts"] : [],
    sharedRegressionTests: reusable ? ["packages/contracts/src/transfer-findings.test.ts"] : [],
    humanStopId: reusable ? null : "art-direction" as const,
    prohibitedGeneralization: "Do not infer a universal visual identity from this bounded finding.",
  };
}

function validRecord(): TransferFindingsV1 {
  return {
    schemaVersion: TRANSFER_FINDINGS_SCHEMA_VERSION,
    programId: "dust-steps-supervised-transfer",
    referenceGameId: "dust-bunny-research",
    trialGameId: "steps-private-research",
    status: "classified-human-stops-open",
    supervisedTransferLedgerSha256: null,
    findings: [
      finding("compatibility-runtime", 1),
      finding("reusable-presentation", 2),
      finding("source-relative-semantic-art", 3),
    ],
    limitations: ["Human stops and publication authority remain open."],
  };
}

describe("supervised transfer findings contract", () => {
  it("accepts all three finding classes while keeping reusable rules separate from human judgment", () => {
    expect(validateTransferFindings(validRecord())).toEqual({ valid: true, errors: [] });
  });

  it("rejects a source-relative decision disguised as a shared rule", () => {
    const record = structuredClone(validRecord());
    const sourceRelative = record.findings[2]! as unknown as {
      reusableRuleId: string | null;
      sharedImplementation: string[];
      sharedRegressionTests: string[];
      humanStopId: string | null;
    };
    sourceRelative.reusableRuleId = "universal-steps-style";
    sourceRelative.sharedImplementation = ["apps/web/src/runtime/presentation.ts"];
    sourceRelative.sharedRegressionTests = ["apps/web/src/runtime/presentation.test.ts"];
    sourceRelative.humanStopId = null;
    const errors = validateTransferFindings(record).errors.join("\n");
    expect(errors).toMatch(/reusableRuleId must be null/);
    expect(errors).toMatch(/sharedImplementation must be empty/);
    expect(errors).toMatch(/sharedRegressionTests must be empty/);
    expect(errors).toMatch(/humanStopId must name/);
  });

  it("rejects reusable claims without shared implementation and mutation/regression evidence", () => {
    const record = structuredClone(validRecord());
    const reusable = record.findings[0]! as unknown as {
      sharedImplementation: string[];
      sharedRegressionTests: string[];
    };
    reusable.sharedImplementation = [];
    reusable.sharedRegressionTests = [];
    const errors = validateTransferFindings(record).errors.join("\n");
    expect(errors).toMatch(/sharedImplementation must contain/);
    expect(errors).toMatch(/sharedRegressionTests must contain/);
  });

  it("rejects a closed classification record without a content-addressed supervised ledger", () => {
    const record = structuredClone(validRecord()) as unknown as { status: string };
    record.status = "supervised-transfer-closed";
    expect(validateTransferFindings(record).errors.join("\n")).toMatch(/must bind the closed supervised-transfer ledger/);
  });

  it("allows a recorded project-owner retained trial without inventing a detached ledger", () => {
    const record = structuredClone(validRecord()) as unknown as { status: string };
    record.status = "project-owner-retained-trial";
    expect(validateTransferFindings(record)).toEqual({ valid: true, errors: [] });
  });

  it("validates the sanitized Dust Bunny to Steps finding record and every public evidence path", () => {
    const evidencePath = path.join(repository, "governance/evidence/dust-steps-transfer-findings.json");
    const record = JSON.parse(fs.readFileSync(evidencePath, "utf8")) as TransferFindingsV1;
    expect(validateTransferFindings(record)).toEqual({ valid: true, errors: [] });
    expect(validateSchema(record), JSON.stringify(validateSchema.errors)).toBe(true);
    for (const finding of record.findings) {
      for (const relative of [...finding.evidence, ...finding.sharedImplementation, ...finding.sharedRegressionTests]) {
        expect(relative).not.toContain("workspaces/");
        expect(fs.existsSync(path.join(repository, relative)), relative).toBe(true);
      }
    }
  });
});
