import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  deriveFixedCollectionRuntimeBudget,
  expectedFixedCollectionRuntimeValidationStatus,
  validateFixedCollectionRuntimeValidation,
  type FixedCollectionRuntimeValidationV1,
} from "./collection-runtime-validation.js";

const schema = JSON.parse(readFileSync(
  new URL("../../../specs/schemas/fixed-collection-runtime-validation-v1.schema.json", import.meta.url), "utf8",
));
const schemaValidate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

function report(): FixedCollectionRuntimeValidationV1 {
  const modules = [
    { suffix: "a", from: "module-c", startupMs: 100, switchMs: 50, startupHeap: 1_000, switchHeap: 1_100 },
    { suffix: "b", from: "module-a", startupMs: 110, switchMs: 60, startupHeap: 1_100, switchHeap: 1_200 },
    { suffix: "c", from: "module-b", startupMs: 120, switchMs: 70, startupHeap: 1_200, switchHeap: 1_300 },
  ].map(({ suffix, from, startupMs, switchMs, startupHeap, switchHeap }) => ({
    moduleId: `module-${suffix}`,
    startup: {
      documentIdentity: `document-startup-${suffix}`,
      runtimeIdentity: `runtime-startup-${suffix}`,
      milliseconds: startupMs,
      jsHeapBytes: startupHeap,
    },
    switch: {
      fromModuleId: from,
      documentIdentity: `document-switch-${suffix}`,
      runtimeIdentity: `runtime-switch-${suffix}`,
      milliseconds: switchMs,
      jsHeapBytes: switchHeap,
    },
    save: {
      logicalKey: "slot-0",
      namespace: `module-${suffix}:aico8.game-module.v1`,
      writtenValue: `value-${suffix}`,
      restoredValue: `value-${suffix}`,
    },
  }));
  const limits = {
    startupMillisecondsMax: 200,
    switchMillisecondsMax: 100,
    jsHeapBytesMax: 2_000,
  };
  const budgets = deriveFixedCollectionRuntimeBudget(modules, limits);
  return {
    schemaVersion: "aico8.fixed-collection-runtime-validation.v1",
    subject: {
      collectionId: "private-trilogy",
      collectionManifestSha256: "1".repeat(64),
      collectionLauncherSha256: "2".repeat(64),
      targetProfileSha256: "3".repeat(64),
      assembledTreeSha256: "4".repeat(64),
    },
    browser: { name: "Chromium", version: "126.0.6478.126" },
    measurementMethod: {
      timing: "performance.now",
      heap: "performance.memory.usedJSHeapSize",
      identity: "child-handshake-token",
      storage: "namespaced-local-storage-round-trip",
    },
    modules,
    failedSwitches: [{
      fromModuleId: "module-c",
      toModuleId: "module-a",
      errorCode: "injected-load-failure",
      milliseconds: 25,
      activeModuleIdAfterFailure: null,
      activeDocumentIdentityAfterFailure: null,
      activeRuntimeIdentityAfterFailure: null,
    }],
    budgets,
    status: expectedFixedCollectionRuntimeValidationStatus(budgets),
  };
}

describe("fixed collection runtime validation contract", () => {
  it("accepts a content-bound three-module browser measurement with isolated restored saves", () => {
    const value = report();
    expect(value.budgets).toEqual({
      limits: {
        startupMillisecondsMax: 200,
        switchMillisecondsMax: 100,
        jsHeapBytesMax: 2_000,
      },
      observed: {
        maxStartupMilliseconds: 120,
        maxSwitchMilliseconds: 70,
        maxJsHeapBytes: 1_300,
      },
      passed: true,
    });
    expect(validateFixedCollectionRuntimeValidation(value)).toEqual({ ok: true, errors: [] });
    expect(schemaValidate(value), JSON.stringify(schemaValidate.errors)).toBe(true);
  });

  it("accepts an honestly failed budget report and rejects a forged passing conclusion", () => {
    const failed = structuredClone(report()) as any;
    failed.modules[2]!.startup.milliseconds = 250;
    failed.budgets = deriveFixedCollectionRuntimeBudget(failed.modules, failed.budgets.limits);
    failed.status = expectedFixedCollectionRuntimeValidationStatus(failed.budgets);
    expect(failed.budgets.passed).toBe(false);
    expect(failed.status).toBe("failed");
    expect(validateFixedCollectionRuntimeValidation(failed)).toEqual({ ok: true, errors: [] });
    expect(schemaValidate(failed), JSON.stringify(schemaValidate.errors)).toBe(true);

    const forged = structuredClone(failed) as any;
    forged.budgets.passed = true;
    forged.status = "passed";
    const result = validateFixedCollectionRuntimeValidation(forged);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/passed must be derived|status must be derived/);
  });

  it("refuses to derive a conclusion from unavailable measurements or invalid limits", () => {
    const value = structuredClone(report()) as any;
    value.modules[0].startup.jsHeapBytes = Number.NaN;
    expect(() => deriveFixedCollectionRuntimeBudget(value.modules, value.budgets.limits)).toThrow(/complete finite/);
    value.modules[0].startup.jsHeapBytes = 1_000;
    value.budgets.limits.switchMillisecondsMax = 0;
    expect(() => deriveFixedCollectionRuntimeBudget(value.modules, value.budgets.limits)).toThrow(/positive limits/);
  });

  it.each([
    ["missing heap measurement", (value: any) => { delete value.modules[0].startup.jsHeapBytes; }, /jsHeapBytes/],
    ["reused document identity", (value: any) => {
      value.modules[1].switch.documentIdentity = value.modules[0].startup.documentIdentity;
    }, /documentIdentity must be new/],
    ["reused runtime identity", (value: any) => {
      value.modules[2].startup.runtimeIdentity = value.modules[0].switch.runtimeIdentity;
    }, /runtimeIdentity must be new/],
    ["different logical save key", (value: any) => { value.modules[2].save.logicalKey = "slot-1"; }, /logicalKey must be identical/],
    ["shared save namespace", (value: any) => {
      value.modules[1].save.namespace = value.modules[0].save.namespace;
    }, /namespace must be unique/],
    ["shared save value", (value: any) => {
      value.modules[1].save.writtenValue = value.modules[0].save.writtenValue;
      value.modules[1].save.restoredValue = value.modules[0].save.writtenValue;
    }, /writtenValue must be unique/],
    ["save did not restore", (value: any) => { value.modules[1].save.restoredValue = "different"; }, /restoredValue must equal/],
    ["self switch", (value: any) => { value.modules[1].switch.fromModuleId = "module-b"; }, /different module/],
    ["unknown switch source", (value: any) => { value.modules[1].switch.fromModuleId = "module-z"; }, /measured module/],
  ])("rejects %s", (_name, mutate, message) => {
    const value = structuredClone(report()) as any;
    mutate(value);
    const result = validateFixedCollectionRuntimeValidation(value);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(message);
  });

  it("requires a failed switch to leave no active module, document, or runtime", () => {
    const value = structuredClone(report()) as any;
    value.failedSwitches[0].activeRuntimeIdentityAfterFailure = "runtime-still-active";
    const result = validateFixedCollectionRuntimeValidation(value);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("$.failedSwitches[0].activeRuntimeIdentityAfterFailure must equal null");
    expect(schemaValidate(value)).toBe(false);
  });

  it("rejects fewer than three measured modules and missing failure evidence", () => {
    const tooFew = structuredClone(report()) as any;
    tooFew.modules.pop();
    expect(validateFixedCollectionRuntimeValidation(tooFew).errors.join("\n")).toMatch(/at least three modules/);
    expect(schemaValidate(tooFew)).toBe(false);

    const noFailure = structuredClone(report()) as any;
    noFailure.failedSwitches = [];
    expect(validateFixedCollectionRuntimeValidation(noFailure).errors.join("\n")).toMatch(/at least one failed switch/);
    expect(schemaValidate(noFailure)).toBe(false);
  });

  it("rejects stale observed maxima even when the claimed status is conservative", () => {
    const value = structuredClone(report()) as any;
    value.budgets.observed.maxJsHeapBytes = 1_299;
    value.budgets.passed = false;
    value.status = "failed";
    const result = validateFixedCollectionRuntimeValidation(value);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("$.budgets.observed must be derived from all module measurements");
  });

  it("requires all content identities, browser identity, and named measurement methods", () => {
    const value = structuredClone(report()) as any;
    value.subject.collectionLauncherSha256 = "not-a-hash";
    value.browser.version = "";
    value.measurementMethod.heap = "estimated";
    const result = validateFixedCollectionRuntimeValidation(value);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/collectionLauncherSha256|browser.version|measurementMethod.heap/);
    expect(schemaValidate(value)).toBe(false);
  });
});
