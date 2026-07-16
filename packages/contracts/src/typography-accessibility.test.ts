import { describe, expect, it } from "vitest";

import {
  REQUIRED_ACCESSIBILITY_REGRESSIONS,
  TYPOGRAPHY_ACCESSIBILITY_AUDIT_SCHEMA_VERSION,
  requiredTextContrast,
  sourceDerivedAccessibleDescription,
  typographyContrastRatio,
  validateTypographyAccessibilityAudit,
} from "./typography-accessibility.js";

const hash = "a".repeat(64);

function audit(): any {
  const sample = (id: string, role: string, size: number, minimum: number) => ({
    id, role, fontSizeCssPx: size, minimumCssPx: minimum,
    measuredWidthCssPx: size * 4, availableWidthCssPx: size * 5,
    measuredLineHeightCssPx: size * 1.2, availableHeightCssPx: size * 1.5,
    foreground: "#ffffff", background: "#002b4f",
    contrastRatio: Number(typographyContrastRatio("#ffffff", "#002b4f").toFixed(3)),
    requiredContrastRatio: requiredTextContrast(size, role === "display" ? 700 : 400),
    fits: true, overflowed: false,
  });
  return {
    schemaVersion: TYPOGRAPHY_ACCESSIBILITY_AUDIT_SCHEMA_VERSION,
    status: "accepted",
    gameId: "dust-bunny",
    sourceSha256: hash,
    typographyManifestSha256: hash,
    textInventorySha256: hash,
    languageCoverage: [{ locale: "en-US", script: "Latn", status: "complete", missingCodePoints: [] }],
    unsupportedScripts: [
      { script: "Hans", reason: "no-bundled-font-coverage" },
      { script: "Hant", reason: "no-bundled-font-coverage" },
      { script: "Jpan", reason: "no-bundled-font-coverage" },
      { script: "Hang", reason: "no-bundled-font-coverage" },
    ],
    deliveryProfiles: [
      { id: "square-handheld-1024x1024", viewport: { width: 1024, height: 1024 }, samples: [sample("square-menu", "menu", 32, 16)] },
      { id: "android-handheld-landscape-1280x720", viewport: { width: 1280, height: 720 }, samples: [sample("landscape-menu", "menu", 22.5, 16)] },
      { id: "phone-portrait-390x844", viewport: { width: 390, height: 844 }, samples: [sample("phone-menu", "menu", 16, 16)] },
    ],
    assistiveText: {
      descriptionsObserved: 3,
      sceneIds: ["scene.title", "scene.gameplay", "scene.ending"],
      missingSceneIds: [], unprovenDescriptionIds: [], compatibilityStateMutations: 0,
    },
    manualReadability: { status: "approved", reviewer: "human-reviewer", decisionSha256: hash },
    regressions: REQUIRED_ACCESSIBILITY_REGRESSIONS.map((category) => ({ category, rejected: true })),
  };
}

describe("typography accessibility contract", () => {
  it("computes WCAG contrast and large-text thresholds deterministically", () => {
    expect(typographyContrastRatio("#000000", "#ffffff")).toBe(21);
    expect(requiredTextContrast(16, 400)).toBe(4.5);
    expect(requiredTextContrast(24, 400)).toBe(3);
    expect(requiredTextContrast(18.66, 700)).toBe(3);
  });

  it("binds assistive copy to explicit source evidence", () => {
    expect(sourceDerivedAccessibleDescription({
      sceneId: "scene.gameplay", text: "Level 2. 20 dust remaining.", sourceEvidenceIds: ["state.level", "state.dust"],
    }).provenance).toBe("state-derived-accessibility");
    expect(() => sourceDerivedAccessibleDescription({
      sceneId: "scene.gameplay", text: "Level 2", sourceEvidenceIds: [],
    })).toThrow(/source evidence/);
  });

  it("accepts complete English/Latin coverage while honestly recording unsupported scripts", () => {
    expect(validateTypographyAccessibilityAudit(audit())).toEqual({ valid: true, errors: [] });
  });

  it("rejects size, contrast, locale, assistive, state-drift, and manual-review gaps", () => {
    const value = audit();
    value.deliveryProfiles[2].samples[0].fontSizeCssPx = 11;
    value.deliveryProfiles[1].samples[0].foreground = "#55708a";
    value.deliveryProfiles[1].samples[0].contrastRatio = Number(typographyContrastRatio("#55708a", "#002b4f").toFixed(3));
    value.languageCoverage[0].missingCodePoints = [233];
    value.assistiveText.unprovenDescriptionIds = ["scene.secret"];
    value.assistiveText.compatibilityStateMutations = 1;
    value.manualReadability = { status: "pending" };
    const errors = validateTypographyAccessibilityAudit(value).errors.join("\n");
    expect(errors).toMatch(/CSS-pixel floor/);
    expect(errors).toMatch(/does not meet contrast/);
    expect(errors).toMatch(/missing code points/);
    expect(errors).toMatch(/state-neutral/);
    expect(errors).toMatch(/approved before acceptance/);
  });

  it("rejects a claimed fit that is not supported by measured bounds", () => {
    const value = audit();
    value.deliveryProfiles[2].samples[0].measuredWidthCssPx = 81;
    value.deliveryProfiles[2].samples[0].availableWidthCssPx = 80;
    expect(validateTypographyAccessibilityAudit(value).errors.join("\n"))
      .toMatch(/fits must be derived|does not fit/);
  });
});
