import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

const tsxLoaderUrl = import.meta.resolve("tsx");

/**
 * Runs an ignored-workspace TypeScript entry through the repository-pinned tsx
 * loader. Native type stripping cannot remap TypeScript's emitted `.js`
 * specifiers back to sibling `.ts` sources, so it is not a valid project runner.
 */
export function runPrivateTypeScript({ script, cwd, env = process.env }) {
  assert.equal(typeof script, "string", "private TypeScript script must be a path");
  assert.equal(typeof cwd, "string", "private TypeScript cwd must be a path");
  const resolvedScript = path.resolve(script);
  const resolvedCwd = path.resolve(cwd);
  return spawnSync(process.execPath, ["--import", tsxLoaderUrl, resolvedScript], {
    cwd: resolvedCwd,
    env,
    encoding: "utf8",
    stdio: "pipe",
  });
}
