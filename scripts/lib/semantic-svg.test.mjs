import assert from "node:assert/strict";
import test from "node:test";

import {
  compileSemanticSvg,
  semanticVectorManifest,
  semanticVectorModuleSource,
  SEMANTIC_VECTOR_SET_SCHEMA,
} from "./semantic-svg.mjs";

const valid = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"
  data-aico8-schema="aico8.semantic-vector-source.v1" data-aico8-asset-id="test-asset"
  data-aico8-origin="32 32" data-aico8-required-layers="body face">
  <g id="body"><rect id="body-shape" x="4" y="4" width="56" height="56" rx="10" data-aico8-fill-token="segment"/></g>
  <g id="face"><path id="mouth" d="M 20 36 Q 32 44 44 36" fill="none" stroke="#7e2553" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g>
</svg>`;

test("compiles a semantic SVG into renderer-independent commands and hashes", () => {
  const asset = compileSemanticSvg(valid, "test-asset.svg");
  assert.equal(asset.id, "test-asset");
  assert.deepEqual(asset.origin, [32, 32]);
  assert.deepEqual(asset.primitives[0].commands, [{ op: "roundRect", values: [4, 4, 56, 56, 10] }]);
  assert.deepEqual(asset.primitives[1].commands.map(({ op }) => op), ["moveTo", "quadraticCurveTo"]);
  assert.match(asset.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(asset.sourceBytes, Buffer.byteLength(valid));
  assert.match(asset.recipeSha256, /^[a-f0-9]{64}$/);
});

test("compiles explicit cut composites for protected counters", () => {
  const withCut = valid.replace(
    "</g>\n  <g id=\"face\">",
    "<circle id=\"body-counter\" cx=\"32\" cy=\"32\" r=\"8\" data-aico8-composite=\"cut\"/></g>\n  <g id=\"face\">",
  );
  const asset = compileSemanticSvg(withCut, "test-asset.svg");
  assert.equal(asset.primitives[1].composite, "cut");
  assert.equal(asset.primitives[1].fill, undefined);
  assert.equal(asset.primitives[1].stroke, undefined);
});

test("emits a stable manifest and typed generated module", () => {
  const asset = compileSemanticSvg(valid, "test-asset.svg");
  const set = {
    schemaVersion: SEMANTIC_VECTOR_SET_SCHEMA,
    assets: [asset],
    sourceFiles: [{ absolutePath: "/private/test-asset.svg", path: "vector-assets/test-asset.svg" }],
  };
  const manifest = semanticVectorManifest(set);
  assert.equal(manifest.assets[0].sourcePath, "vector-assets/test-asset.svg");
  assert.match(semanticVectorModuleSource(set), /satisfies Readonly<Record<string, SemanticVectorAsset>>/);
});

for (const [label, mutation, expected] of [
  ["scripts", (svg) => svg.replace("<g id=\"body\">", "<script id=\"evil\"/><g id=\"body\">"), /script/],
  ["external images", (svg) => svg.replace("<g id=\"body\">", "<image id=\"remote\" href=\"https:\/\/example.com\/x.png\"/><g id=\"body\">"), /image/],
  ["missing layers", (svg) => svg.replace("body face", "body ears"), /required layer ears/],
  ["duplicate ids", (svg) => svg.replace("id=\"mouth\"", "id=\"body-shape\""), /Duplicate semantic id/],
  ["relative paths", (svg) => svg.replace("M 20 36 Q 32 44 44 36", "m 20 36 q 12 8 24 0"), /absolute M/],
  ["transforms", (svg) => svg.replace("<g id=\"body\">", "<g id=\"body\" transform=\"scale(2)\">"), /attribute transform is not allowed/],
  ["unhashed runtime links", (svg) => svg.replace("fill=\"none\"", "fill=\"url(#paint)\""), /external content/],
  ["document types", (svg) => `<!DOCTYPE svg [<!ENTITY x \"expanded\">]>${svg}`, /document types or entity declarations/],
  ["text content", (svg) => svg.replace("<g id=\"body\">", "<g id=\"body\">hidden"), /cannot contain text content/],
  ["empty required layers", (svg) => svg.replace(/<rect id=\"body-shape\"[^>]+\/>/, ""), /required layer body has no drawable primitives/],
]) {
  test(`rejects ${label}`, () => assert.throws(() => compileSemanticSvg(mutation(valid), "test-asset.svg"), expected));
}
