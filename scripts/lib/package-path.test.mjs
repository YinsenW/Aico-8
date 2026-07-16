import assert from "node:assert/strict";
import test from "node:test";

import { assertSafePackageRelativePath, resolvePackageFile } from "./package-path.mjs";

test("accepts ordinary nested package paths and resolves them below the package root", () => {
  assert.equal(assertSafePackageRelativePath("private/game/source.rom"), "private/game/source.rom");
  assert.equal(resolvePackageFile("/tmp/build", "assets/index-A1_b.css"), "/tmp/build/assets/index-A1_b.css");
});

test("rejects absolute, cross-origin, traversal, encoded, and ambiguous paths", () => {
  for (const candidate of [
    "/kernel/aico8.wasm", "//cdn.invalid/a.js", "https://cdn.invalid/a.js", "../escape.js",
    "assets/../escape.js", "assets/%2e%2e/escape.js", "assets\\escape.js", "assets/a.js?x=1",
    "assets//a.js", "./assets/a.js",
  ]) {
    assert.throws(() => assertSafePackageRelativePath(candidate), /must|unsafe|relative/);
  }
});
