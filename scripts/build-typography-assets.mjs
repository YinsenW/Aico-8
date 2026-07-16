import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as fontkit from "fontkit";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");
const revision = "1cb311624b2ddf88e9e37873999d165a8cd28b46";
const coverageCodePoints = Array.from({ length: 95 }, (_, index) => index + 0x20);
const provenancePath = "fonts/AtkinsonHyperlegible-PROVENANCE.txt";
const licensePath = "fonts/OFL-Atkinson-Hyperlegible.txt";

const inputs = [
  {
    id: "atkinson-regular",
    family: "Aico Sans",
    filename: "AtkinsonHyperlegible-Regular.woff2",
    expectedSha256: "2df4ba17804bc7a36f123127966075d8427bff2df58d0d76820c1130bb1a4150",
    weight: 400,
  },
  {
    id: "atkinson-bold",
    family: "Aico Sans",
    filename: "AtkinsonHyperlegible-Bold.woff2",
    expectedSha256: "da8fce41a04f8498fbf79076f92d304b12e70c76f71b143c5dcfb6536c93c075",
    weight: 700,
  },
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function finiteMetric(value) {
  return Number.isFinite(value) ? value : 0;
}

function output(relativePath, contents) {
  const destination = path.join(root, "apps/web/public", relativePath);
  if (checkOnly) {
    assert.equal(fs.readFileSync(destination, "utf8"), contents, `${relativePath} is stale; run pnpm build:typography-assets`);
    return;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents);
}

const provenanceBytes = fs.readFileSync(path.join(root, "apps/web/public", provenancePath));
const licenseBytes = fs.readFileSync(path.join(root, "apps/web/public", licensePath));
const assets = [];

for (const input of inputs) {
  const relativeFontPath = `fonts/${input.filename}`;
  const fontPath = path.join(root, "apps/web/public", relativeFontPath);
  const fontBytes = fs.readFileSync(fontPath);
  assert.equal(sha256(fontBytes), input.expectedSha256, `${input.id} font bytes changed`);
  const font = fontkit.openSync(fontPath);
  assert.equal(font.unitsPerEm, 1000, `${input.id} unexpected units-per-em`);
  for (const codePoint of coverageCodePoints) {
    assert.ok(font.hasGlyphForCodePoint(codePoint), `${input.id} lacks U+${codePoint.toString(16).toUpperCase()}`);
  }
  const metrics = {
    schemaVersion: "aico8.glyph-metrics.v1",
    fontAssetId: input.id,
    fontSha256: input.expectedSha256,
    unitsPerEm: font.unitsPerEm,
    ascent: font.ascent,
    descent: font.descent,
    lineGap: font.lineGap,
    coverageCodePoints,
    glyphs: coverageCodePoints.map((codePoint) => {
      const glyph = font.glyphForCodePoint(codePoint);
      return {
        codePoint,
        glyphId: glyph.id,
        advanceWidth: glyph.advanceWidth,
        bbox: {
          minX: finiteMetric(glyph.bbox.minX),
          minY: finiteMetric(glyph.bbox.minY),
          maxX: finiteMetric(glyph.bbox.maxX),
          maxY: finiteMetric(glyph.bbox.maxY),
        },
      };
    }),
  };
  const metricsContents = canonicalJson(metrics);
  const metricsPath = `fonts/${input.filename.replace(/\.woff2$/, ".metrics.json")}`;
  output(metricsPath, metricsContents);
  assets.push({
    id: input.id,
    family: input.family,
    version: revision,
    face: { weight: input.weight, style: "normal" },
    file: { path: relativeFontPath, sha256: input.expectedSha256, format: "woff2" },
    metrics: {
      path: metricsPath,
      sha256: sha256(metricsContents),
      schemaVersion: "aico8.glyph-metrics.v1",
    },
    source: {
      upstreamRevision: revision,
      provenancePath,
      provenanceSha256: sha256(provenanceBytes),
    },
    license: {
      spdx: "OFL-1.1",
      evidencePath: licensePath,
      evidenceSha256: sha256(licenseBytes),
    },
    coverageCodePoints,
  });
}

const role = (name, fontAssetIds, sizePx, weight, trackingPx, lineHeightPx, minSizePx, overflow, maxLines) => ({
  role: name,
  renderer: "woff2-canvas",
  fontAssetIds,
  requiredCodePoints: coverageCodePoints,
  metrics: { sizePx, weight, trackingPx, lineHeightPx },
  fit: { minSizePx, overflow, maxLines },
  osFallback: false,
});

const manifest = {
  schemaVersion: "aico8.typography-manifest.v1",
  manifestId: "aico8-latin-ui-v1",
  osFallback: false,
  assets,
  roles: [
    role("display", ["atkinson-bold"], 72, 700, 1.5, 88, 36, "fail", 2),
    role("menu", ["atkinson-regular", "atkinson-bold"], 32, 400, 0.5, 40, 24, "fail", 1),
    role("dialogue", ["atkinson-regular"], 28, 400, 0, 38, 22, "wrap", 4),
    role("hud-number", ["atkinson-bold"], 28, 700, 0, 34, 24, "fail", 1),
    role("localized-body", ["atkinson-regular"], 26, 400, 0, 36, 20, "wrap", 6),
  ],
};

output("typography/latin-ui-v1.json", canonicalJson(manifest));
console.log(`${checkOnly ? "verified" : "built"} deterministic typography assets (${coverageCodePoints.length} glyphs x ${inputs.length} faces)`);
