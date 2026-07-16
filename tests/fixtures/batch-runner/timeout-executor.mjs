import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

let serialized = "";
for await (const chunk of process.stdin) serialized += chunk;
const context = JSON.parse(serialized);
if (context.attemptTimeoutMs !== 100) throw new Error("declared attempt timeout was not forwarded to the executor");
if (process.platform !== "win32" && context.processIsolation !== "posix-process-group") {
  throw new Error("POSIX executor did not declare process-group isolation");
}
if (process.platform === "win32" && context.processIsolation !== "direct-child-windows") {
  throw new Error("Windows executor did not declare its direct-child boundary");
}

if (context.gameId === "game-retry") {
  fs.writeFileSync(path.join(context.workspaceDirectory, `timeout-start-${context.attempt}`), "started\n");
  process.on("SIGTERM", () => {
    fs.writeFileSync(path.join(context.workspaceDirectory, `sigterm-${context.attempt}`), "received\n");
  });
  if (context.processIsolation === "posix-process-group") {
    const lateWrite = path.join(context.workspaceDirectory, `grandchild-late-write-${context.attempt}`);
    const grandchildProgram = [
      "const fs = require('node:fs')",
      "process.on('SIGTERM', () => {})",
      `setTimeout(() => fs.writeFileSync(${JSON.stringify(lateWrite)}, 'escaped\\n'), 500)`,
      "setInterval(() => undefined, 1000)",
    ].join(";");
    spawn(process.execPath, ["-e", grandchildProgram], { stdio: "ignore" });
  }
  setInterval(() => undefined, 1000);
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
