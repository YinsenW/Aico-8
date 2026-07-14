import { describe, expect, it } from "vitest";

import {
  QUALIFICATION_PLAN_SCHEMA_VERSION,
  QUALIFICATION_RISK_DIMENSIONS,
  validateQualificationPlan,
} from "./qualification-plan.js";

const hash = (digit: string) => digit.repeat(64);

function candidate(index: number) {
  const gameId = `game-${String(index).padStart(2, "0")}`;
  const qualified = index === 1;
  return {
    priority: index,
    gameId,
    title: `Game ${index}`,
    byline: `Author ${index}`,
    cart: {
      filename: `${gameId}.p8`,
      encodedSha256: hash(index.toString(16).slice(-1)),
      decodedSha256: hash(((index + 3) % 16).toString(16)),
      version: 42,
      luaChars: 10_000 + index,
    },
    runtime: {
      updateRate: index % 2 === 0 ? 60 : 30,
      compileStatus: "passed",
      featureIds: ["controller-input", "sprite-draw"],
      audio: { activeNoteCount: index, musicPatternCount: 1, customInstrumentCount: 0, filteredSfxCount: 0 },
    },
    rights: {
      researchStatus: "authorized-private-research",
      formalReleaseStatus: "not-authorized",
      evidence: "user-provided-corpus",
    },
    finiteness: {
      status: qualified ? "replay-confirmed" : "source-confirmed",
      sourceAnchors: ["lua-line:10-20"],
      boundaries: [
        { id: "all-levels", kind: "level-set", count: index },
        { id: "ending", kind: "ending" },
      ],
    },
    riskCoverage: [...QUALIFICATION_RISK_DIMENSIONS],
    qualification: {
      status: qualified ? "qualified" : "selected",
      workspaceId: `workspace-${String(index).padStart(2, "0")}`,
      ...(qualified ? {
        canonicalReplaySha256: hash("a"),
        hdReviewDecisionSha256: hash("b"),
        webPackageSha256: hash("c"),
      } : {}),
    },
  };
}

function validPlan() {
  const candidates = Array.from({ length: 12 }, (_, index) => candidate(index + 1));
  return {
    schemaVersion: QUALIFICATION_PLAN_SCHEMA_VERSION,
    programId: "private-ten-game-qualification",
    status: "selection-locked",
    inventory: {
      sourceKind: "user-provided-private-research-corpus",
      encodedCartCount: 291,
      decodedCartCount: 291,
      inventorySha256: hash("d"),
      audioInventorySha256: hash("e"),
      compileAuditSha256: hash("f"),
      duplicateGroupCount: 7,
      compilePassCount: 273,
      compileFailureCount: 18,
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
    coverage: Object.fromEntries(QUALIFICATION_RISK_DIMENSIONS.map((risk) => [risk, {
      selectedCandidateIds: candidates.map(({ gameId }) => gameId),
      qualifiedCandidateIds: [candidates[0]!.gameId],
    }])),
  };
}

describe("qualification plan contract", () => {
  it("accepts exactly twelve finite, private, compile-passing candidates with derived risk coverage", () => {
    expect(validateQualificationPlan(validPlan())).toEqual({ ok: true, errors: [] });
  });

  it("rejects candidate count, rank, and cart identity collapse", () => {
    const plan = validPlan();
    plan.candidates.pop();
    plan.candidates[1]!.priority = 1;
    plan.candidates[1]!.cart.encodedSha256 = plan.candidates[0]!.cart.encodedSha256;
    const errors = validateQualificationPlan(plan).errors.join("\n");
    expect(errors).toMatch(/exactly 12 candidates/);
    expect(errors).toMatch(/priority duplicates|include priority 12/);
    expect(errors).toMatch(/encodedSha256 duplicates/);
  });

  it("rejects a supposedly finite candidate without counted progression and completion boundaries", () => {
    const plan = validPlan();
    plan.candidates[1]!.finiteness.boundaries = [{ id: "title", kind: "title" }] as never;
    const errors = validateQualificationPlan(plan).errors.join("\n");
    expect(errors).toMatch(/counted progression boundary/);
    expect(errors).toMatch(/victory, ending, or credits boundary/);
  });

  it("rejects qualified status without all independent evidence hashes", () => {
    const plan = validPlan();
    plan.candidates[1]!.qualification.status = "qualified";
    const errors = validateQualificationPlan(plan).errors.join("\n");
    expect(errors).toMatch(/requires replay, HD decision, and Web package hashes/);
  });

  it("rejects hand-maintained coverage that drifts from candidate declarations", () => {
    const plan = validPlan();
    plan.coverage["audio-synthesis"]!.selectedCandidateIds = ["game-01"];
    expect(validateQualificationPlan(plan).errors.join("\n")).toMatch(/selectedCandidateIds must equal candidate declarations/);
  });

  it("rejects qualification completion before ten independently qualified games cover every risk", () => {
    const plan = validPlan();
    plan.status = "qualification-complete";
    const errors = validateQualificationPlan(plan).errors.join("\n");
    expect(errors).toMatch(/at least 10 qualified candidates/);
  });
});
