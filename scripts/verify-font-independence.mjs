import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "apps/web/src");
const files = [];
const visit = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(absolute);
    else if (/\.(?:css|ts)$/.test(entry.name)) files.push(absolute);
  }
};
visit(sourceRoot);

const generic = /(?:system-ui|ui-rounded|ui-sans-serif|sans-serif|serif|monospace|Arial|Helvetica|Inter)/;
for (const file of files.sort()) {
  const source = fs.readFileSync(file, "utf8");
  const declarations = [
    ...source.matchAll(/font-family\s*:\s*([^;\n}]+)/g),
    ...source.matchAll(/fontFamily\s*:\s*([^,\n}]+(?:,[^\n}]*)?)/g),
  ];
  for (const match of declarations) {
    const value = match[1] ?? "";
    assert.equal(generic.test(value), false, `${path.relative(root, file)} has an OS/generic font fallback: ${value.trim()}`);
  }
}

const css = fs.readFileSync(path.join(sourceRoot, "style.css"), "utf8");
assert.equal((css.match(/@font-face/g) ?? []).length, 2, "Web shell must declare exactly two bundled font faces");
assert.equal((css.match(/font-display:\s*block/g) ?? []).length, 2, "Bundled faces must block instead of swapping to OS fonts");
console.log(`verified zero OS-font fallback across ${files.length} Web source files`);
