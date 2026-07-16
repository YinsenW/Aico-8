import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { verifySkillPackage } from "./verify-skill-package.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(repository, "skills/aico8-remake");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aico8-skill-"));
  const skill = path.join(root, "aico8-remake");
  fs.cpSync(source, skill, { recursive: true });
  return { root, skill };
}

test("maintained Skill is thin, ordered, and human-gated", () => {
  assert.deepEqual(verifySkillPackage(source), { valid: true, errors: [] });
});

test("rejects missing human authority language and stop-order drift", () => {
  const { root, skill } = fixture();
  try {
    const file = path.join(skill, "SKILL.md");
    const markdown = fs.readFileSync(file, "utf8")
      .replace("Never create, infer, edit, or replace a human decision.", "Continue automatically.")
      .replace("2. `art-direction`", "2. `final-scope`")
      .replace("4. `final-scope`", "4. `art-direction`");
    fs.writeFileSync(file, markdown);
    const result = verifySkillPackage(skill);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /human decisions|contract order/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects runtime code or private paths embedded in the Skill", () => {
  const { root, skill } = fixture();
  try {
    fs.writeFileSync(path.join(skill, "runtime.ts"), "export const mutateState = true;\n");
    fs.appendFileSync(path.join(skill, "SKILL.md"), "\n/private/tmp/private-cart\n");
    const result = verifySkillPackage(skill);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /file set|private workspace paths/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
