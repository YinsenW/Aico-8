import type { TypographyRole } from "./typography.js";

export const TYPOGRAPHY_ACCESSIBILITY_AUDIT_SCHEMA_VERSION = "aico8.typography-accessibility-audit.v1" as const;
export const TYPOGRAPHY_READABILITY_DECISION_SCHEMA_VERSION = "aico8.typography-readability-decision.v1" as const;

export const TYPOGRAPHY_READABILITY_CHECKS = [
  "phoneTitleReadable",
  "hudLabelsCrispAcrossProfiles",
  "glyphsCompleteWithoutFallback",
  "visualHierarchyPreserved",
] as const;

export const REQUIRED_ACCESSIBILITY_REGRESSIONS = [
  "undersized-text",
  "low-contrast",
  "unsupported-code-point",
  "unproven-assistive-copy",
  "compatibility-state-drift",
] as const;

export type TypographyAccessibilityRegression = (typeof REQUIRED_ACCESSIBILITY_REGRESSIONS)[number];
export type TypographyReadabilityCheck = (typeof TYPOGRAPHY_READABILITY_CHECKS)[number];
export type TypographyReadabilityVerdict = "passed" | "failed";

export interface TypographyReadabilityDecisionV1 {
  readonly schemaVersion: typeof TYPOGRAPHY_READABILITY_DECISION_SCHEMA_VERSION;
  readonly gameId: string;
  readonly decision: "approved" | "rejected";
  readonly reviewer: string;
  readonly reviewedAt: string;
  readonly subject: Readonly<{
    pendingAuditSha256: string;
    reviewPacketSha256: string;
    sourceSha256: string;
    typographyManifestSha256: string;
    textInventorySha256: string;
  }>;
  readonly checks: Readonly<Record<TypographyReadabilityCheck, TypographyReadabilityVerdict>>;
  readonly notes: string;
}

export interface SourceDerivedAccessibleDescriptionV1 {
  readonly sceneId: string;
  readonly text: string;
  readonly provenance: "state-derived-accessibility";
  readonly sourceEvidenceIds: readonly string[];
}

export interface TypographyAccessibilitySampleV1 {
  readonly id: string;
  readonly role: TypographyRole;
  readonly fontSizeCssPx: number;
  readonly minimumCssPx: number;
  readonly measuredWidthCssPx: number;
  readonly availableWidthCssPx: number;
  readonly measuredLineHeightCssPx: number;
  readonly availableHeightCssPx: number;
  readonly foreground: `#${string}`;
  readonly background: `#${string}`;
  readonly contrastRatio: number;
  readonly requiredContrastRatio: 3 | 4.5;
  readonly fits: boolean;
  readonly overflowed: boolean;
}

export interface TypographyAccessibilityAuditV1 {
  readonly schemaVersion: typeof TYPOGRAPHY_ACCESSIBILITY_AUDIT_SCHEMA_VERSION;
  readonly status: "draft" | "accepted";
  readonly gameId: string;
  readonly sourceSha256: string;
  readonly typographyManifestSha256: string;
  readonly textInventorySha256: string;
  readonly languageCoverage: readonly Readonly<{
    locale: string;
    script: string;
    status: "complete";
    missingCodePoints: readonly number[];
  }>[];
  readonly unsupportedScripts: readonly Readonly<{
    script: string;
    reason: "no-bundled-font-coverage" | "no-human-readability-review";
  }>[];
  readonly deliveryProfiles: readonly Readonly<{
    id: string;
    viewport: Readonly<{ width: number; height: number }>;
    samples: readonly TypographyAccessibilitySampleV1[];
  }>[];
  readonly assistiveText: Readonly<{
    descriptionsObserved: number;
    sceneIds: readonly string[];
    missingSceneIds: readonly string[];
    unprovenDescriptionIds: readonly string[];
    compatibilityStateMutations: number;
  }>;
  readonly manualReadability:
    | Readonly<{ status: "pending" }>
    | Readonly<{ status: "approved"; reviewer: string; decisionSha256: string }>
    | Readonly<{ status: "rejected"; reviewer: string; reason: string; decisionSha256: string }>;
  readonly regressions: readonly Readonly<{
    category: TypographyAccessibilityRegression;
    rejected: true;
  }>[];
}

export interface TypographyAccessibilityValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

const hashPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-z0-9][a-z0-9._:-]{1,127}$/;
const localePattern = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;
const scriptPattern = /^[A-Z][a-z]{3}$/;
const colorPattern = /^#[a-fA-F0-9]{6}$/;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, path: string, errors: string[]): UnknownRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  return value as UnknownRecord;
}

function exactKeys(value: UnknownRecord, keys: readonly string[], path: string, errors: string[]): void {
  const expected = new Set(keys);
  for (const key of keys) if (!(key in value)) errors.push(`${path}.${key} is required`);
  for (const key of Object.keys(value)) if (!expected.has(key)) errors.push(`${path}.${key} is not allowed`);
}

function linearChannel(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: string): number {
  if (!colorPattern.test(color)) throw new TypeError(`Invalid opaque sRGB color ${color}`);
  const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
  return 0.2126 * linearChannel(channels[0]!)
    + 0.7152 * linearChannel(channels[1]!)
    + 0.0722 * linearChannel(channels[2]!);
}

export function typographyContrastRatio(foreground: string, background: string): number {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((left, right) => right - left);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

export function requiredTextContrast(fontSizeCssPx: number, weight: number): 3 | 4.5 {
  if (!(fontSizeCssPx > 0) || !Number.isFinite(fontSizeCssPx)) throw new TypeError("Font size must be positive and finite");
  return fontSizeCssPx >= 24 || (weight >= 700 && fontSizeCssPx >= 18.66) ? 3 : 4.5;
}

export function sourceDerivedAccessibleDescription(
  value: Omit<SourceDerivedAccessibleDescriptionV1, "provenance">,
): SourceDerivedAccessibleDescriptionV1 {
  if (!idPattern.test(value.sceneId)) throw new TypeError("Accessible description sceneId is invalid");
  if (!value.text.trim()) throw new TypeError("Accessible description text must not be empty");
  if (value.sourceEvidenceIds.length === 0
    || new Set(value.sourceEvidenceIds).size !== value.sourceEvidenceIds.length
    || value.sourceEvidenceIds.some((id) => !idPattern.test(id))) {
    throw new TypeError("Accessible description requires unique source evidence IDs");
  }
  return { ...value, provenance: "state-derived-accessibility" };
}

export function validateTypographyAccessibilityAudit(value: unknown): TypographyAccessibilityValidationResult {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { valid: false, errors: ["$ must be an object"] };
  const audit = value as Partial<TypographyAccessibilityAuditV1>;
  const accepted = audit.status === "accepted";
  if (audit.schemaVersion !== TYPOGRAPHY_ACCESSIBILITY_AUDIT_SCHEMA_VERSION) {
    errors.push(`$.schemaVersion must equal ${TYPOGRAPHY_ACCESSIBILITY_AUDIT_SCHEMA_VERSION}`);
  }
  if (!accepted && audit.status !== "draft") errors.push("$.status must be draft or accepted");
  if (typeof audit.gameId !== "string" || !idPattern.test(audit.gameId)) errors.push("$.gameId is invalid");
  for (const key of ["sourceSha256", "typographyManifestSha256", "textInventorySha256"] as const) {
    if (typeof audit[key] !== "string" || !hashPattern.test(audit[key]!)) errors.push(`$.${key} must be a SHA-256 digest`);
  }

  if (!Array.isArray(audit.languageCoverage) || audit.languageCoverage.length === 0) {
    errors.push("$.languageCoverage must declare at least one supported locale");
  } else for (const [index, coverage] of audit.languageCoverage.entries()) {
    if (!localePattern.test(coverage.locale)) errors.push(`$.languageCoverage[${index}].locale is invalid`);
    if (!scriptPattern.test(coverage.script)) errors.push(`$.languageCoverage[${index}].script is invalid`);
    if (coverage.status !== "complete") errors.push(`$.languageCoverage[${index}].status must be complete`);
    if (!Array.isArray(coverage.missingCodePoints)
      || coverage.missingCodePoints.some((codePoint: unknown) => !Number.isSafeInteger(codePoint))) {
      errors.push(`$.languageCoverage[${index}].missingCodePoints is invalid`);
    } else if (accepted && coverage.missingCodePoints.length > 0) {
      errors.push(`$.languageCoverage[${index}] has missing code points`);
    }
  }
  if (!Array.isArray(audit.unsupportedScripts)) errors.push("$.unsupportedScripts must be an array");
  else for (const [index, entry] of audit.unsupportedScripts.entries()) {
    if (!scriptPattern.test(entry.script)) errors.push(`$.unsupportedScripts[${index}].script is invalid`);
    if (entry.reason !== "no-bundled-font-coverage" && entry.reason !== "no-human-readability-review") {
      errors.push(`$.unsupportedScripts[${index}].reason is invalid`);
    }
  }

  const requiredProfiles = new Set([
    "square-handheld-1024x1024",
    "android-handheld-landscape-1280x720",
    "phone-portrait-390x844",
  ]);
  if (!Array.isArray(audit.deliveryProfiles)) errors.push("$.deliveryProfiles must be an array");
  else {
    const profileIds = new Set(audit.deliveryProfiles.map((profile) => profile.id));
    if (accepted) for (const id of requiredProfiles) if (!profileIds.has(id)) errors.push(`$.deliveryProfiles is missing ${id}`);
    for (const [profileIndex, profile] of audit.deliveryProfiles.entries()) {
      if (!idPattern.test(profile.id)) errors.push(`$.deliveryProfiles[${profileIndex}].id is invalid`);
      if (!Number.isSafeInteger(profile.viewport?.width) || profile.viewport.width <= 0
        || !Number.isSafeInteger(profile.viewport?.height) || profile.viewport.height <= 0) {
        errors.push(`$.deliveryProfiles[${profileIndex}].viewport is invalid`);
      }
      if (!Array.isArray(profile.samples) || profile.samples.length === 0) errors.push(`$.deliveryProfiles[${profileIndex}].samples is empty`);
      else for (const [sampleIndex, sample] of profile.samples.entries()) {
        const path = `$.deliveryProfiles[${profileIndex}].samples[${sampleIndex}]`;
        if (!idPattern.test(sample.id)) errors.push(`${path}.id is invalid`);
        if (!(sample.fontSizeCssPx >= sample.minimumCssPx) || !(sample.minimumCssPx >= 12)) errors.push(`${path} violates its CSS-pixel floor`);
        const finitePositive = (number: unknown) => typeof number === "number" && Number.isFinite(number) && number > 0;
        for (const dimension of ["measuredWidthCssPx", "availableWidthCssPx", "measuredLineHeightCssPx", "availableHeightCssPx"] as const) {
          if (!finitePositive(sample[dimension])) errors.push(`${path}.${dimension} must be positive and finite`);
        }
        const computedFit = finitePositive(sample.measuredWidthCssPx)
          && finitePositive(sample.availableWidthCssPx)
          && finitePositive(sample.measuredLineHeightCssPx)
          && finitePositive(sample.availableHeightCssPx)
          && sample.measuredWidthCssPx <= sample.availableWidthCssPx + 0.005
          && sample.measuredLineHeightCssPx <= sample.availableHeightCssPx + 0.005;
        if (sample.fits !== computedFit) errors.push(`${path}.fits must be derived from measured and available bounds`);
        if (!colorPattern.test(sample.foreground) || !colorPattern.test(sample.background)) errors.push(`${path} colors must be opaque sRGB hex`);
        const measured = colorPattern.test(sample.foreground) && colorPattern.test(sample.background)
          ? typographyContrastRatio(sample.foreground, sample.background) : 0;
        if (Math.abs(measured - sample.contrastRatio) > 0.005) errors.push(`${path}.contrastRatio does not match its colors`);
        if (sample.requiredContrastRatio !== 3 && sample.requiredContrastRatio !== 4.5) errors.push(`${path}.requiredContrastRatio is invalid`);
        if (sample.contrastRatio + 0.005 < sample.requiredContrastRatio) errors.push(`${path} does not meet contrast`);
        if (!sample.fits || sample.overflowed) errors.push(`${path} does not fit its delivery profile`);
      }
    }
  }

  const assistive = audit.assistiveText;
  if (!assistive) errors.push("$.assistiveText is required");
  else {
    if (!Number.isSafeInteger(assistive.descriptionsObserved) || assistive.descriptionsObserved <= 0) errors.push("$.assistiveText.descriptionsObserved must be positive");
    for (const key of ["sceneIds", "missingSceneIds", "unprovenDescriptionIds"] as const) {
      if (!Array.isArray(assistive[key]) || assistive[key].some((id) => !idPattern.test(id))) errors.push(`$.assistiveText.${key} is invalid`);
    }
    if (!Number.isSafeInteger(assistive.compatibilityStateMutations) || assistive.compatibilityStateMutations < 0) {
      errors.push("$.assistiveText.compatibilityStateMutations is invalid");
    }
    if (accepted && (assistive.missingSceneIds.length > 0 || assistive.unprovenDescriptionIds.length > 0
      || assistive.compatibilityStateMutations !== 0)) errors.push("$.assistiveText must be complete and state-neutral before acceptance");
  }

  const manual = audit.manualReadability;
  if (!manual) errors.push("$.manualReadability is required");
  else if (manual.status === "approved" || manual.status === "rejected") {
    if (!manual.reviewer.trim() || !hashPattern.test(manual.decisionSha256)) errors.push("$.manualReadability decision evidence is invalid");
    if (manual.status === "rejected" && !manual.reason.trim()) errors.push("$.manualReadability.reason is required");
  } else if (manual.status !== "pending") errors.push("$.manualReadability.status is invalid");
  if (accepted && manual?.status !== "approved") errors.push("$.manualReadability must be approved before acceptance");

  if (!Array.isArray(audit.regressions)) errors.push("$.regressions is required");
  else if (accepted) for (const category of REQUIRED_ACCESSIBILITY_REGRESSIONS) {
    if (!audit.regressions.some((regression) => regression.category === category && regression.rejected === true)) {
      errors.push(`$.regressions must prove rejection of ${category}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function assertTypographyAccessibilityAudit(value: unknown): asserts value is TypographyAccessibilityAuditV1 {
  const result = validateTypographyAccessibilityAudit(value);
  if (!result.valid) throw new TypeError(`Invalid typography accessibility audit:\n- ${result.errors.join("\n- ")}`);
}

export function validateTypographyReadabilityDecision(
  value: unknown,
  pendingAudit?: unknown,
): TypographyAccessibilityValidationResult {
  const errors: string[] = [];
  const root = record(value, "$", errors);
  if (!root) return { valid: false, errors };
  exactKeys(root, ["schemaVersion", "gameId", "decision", "reviewer", "reviewedAt", "subject", "checks", "notes"], "$", errors);
  if (root.schemaVersion !== TYPOGRAPHY_READABILITY_DECISION_SCHEMA_VERSION) {
    errors.push(`$.schemaVersion must equal ${TYPOGRAPHY_READABILITY_DECISION_SCHEMA_VERSION}`);
  }
  if (typeof root.gameId !== "string" || !idPattern.test(root.gameId)) errors.push("$.gameId is invalid");
  if (root.decision !== "approved" && root.decision !== "rejected") errors.push("$.decision must be approved or rejected");
  if (typeof root.reviewer !== "string" || !idPattern.test(root.reviewer)) errors.push("$.reviewer is invalid");
  if (typeof root.reviewedAt !== "string" || Number.isNaN(Date.parse(root.reviewedAt))) {
    errors.push("$.reviewedAt must be an ISO date-time");
  }
  if (typeof root.notes !== "string" || root.notes.trim().length === 0) errors.push("$.notes must be non-empty");

  const subject = record(root.subject, "$.subject", errors);
  const subjectKeys = [
    "pendingAuditSha256", "reviewPacketSha256", "sourceSha256",
    "typographyManifestSha256", "textInventorySha256",
  ] as const;
  if (subject) {
    exactKeys(subject, subjectKeys, "$.subject", errors);
    for (const key of subjectKeys) {
      if (typeof subject[key] !== "string" || !hashPattern.test(subject[key])) {
        errors.push(`$.subject.${key} must be a SHA-256 digest`);
      }
    }
  }

  const checks = record(root.checks, "$.checks", errors);
  if (checks) {
    exactKeys(checks, TYPOGRAPHY_READABILITY_CHECKS, "$.checks", errors);
    for (const check of TYPOGRAPHY_READABILITY_CHECKS) {
      if (checks[check] !== "passed" && checks[check] !== "failed") {
        errors.push(`$.checks.${check} must be passed or failed`);
      }
    }
    const expectedDecision = TYPOGRAPHY_READABILITY_CHECKS.every((check) => checks[check] === "passed")
      ? "approved" : "rejected";
    if (root.decision !== expectedDecision) errors.push(`$.decision must equal derived value ${expectedDecision}`);
  }

  if (pendingAudit !== undefined) {
    const pendingValidation = validateTypographyAccessibilityAudit(pendingAudit);
    if (!pendingValidation.valid) {
      errors.push(...pendingValidation.errors.map((error) => `pending audit ${error}`));
    } else {
      const pending = pendingAudit as TypographyAccessibilityAuditV1;
      if (pending.status !== "draft" || pending.manualReadability.status !== "pending") {
        errors.push("pending audit must be draft with manual readability pending");
      }
      if (root.gameId !== pending.gameId) errors.push("$.gameId must match the pending audit");
      if (subject) {
        const bindings = [
          ["sourceSha256", pending.sourceSha256],
          ["typographyManifestSha256", pending.typographyManifestSha256],
          ["textInventorySha256", pending.textInventorySha256],
        ] as const;
        for (const [key, expected] of bindings) {
          if (subject[key] !== expected) errors.push(`$.subject.${key} must match the pending audit`);
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function applyTypographyReadabilityDecision(options: {
  readonly pendingAudit: TypographyAccessibilityAuditV1;
  readonly pendingAuditSha256: string;
  readonly reviewPacketSha256: string;
  readonly decision: TypographyReadabilityDecisionV1;
  readonly decisionSha256: string;
}): TypographyAccessibilityAuditV1 {
  const validation = validateTypographyReadabilityDecision(options.decision, options.pendingAudit);
  if (!validation.valid) {
    throw new TypeError(`Invalid typography readability decision:\n- ${validation.errors.join("\n- ")}`);
  }
  if (options.decision.subject.pendingAuditSha256 !== options.pendingAuditSha256) {
    throw new TypeError("Typography readability decision does not bind the exact pending audit bytes");
  }
  if (options.decision.subject.reviewPacketSha256 !== options.reviewPacketSha256) {
    throw new TypeError("Typography readability decision does not bind the exact review packet bytes");
  }
  if (!hashPattern.test(options.decisionSha256)) throw new TypeError("Typography readability decision hash is invalid");

  const approved = options.decision.decision === "approved";
  const finalized: TypographyAccessibilityAuditV1 = {
    ...options.pendingAudit,
    status: approved ? "accepted" : "draft",
    manualReadability: approved
      ? { status: "approved", reviewer: options.decision.reviewer, decisionSha256: options.decisionSha256 }
      : {
          status: "rejected",
          reviewer: options.decision.reviewer,
          reason: options.decision.notes,
          decisionSha256: options.decisionSha256,
        },
  };
  const finalValidation = validateTypographyAccessibilityAudit(finalized);
  if (!finalValidation.valid) {
    throw new TypeError(`Typography readability decision produced an invalid audit:\n- ${finalValidation.errors.join("\n- ")}`);
  }
  return finalized;
}
