import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  QUALIFICATION_PLAN_SCHEMA_VERSION,
  QUALIFICATION_RISK_DIMENSIONS,
  assertQualificationPlan,
  type QualificationCandidateV1,
  type QualificationPlanV1,
  type QualificationRiskDimension,
} from "../packages/contracts/src/qualification-plan.ts";

type JsonRecord = Record<string, any>;

function parseArguments(values: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("Expected --name value pairs");
    result.set(key.slice(2), value);
  }
  return result;
}

function required(arguments_: Map<string, string>, name: string): string {
  const value = arguments_.get(name);
  if (!value) throw new Error(`--${name} is required`);
  return path.resolve(value);
}

function readJson(file: string): JsonRecord {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256Bytes(bytes: string | NodeJS.ArrayBufferView): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256File(file: string): string {
  return sha256Bytes(fs.readFileSync(file));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableHash(value: unknown): string {
  return sha256Bytes(stableJson(value));
}

function writeOrVerify(file: string, serialized: string, write: boolean, label: string): void {
  if (write) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, serialized);
  } else {
    assert.equal(fs.readFileSync(file, "utf8"), serialized, `${label} is stale; regenerate and review it`);
  }
}

function normalizedAnalysis(analysis: JsonRecord): unknown {
  return [...analysis.carts].sort((left, right) => left.filename.localeCompare(right.filename)).map((cart) => ({
    filename: cart.filename,
    version: cart.version,
    sha256: cart.sha256,
    title: cart.title,
    byline: cart.byline,
    luaChars: cart.lua_chars,
    luaLines: cart.lua_lines,
    sections: cart.sections,
    sectionPayloadChars: cart.section_payload_chars,
    features: cart.features,
  }));
}

function normalizedAudio(audio: JsonRecord): unknown {
  return [...audio.carts].sort((left, right) => left.filename.localeCompare(right.filename)).map((cart) => ({
    filename: cart.filename,
    version: cart.version,
    activeNoteCount: cart.active_note_count,
    waveforms: cart.waveforms,
    effects: cart.effects,
    filteredSfx: cart.filtered_sfx,
    customInstrumentRefs: cart.custom_instrument_refs,
    musicPatternCount: cart.music_pattern_count,
    musicFlowFlags: cart.music_flow_flags,
  }));
}

function normalizedCompileAudit(compileAudit: JsonRecord): unknown {
  return {
    schemaVersion: compileAudit.schema_version,
    runtime: compileAudit.runtime,
    runtimeCommit: compileAudit.runtime_commit,
    cartCount: compileAudit.cart_count,
    passCount: compileAudit.pass_count,
    failureCount: compileAudit.failure_count,
    failures: [...compileAudit.failures].sort((left, right) => left.cart.localeCompare(right.cart)),
  };
}

function featureId(value: string): string {
  return value.replaceAll("_", "-");
}

const arguments_ = parseArguments(process.argv.slice(2));
const analysisPath = required(arguments_, "analysis");
const audioPath = required(arguments_, "audio");
const compilePath = required(arguments_, "compile");
const selectionPath = required(arguments_, "selection");
const encodedDirectory = required(arguments_, "encoded-dir");
const outputPath = required(arguments_, "out");
const attestationPath = required(arguments_, "attestation");
const write = arguments_.get("write") === "true";

const analysis = readJson(analysisPath);
const audio = readJson(audioPath);
const compileAudit = readJson(compilePath);
const selection = readJson(selectionPath);
assert.equal(selection.schemaVersion, "aico8.qualification-selection-input.v1");
assert.equal(analysis.summary.cart_count, analysis.carts.length);
assert.equal(audio.summary.cart_count, audio.carts.length);
assert.equal(compileAudit.cart_count, analysis.carts.length);
assert.equal(selection.candidates.length, 12, "Selection input must contain exactly twelve candidates");

const analysisByFilename = new Map(analysis.carts.map((cart: JsonRecord) => [cart.filename, cart]));
const audioByFilename = new Map(audio.carts.map((cart: JsonRecord) => [cart.filename, cart]));
const compileFailures = new Set(compileAudit.failures.map((failure: JsonRecord) => failure.cart));

const candidates: QualificationCandidateV1[] = selection.candidates.map((input: JsonRecord) => {
  const cart = analysisByFilename.get(input.filename);
  const cartAudio = audioByFilename.get(input.filename);
  assert.ok(cart, `${input.filename}: missing corpus analysis`);
  assert.ok(cartAudio, `${input.filename}: missing audio analysis`);
  assert.ok(!compileFailures.has(input.filename), `${input.filename}: pinned z8lua compile failed`);
  const title = input.title ?? cart.title;
  const byline = input.byline ?? cart.byline;
  assert.ok(title, `${input.filename}: title must be declared or normalized before selection`);
  assert.ok(byline, `${input.filename}: byline must be declared or normalized before selection`);
  const encodedPath = path.join(encodedDirectory, `${input.filename}.png`);
  assert.ok(fs.statSync(encodedPath, { throwIfNoEntry: false })?.isFile(), `${input.filename}: encoded cart is missing`);
  const qualification = { ...input.qualification };
  return {
    priority: input.priority,
    gameId: input.gameId,
    title,
    byline,
    cart: {
      filename: input.filename,
      encodedSha256: sha256File(encodedPath),
      decodedSha256: cart.sha256,
      version: cart.version,
      luaChars: cart.lua_chars,
    },
    runtime: {
      updateRate: cart.features.includes("update_60") ? 60 : 30,
      compileStatus: "passed",
      featureIds: cart.features.map(featureId).sort(),
      audio: {
        activeNoteCount: cartAudio.active_note_count,
        musicPatternCount: cartAudio.music_pattern_count,
        customInstrumentCount: cartAudio.custom_instrument_refs.length,
        filteredSfxCount: cartAudio.filtered_sfx.length,
      },
    },
    rights: {
      researchStatus: "authorized-private-research",
      formalReleaseStatus: "not-authorized",
      evidence: "user-provided-corpus",
    },
    finiteness: input.finiteness,
    riskCoverage: [...input.riskCoverage].sort(),
    qualification,
  } as QualificationCandidateV1;
});

const coverage = Object.fromEntries(QUALIFICATION_RISK_DIMENSIONS.map((risk) => [risk, {
  selectedCandidateIds: candidates.filter(({ riskCoverage }) => riskCoverage.includes(risk)).map(({ gameId }) => gameId).sort(),
  qualifiedCandidateIds: candidates.filter(({ riskCoverage, qualification }) => riskCoverage.includes(risk) && qualification.status === "qualified").map(({ gameId }) => gameId).sort(),
}])) as QualificationPlanV1["coverage"];

const plan: QualificationPlanV1 = {
  schemaVersion: QUALIFICATION_PLAN_SCHEMA_VERSION,
  programId: selection.programId,
  status: candidates.filter(({ qualification }) => qualification.status === "qualified").length >= 10
    && QUALIFICATION_RISK_DIMENSIONS.every((risk) => coverage[risk].qualifiedCandidateIds.length > 0)
    ? "qualification-complete"
    : "selection-locked",
  inventory: {
    sourceKind: "user-provided-private-research-corpus",
    encodedCartCount: fs.readdirSync(encodedDirectory).filter((filename) => filename.endsWith(".p8.png")).length,
    decodedCartCount: analysis.summary.cart_count,
    inventorySha256: stableHash(normalizedAnalysis(analysis)),
    audioInventorySha256: stableHash(normalizedAudio(audio)),
    compileAuditSha256: stableHash(normalizedCompileAudit(compileAudit)),
    duplicateGroupCount: analysis.summary.duplicate_groups.length,
    compilePassCount: compileAudit.pass_count,
    compileFailureCount: compileAudit.failure_count,
  },
  policy: {
    requiredCandidateCount: 12,
    requiredQualificationCount: 10,
    requiresPrivateResearchAuthorization: true,
    requiresFiniteEnding: true,
    requiresPinnedCompilePass: true,
    requiresIndependentEvidence: true,
  },
  candidates,
  coverage,
};
assertQualificationPlan(plan);
const serializedPlan = `${JSON.stringify(plan, null, 2)}\n`;
const planSha256 = sha256Bytes(serializedPlan);
const attestation = {
  schema_version: 1,
  subject: "Private qualification corpus and risk selection",
  status: plan.status,
  rights_scope: "User-provided carts are authorized for private research and testing only; no formal release is authorized by this record.",
  observations: {
    encoded_cart_count: plan.inventory.encodedCartCount,
    decoded_cart_count: plan.inventory.decodedCartCount,
    duplicate_group_count: plan.inventory.duplicateGroupCount,
    pinned_compile_pass_count: plan.inventory.compilePassCount,
    pinned_compile_failure_count: plan.inventory.compileFailureCount,
    selected_candidate_count: plan.candidates.length,
    qualified_game_count: plan.candidates.filter(({ qualification }) => qualification.status === "qualified").length,
    required_qualification_count: plan.policy.requiredQualificationCount,
    all_candidates_source_confirmed_finite: plan.candidates.every(({ finiteness }) => finiteness.status === "source-confirmed" || finiteness.status === "replay-confirmed"),
    all_candidates_compile_passed: plan.candidates.every(({ runtime }) => runtime.compileStatus === "passed"),
    all_candidates_formal_release_blocked: plan.candidates.every(({ rights }) => rights.formalReleaseStatus === "not-authorized"),
    risk_dimensions: Object.fromEntries(QUALIFICATION_RISK_DIMENSIONS.map((risk) => [risk, {
      selected: coverage[risk].selectedCandidateIds.length,
      qualified: coverage[risk].qualifiedCandidateIds.length,
    }])),
  },
  private_artifact_sha256: {
    normalized_inventory: plan.inventory.inventorySha256,
    normalized_audio_inventory: plan.inventory.audioInventorySha256,
    normalized_compile_audit: plan.inventory.compileAuditSha256,
    qualification_plan: planSha256,
  },
  selector: "TEST-QUALIFICATION-PLAN-PRIVATE",
};
const serializedAttestation = `${JSON.stringify(attestation, null, 2)}\n`;
writeOrVerify(outputPath, serializedPlan, write, "Private qualification plan");
writeOrVerify(attestationPath, serializedAttestation, write, "Public qualification-plan attestation");
process.stdout.write(
  `Qualification plan: PASS (${plan.candidates.length} selected, ${attestation.observations.qualified_game_count} qualified, ${QUALIFICATION_RISK_DIMENSIONS.length} risk dimensions)\n`,
);
