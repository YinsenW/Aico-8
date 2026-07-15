import fs from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  QUALITY_LEAP_AUDIT_SCHEMA_VERSION,
  assertQualityLeapAudit,
  validateQualityLeapAudit,
} from "./quality-leap-audit.js";

const schema = JSON.parse(fs.readFileSync(
  new URL("../../../specs/schemas/quality-leap-audit-v1.schema.json", import.meta.url),
  "utf8",
));
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

function acceptedAudit(): any {
  return {
    schemaVersion: QUALITY_LEAP_AUDIT_SCHEMA_VERSION,
    gameId: "synthetic-orbit",
    canonicalReplaySha256: "a".repeat(64),
    presentationAuditSha256: "b".repeat(64),
    status: "accepted",
    scenes: [{ id: "scene.gameplay", observedContentRouteIds: ["gameplay-content"] }],
    routes: [{
      id: "gameplay-content",
      role: "content",
      sceneIds: ["scene.gameplay"],
      geometrySource: "semantic-command-reconstruction",
      samplingSource: "semantic-command",
      contourTreatment: "authored-continuous",
      targetPixelsPerSourcePixel: 8,
      edgeSupersampleFactor: 2,
      qualityDimensions: ["continuous-contour", "material-layers", "internal-detail"],
      materialLayerCount: 3,
      authoredDetailCount: 2,
      motionOrEffectTrackCount: 0,
    }, {
      id: "player-shell",
      role: "shell",
      sceneIds: ["scene.gameplay"],
      geometrySource: "authored-procedural",
      samplingSource: "element-resource",
      contourTreatment: "authored-continuous",
      targetPixelsPerSourcePixel: 8,
      edgeSupersampleFactor: 2,
      qualityDimensions: ["continuous-contour"],
      materialLayerCount: 0,
      authoredDetailCount: 0,
      motionOrEffectTrackCount: 0,
    }],
    regressions: [{ id: "reject-shell-only", category: "shell-only-mutation", rejected: true }, {
      id: "reject-framebuffer-topology", category: "final-framebuffer-topology-mutation", rejected: true,
    }, { id: "reject-cosmetic-smoothing", category: "cosmetic-smoothing-only-mutation", rejected: true }],
  };
}

describe("quality leap audit", () => {
  it("executes the public schema and accepts complete authored content coverage", () => {
    const value = acceptedAudit();
    expect(validateSchema(value), JSON.stringify(validateSchema.errors)).toBe(true);
    expect(validateQualityLeapAudit(value)).toEqual({ ok: true, errors: [] });
    expect(() => assertQualityLeapAudit(value)).not.toThrow();
  });

  it("rejects shell-only polish even when the shell itself is smooth", () => {
    const value = acceptedAudit();
    value.scenes[0].observedContentRouteIds = ["player-shell"];
    expect(validateSchema(value), JSON.stringify(validateSchema.errors)).toBe(true);
    const errors = validateQualityLeapAudit(value).errors.join("\n");
    expect(errors).toMatch(/must not count shell route/);
    expect(errors).toMatch(/content route gameplay-content is not observed/);
  });

  it("rejects final-framebuffer per-pixel topology even with 8x scale and antialiasing", () => {
    const value = acceptedAudit();
    Object.assign(value.routes[0], {
      geometrySource: "final-framebuffer-projection",
      samplingSource: "final-framebuffer",
      contourTreatment: "source-cell-topology",
      targetPixelsPerSourcePixel: 8,
      edgeSupersampleFactor: 4,
    });
    expect(validateSchema(value), JSON.stringify(validateSchema.errors)).toBe(true);
    const errors = validateQualityLeapAudit(value).errors.join("\n");
    expect(errors).toMatch(/must not derive from the final framebuffer/);
    expect(errors).toMatch(/must not preserve per-pixel source-cell topology/);
  });

  it("rejects minor contour rounding without a measurable content enrichment", () => {
    const value = acceptedAudit();
    Object.assign(value.routes[0], {
      qualityDimensions: ["continuous-contour"],
      materialLayerCount: 0,
      authoredDetailCount: 0,
      motionOrEffectTrackCount: 0,
    });
    expect(validateSchema(value), JSON.stringify(validateSchema.errors)).toBe(true);
    expect(validateQualityLeapAudit(value).errors.join("\n"))
      .toMatch(/cosmetic smoothing only/);
  });

  it("keeps incomplete quality evidence draft-only and requires all three rejected mutations", () => {
    const draft = acceptedAudit();
    draft.status = "draft";
    draft.scenes[0].observedContentRouteIds = [];
    draft.regressions = [];
    expect(validateSchema(draft), JSON.stringify(validateSchema.errors)).toBe(true);
    expect(validateQualityLeapAudit(draft)).toEqual({ ok: true, errors: [] });

    const accepted = acceptedAudit();
    accepted.regressions.pop();
    expect(validateSchema(accepted)).toBe(false);
    expect(validateQualityLeapAudit(accepted).errors.join("\n"))
      .toMatch(/must include rejected cosmetic-smoothing-only-mutation/);
  });

  it("reports malformed accepted routes without throwing from cross-field checks", () => {
    const value = acceptedAudit();
    delete value.routes[0].qualityDimensions;
    delete value.routes[0].sceneIds;
    expect(() => validateQualityLeapAudit(value)).not.toThrow();
    expect(validateQualityLeapAudit(value).ok).toBe(false);
  });
});
