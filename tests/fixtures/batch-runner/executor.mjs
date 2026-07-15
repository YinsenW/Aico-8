import fs from "node:fs/promises";
import path from "node:path";

let serialized = "";
for await (const chunk of process.stdin) serialized += chunk;
const context = JSON.parse(serialized);
const forbiddenEnvironment = [
  "AICO8_SENTINEL_SECRET",
  "AICO8_SENTINEL_TOKEN",
  "AICO8_SENTINEL_KEY",
  "HOME",
  "NODE_OPTIONS",
];
const leaked = forbiddenEnvironment.filter((key) => Object.hasOwn(process.env, key));
if (leaked.length > 0) throw new Error(`undeclared executor environment leaked: ${leaked.join(",")}`);
await fs.writeFile(
  path.join(context.workspaceDirectory, "executor-environment.json"),
  `${JSON.stringify({
    visibleKeys: Object.keys(process.env).sort(),
    forbiddenVisible: leaked,
    pathAvailable: typeof process.env.PATH === "string" || typeof process.env.Path === "string",
  }, null, 2)}\n`,
);
if (await fs.realpath(process.cwd()) !== await fs.realpath(context.workspaceDirectory)) {
  throw new Error("executor cwd is not the isolated workspace");
}
if (process.argv.slice(2).join("|") !== "--literal|value with spaces;not-a-shell-command") {
  throw new Error("executor argv changed before direct spawn");
}
await fs.writeFile(
  path.join(context.workspaceDirectory, `executor-attempt-${context.attempt}.json`),
  `${JSON.stringify(context, null, 2)}\n`,
);

if (context.gameId === "game-retry" && context.attempt === 1) {
  process.stderr.write("synthetic lane-local executor failure\n");
  process.exitCode = 7;
} else if (context.gameId === "game-blocked") {
  process.stdout.write(JSON.stringify({
    outcome: "blocked",
    stage: "compatibility",
    failureClass: "synthetic-unsupported-api",
    evidence: {},
  }));
} else {
  process.stdout.write(JSON.stringify({
    outcome: "accepted",
    stage: "accepted",
    moduleId: `module-${context.gameId}`,
    evidence: {
      canonicalReplaySha256: "a".repeat(64),
      hdReviewDecisionSha256: "b".repeat(64),
      webPackageSha256: "c".repeat(64),
    },
  }));
}
