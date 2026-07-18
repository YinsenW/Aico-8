import { createHash } from "node:crypto";
import fs from "node:fs";
import { describe, expect, it } from "vitest";

import { ASSEMBLY_PLAN_SCHEMA_VERSION, planAcceptedBatchAssemblies, planFixedCollectionAssembly, planSingleGameAssembly } from "./assembly.js";
import { gameModuleSaveNamespace } from "./game-module.js";
import { BATCH_SCHEMA_VERSION, batchWorkspaceId, type BatchV1 } from "./batch.js";

const moduleFixture = (): any => JSON.parse(fs.readFileSync(
  new URL("../../../tests/contracts/game-module/valid-game-module.json", import.meta.url), "utf8",
));
const targetProfile = (): any => JSON.parse(fs.readFileSync(
  new URL("../../../apps/web/public/target-profile.json", import.meta.url), "utf8",
));
const targetProfileBytes = (): Buffer => fs.readFileSync(
  new URL("../../../apps/web/public/target-profile.json", import.meta.url),
);
const profileHash = "22a36b7376de290dc4b7fdfa720b0777fdcbb8ed15a0c2b23f883920525eb809";
const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

function fixedCollectionInputs(): { collection: any; modules: Map<string, { manifestBytes: Buffer }> } {
  const modules = new Map<string, { manifestBytes: Buffer }>();
  const entries = ["one", "two", "three"].map((suffix, index) => {
    const module = moduleFixture();
    module.moduleId = `synthetic-${suffix}`;
    module.save.namespace = gameModuleSaveNamespace(module.moduleId);
    module.provenance.sourceCartSha256 = String(index + 1).repeat(64);
    const manifestBytes = Buffer.from(`${JSON.stringify(module, null, 2)}\n`);
    modules.set(module.moduleId, { manifestBytes });
    return {
      moduleId: module.moduleId,
      manifestSha256: sha256(manifestBytes),
      saveNamespace: module.save.namespace,
      rightsProfile: module.provenance.rightsProfile,
      license: { spdxExpression: "Apache-2.0", notice: { path: "LICENSE.txt", sha256: sha256("synthetic license\n") } },
    };
  });
  return {
    modules,
    collection: {
      schemaVersion: "aico8.fixed-collection.v1",
      collectionId: "synthetic-trilogy",
      metadata: { title: "Synthetic Trilogy" },
      targetProfile: { id: targetProfile().id, sha256: profileHash },
      launcher: { initialModuleId: entries[0]!.moduleId },
      isolation: { resetCompatibilityStateOnSwitch: true, isolatedSaveNamespaces: true },
      budgets: { maxPackagedBytes: 10_000_000, maxPersistentBytes: 768 },
      modules: entries,
    },
  };
}

describe("single-game assembly plan", () => {
  it("creates one deterministic Web/PWA plan from a validated module", () => {
    const first = planSingleGameAssembly(moduleFixture(), targetProfileBytes());
    const second = planSingleGameAssembly(moduleFixture(), targetProfileBytes());
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    expect(first.plan?.schemaVersion).toBe(ASSEMBLY_PLAN_SCHEMA_VERSION);
    expect(first.plan?.artifacts.filter(({ packaged }) => packaged)).toHaveLength(7);
    expect(first.plan?.artifacts.filter(({ packaged }) => !packaged)).toHaveLength(2);
    expect(first.plan?.artifacts.every(({ destination }) => destination === undefined || destination.startsWith("module/"))).toBe(true);
  });

  it("rejects draft, target mismatch, stale profile bytes, and invalid modules", () => {
    const draft = moduleFixture();
    draft.status = "draft";
    draft.validation = { status: "pending", evidence: [] };
    expect(planSingleGameAssembly(draft, targetProfileBytes()).errors.join("\n"))
      .toMatch(/must be validated before assembly/);

    const wrongTarget = moduleFixture();
    wrongTarget.runtime.targetBindings[0].targetProfileId = "other-profile";
    expect(planSingleGameAssembly(wrongTarget, targetProfileBytes()).errors.join("\n"))
      .toMatch(/targetProfileId must match/);

    const changedProfile = targetProfile();
    changedProfile.outputProfile = "hd-square-1024-tampered";
    expect(planSingleGameAssembly(moduleFixture(), Buffer.from(JSON.stringify(changedProfile))).errors.join("\n"))
      .toMatch(/targetProfileSha256 must match/);

    const unsafe = moduleFixture();
    unsafe.payload.rom.path = "../private/source.rom";
    expect(planSingleGameAssembly(unsafe, targetProfileBytes()).errors.join("\n"))
      .toMatch(/safe relative path/);
  });

  it("plans only accepted batch modules and rejects a stale requested target", () => {
    const evidenceByKind = new Map(moduleFixture().validation.evidence.map(({ kind, sha256 }: any) => [kind, sha256]));
    const acceptedEvidence = {
      canonicalReplaySha256: evidenceByKind.get("canonical-replay") as string,
      hdReviewDecisionSha256: evidenceByKind.get("hd-review-decision") as string,
      webPackageSha256: "c".repeat(64),
    };
    const cartOne = "1".repeat(64);
    const cartTwo = "2".repeat(64);
    const base = (gameId: string, cartSha256: string, priority: number) => ({
      gameId,
      cartSha256,
      input: { cartPath: `carts/${gameId}.p8`, rightsProfile: "synthetic-public-fixture" },
      request: { product: "standalone-web" as const, targetProfileId: targetProfile().id, targetProfileSha256: profileHash },
      workspaceId: batchWorkspaceId("synthetic-batch", gameId, cartSha256),
      priority,
    });
    const batch: BatchV1 = {
      schemaVersion: BATCH_SCHEMA_VERSION,
      batchId: "synthetic-batch",
      status: "partial",
      policy: { maxParallel: 2, maxAttempts: 1, attemptTimeoutMs: 1000, failureIsolation: true, acceptanceRequiresEvidence: true },
      games: [{
        ...base("accepted-game", cartOne, 1), state: "accepted", stage: "accepted", attempt: 1,
        attempts: [{ attempt: 1, outcome: "accepted", stage: "accepted", moduleId: "synthetic-orbit", evidence: acceptedEvidence }],
        evidence: acceptedEvidence,
      }, {
        ...base("blocked-game", cartTwo, 2), state: "blocked", stage: "compatibility", attempt: 1,
        attempts: [{ attempt: 1, outcome: "blocked", stage: "compatibility", failureClass: "unsupported-api", evidence: {} }],
        failureClass: "unsupported-api", evidence: {},
      }],
    };
    const plans = planAcceptedBatchAssemblies(
      batch,
      new Map([["synthetic-orbit", moduleFixture()], ["blocked-module", { poison: true }]]),
      new Map([[targetProfile().id, { bytes: targetProfileBytes() }]]),
    );
    expect(plans.map(({ gameId }) => gameId)).toEqual(["accepted-game"]);

    const stale = structuredClone(batch) as any;
    stale.games[0].request.targetProfileSha256 = "f".repeat(64);
    expect(() => planAcceptedBatchAssemblies(
      stale,
      new Map([["synthetic-orbit", moduleFixture()]]),
      new Map([[targetProfile().id, { bytes: targetProfileBytes() }]]),
    )).toThrow(/target profile hash mismatch/);

    for (const [key, message] of [
      ["canonicalReplaySha256", /canonicalReplaySha256 does not match module canonical-replay/],
      ["hdReviewDecisionSha256", /hdReviewDecisionSha256 does not match module hd-review-decision/],
    ] as const) {
      const mismatched = structuredClone(batch) as any;
      mismatched.games[0].evidence[key] = "f".repeat(64);
      mismatched.games[0].attempts[0].evidence[key] = "f".repeat(64);
      expect(() => planAcceptedBatchAssemblies(
        mismatched,
        new Map([["synthetic-orbit", moduleFixture()]]),
        new Map([[targetProfile().id, { bytes: targetProfileBytes() }]]),
      )).toThrow(message);
    }

    const postAssemblyHash = structuredClone(batch) as any;
    postAssemblyHash.games[0].evidence.webPackageSha256 = "f".repeat(64);
    postAssemblyHash.games[0].attempts[0].evidence.webPackageSha256 = "f".repeat(64);
    expect(() => planAcceptedBatchAssemblies(
      postAssemblyHash,
      new Map([["synthetic-orbit", moduleFixture()]]),
      new Map([[targetProfile().id, { bytes: targetProfileBytes() }]]),
    )).not.toThrow();

    const tamperedProfile = targetProfile();
    tamperedProfile.outputProfile = "hd-square-1024-tampered";
    const staleCallerInput = {
      bytes: Buffer.from(JSON.stringify(tamperedProfile)),
      value: targetProfile(),
      sha256: profileHash,
    };
    expect(() => planAcceptedBatchAssemblies(
      batch,
      new Map([["synthetic-orbit", moduleFixture()]]),
      new Map([[targetProfile().id, staleCallerInput]]),
    )).toThrow(/targetProfileSha256 must match target profile bytes/);
  });
});

describe("fixed-collection assembly plan", () => {
  it("binds three independently validated manifests, isolated saves, licenses, target bytes, and budgets", () => {
    const { collection, modules } = fixedCollectionInputs();
    const result = planFixedCollectionAssembly(collection, modules, targetProfileBytes());
    expect(result.ok).toBe(true);
    expect(result.plan).toMatchObject({
      kind: "fixed-collection-web-pwa",
      collectionId: "synthetic-trilogy",
      launcher: { orderedModuleIds: ["synthetic-one", "synthetic-two", "synthetic-three"] },
      isolation: { resetCompatibilityStateOnSwitch: true },
      budgets: { declaredPersistentBytes: 768, maxPersistentBytes: 768 },
    });
    expect(new Set(Object.values(result.plan!.isolation.saveNamespaces)).size).toBe(3);
    expect(result.plan!.artifacts.filter(({ role }) => role === "license-notice")).toHaveLength(3);
    expect(result.plan!.artifacts.filter(({ role }) => role === "module-manifest")).toHaveLength(3);
    expect(result.plan!.artifacts.every(({ destination }) => destination?.startsWith(`modules/${result.plan!.artifacts.find((candidate) => candidate.destination === destination)!.moduleId}/`))).toBe(true);
  });

  it("fails closed on stale manifests, draft modules, target drift, budget overflow, or undeclared inputs", () => {
    const stale = fixedCollectionInputs();
    stale.collection.modules[0].manifestSha256 = "f".repeat(64);
    expect(planFixedCollectionAssembly(stale.collection, stale.modules, targetProfileBytes()).errors.join("\n"))
      .toMatch(/manifestSha256 must match manifest bytes/);

    const draft = fixedCollectionInputs();
    const draftInput = JSON.parse(draft.modules.get("synthetic-one")!.manifestBytes.toString("utf8"));
    draftInput.status = "draft";
    draftInput.validation = { status: "pending", evidence: [] };
    const draftBytes = Buffer.from(`${JSON.stringify(draftInput, null, 2)}\n`);
    draft.modules.set("synthetic-one", { manifestBytes: draftBytes });
    draft.collection.modules[0].manifestSha256 = sha256(draftBytes);
    expect(planFixedCollectionAssembly(draft.collection, draft.modules, targetProfileBytes()).errors.join("\n"))
      .toMatch(/must be independently validated/);

    const targetDrift = fixedCollectionInputs();
    targetDrift.collection.targetProfile.sha256 = "e".repeat(64);
    expect(planFixedCollectionAssembly(targetDrift.collection, targetDrift.modules, targetProfileBytes()).errors.join("\n"))
      .toMatch(/targetProfile\.sha256 must match/);

    const overflow = fixedCollectionInputs();
    overflow.collection.budgets.maxPersistentBytes = 767;
    expect(planFixedCollectionAssembly(overflow.collection, overflow.modules, targetProfileBytes()).errors.join("\n"))
      .toMatch(/persistent bytes exceed/);

    const undeclared = fixedCollectionInputs();
    undeclared.modules.set("poison", { manifestBytes: Buffer.from("{}") });
    expect(planFixedCollectionAssembly(undeclared.collection, undeclared.modules, targetProfileBytes()).errors.join("\n"))
      .toMatch(/undeclared input/);
  });
});
