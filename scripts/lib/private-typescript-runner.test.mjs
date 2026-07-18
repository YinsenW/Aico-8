import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runPrivateTypeScript } from "./private-typescript-runner.mjs";

test("private TypeScript runner resolves emitted .js specifiers to sibling .ts sources", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "aico8-private-ts-"));
  try {
    fs.writeFileSync(path.join(workspace, "dependency.ts"), "export const answer: number = 42;\n");
    fs.writeFileSync(path.join(workspace, "entry.ts"), [
      "import { answer } from './dependency.js';",
      "process.stdout.write(String(answer));",
      "",
    ].join("\n"));

    const result = runPrivateTypeScript({
      script: path.join(workspace, "entry.ts"),
      cwd: workspace,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "42");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
