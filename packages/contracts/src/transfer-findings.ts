import {
  SUPERVISED_TRANSFER_STOP_IDS,
  type SupervisedTransferStopId,
} from "./human-stop-decision.js";

export const TRANSFER_FINDINGS_SCHEMA_VERSION = "aico8.transfer-findings.v1" as const;

export const TRANSFER_FINDING_CLASSIFICATIONS = [
  "compatibility-runtime",
  "reusable-presentation",
  "source-relative-semantic-art",
] as const;

export type TransferFindingClassification = typeof TRANSFER_FINDING_CLASSIFICATIONS[number];
export type TransferFindingsStatus = "classified-human-stops-open" | "supervised-transfer-closed";

export interface TransferFindingV1 {
  readonly id: string;
  readonly title: string;
  readonly classification: TransferFindingClassification;
  readonly observation: string;
  readonly resolution: string;
  readonly evidence: readonly string[];
  readonly reusableRuleId: string | null;
  readonly sharedImplementation: readonly string[];
  readonly sharedRegressionTests: readonly string[];
  readonly humanStopId: SupervisedTransferStopId | null;
  readonly prohibitedGeneralization: string;
}

export interface TransferFindingsV1 {
  readonly schemaVersion: typeof TRANSFER_FINDINGS_SCHEMA_VERSION;
  readonly programId: string;
  readonly referenceGameId: string;
  readonly trialGameId: string;
  readonly status: TransferFindingsStatus;
  readonly supervisedTransferLedgerSha256: string | null;
  readonly findings: readonly TransferFindingV1[];
  readonly limitations: readonly string[];
}

export interface TransferFindingsValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

type JsonRecord = Record<string, unknown>;
const ID = /^[a-z0-9][a-z0-9-]{1,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const PUBLIC_PATH = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;

function record(value: unknown, path: string, errors: string[]): JsonRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, keys: readonly string[], path: string, errors: string[]): void {
  const expected = new Set(keys);
  for (const key of keys) if (!(key in value)) errors.push(`${path}.${key} is required`);
  for (const key of Object.keys(value)) if (!expected.has(key)) errors.push(`${path}.${key} is not allowed`);
}

function idValue(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value !== "string" || !ID.test(value)) {
    errors.push(`${path} must be a valid id`);
    return false;
  }
  return true;
}

function textValue(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value !== "string" || value.trim().length < 8) {
    errors.push(`${path} must contain a substantive explanation`);
    return false;
  }
  return true;
}

function uniqueStrings(
  value: unknown,
  path: string,
  errors: string[],
  options: { readonly minimum: number; readonly publicPaths?: boolean },
): string[] {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return [];
  }
  if (value.length < options.minimum) errors.push(`${path} must contain at least ${options.minimum} item(s)`);
  const result: string[] = [];
  const seen = new Set<string>();
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (typeof item !== "string" || item.length === 0) {
      errors.push(`${itemPath} must be a non-empty string`);
      return;
    }
    if (options.publicPaths && (!PUBLIC_PATH.test(item) || item.includes("..") || item.startsWith("workspaces/"))) {
      errors.push(`${itemPath} must be a safe public repository path`);
    }
    if (seen.has(item)) errors.push(`${itemPath} duplicates ${item}`);
    seen.add(item);
    result.push(item);
  });
  return result;
}

export function validateTransferFindings(value: unknown): TransferFindingsValidationResult {
  const errors: string[] = [];
  const root = record(value, "$", errors);
  if (!root) return { valid: false, errors };
  exactKeys(root, [
    "schemaVersion", "programId", "referenceGameId", "trialGameId", "status",
    "supervisedTransferLedgerSha256", "findings", "limitations",
  ], "$", errors);
  if (root.schemaVersion !== TRANSFER_FINDINGS_SCHEMA_VERSION) {
    errors.push(`$.schemaVersion must equal ${TRANSFER_FINDINGS_SCHEMA_VERSION}`);
  }
  idValue(root.programId, "$.programId", errors);
  idValue(root.referenceGameId, "$.referenceGameId", errors);
  idValue(root.trialGameId, "$.trialGameId", errors);
  if (root.referenceGameId === root.trialGameId) errors.push("$.trialGameId must differ from $.referenceGameId");
  if (root.status !== "classified-human-stops-open" && root.status !== "supervised-transfer-closed") {
    errors.push("$.status is unsupported");
  }
  if (root.status === "classified-human-stops-open") {
    if (root.supervisedTransferLedgerSha256 !== null) {
      errors.push("$.supervisedTransferLedgerSha256 must be null while human stops remain open");
    }
  } else if (typeof root.supervisedTransferLedgerSha256 !== "string" || !HASH.test(root.supervisedTransferLedgerSha256)) {
    errors.push("$.supervisedTransferLedgerSha256 must bind the closed supervised-transfer ledger");
  }

  const findingIds = new Set<string>();
  const reusableRuleIds = new Set<string>();
  const classifications = new Set<TransferFindingClassification>();
  if (!Array.isArray(root.findings) || root.findings.length < TRANSFER_FINDING_CLASSIFICATIONS.length) {
    errors.push("$.findings must contain at least one finding per classification");
  } else root.findings.forEach((value, index) => {
    const path = `$.findings[${index}]`;
    const finding = record(value, path, errors);
    if (!finding) return;
    exactKeys(finding, [
      "id", "title", "classification", "observation", "resolution", "evidence",
      "reusableRuleId", "sharedImplementation", "sharedRegressionTests", "humanStopId",
      "prohibitedGeneralization",
    ], path, errors);
    if (idValue(finding.id, `${path}.id`, errors)) {
      if (findingIds.has(finding.id)) errors.push(`${path}.id must be unique`);
      findingIds.add(finding.id);
    }
    textValue(finding.title, `${path}.title`, errors);
    textValue(finding.observation, `${path}.observation`, errors);
    textValue(finding.resolution, `${path}.resolution`, errors);
    textValue(finding.prohibitedGeneralization, `${path}.prohibitedGeneralization`, errors);
    uniqueStrings(finding.evidence, `${path}.evidence`, errors, { minimum: 1, publicPaths: true });
    const classification = finding.classification as TransferFindingClassification;
    if (!TRANSFER_FINDING_CLASSIFICATIONS.includes(classification)) {
      errors.push(`${path}.classification is unsupported`);
      return;
    }
    classifications.add(classification);
    const implementation = uniqueStrings(finding.sharedImplementation, `${path}.sharedImplementation`, errors, {
      minimum: classification === "source-relative-semantic-art" ? 0 : 1,
      publicPaths: true,
    });
    const tests = uniqueStrings(finding.sharedRegressionTests, `${path}.sharedRegressionTests`, errors, {
      minimum: classification === "source-relative-semantic-art" ? 0 : 1,
      publicPaths: true,
    });
    if (classification === "source-relative-semantic-art") {
      if (finding.reusableRuleId !== null) errors.push(`${path}.reusableRuleId must be null for source-relative work`);
      if (implementation.length > 0) errors.push(`${path}.sharedImplementation must be empty for source-relative work`);
      if (tests.length > 0) errors.push(`${path}.sharedRegressionTests must be empty for source-relative work`);
      if (!SUPERVISED_TRANSFER_STOP_IDS.includes(finding.humanStopId as SupervisedTransferStopId)) {
        errors.push(`${path}.humanStopId must name the responsible supervised human stop`);
      }
    } else {
      if (idValue(finding.reusableRuleId, `${path}.reusableRuleId`, errors)) {
        if (reusableRuleIds.has(finding.reusableRuleId)) errors.push(`${path}.reusableRuleId must be unique`);
        reusableRuleIds.add(finding.reusableRuleId);
      }
      if (finding.humanStopId !== null) errors.push(`${path}.humanStopId must be null for reusable machine rules`);
    }
  });
  for (const classification of TRANSFER_FINDING_CLASSIFICATIONS) {
    if (!classifications.has(classification)) errors.push(`$.findings must include ${classification}`);
  }
  uniqueStrings(root.limitations, "$.limitations", errors, { minimum: 1 });
  return { valid: errors.length === 0, errors };
}

export function assertTransferFindings(value: unknown): asserts value is TransferFindingsV1 {
  const result = validateTransferFindings(value);
  if (!result.valid) throw new Error(`Invalid transfer findings:\n${result.errors.join("\n")}`);
}
