#!/usr/bin/env node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parse(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--skip-dependencies" || item === "--force") options[item.slice(2)] = true;
    else if (item === "--source" || item === "--engine-root") options[item.slice(2)] = argv[++index];
    else throw new Error(`unexpected argument: ${item}`);
  }
  return options;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${(result.stderr || result.stdout || result.error?.message || "unknown error").trim()}`);
  }
  return result.stdout.trim();
}

async function main() {
  const options = parse(process.argv.slice(2));
  const engine = JSON.parse(await readFile(path.join(skillRoot, "engine.json"), "utf8"));
  const destination = path.resolve(options["engine-root"] ?? path.join(homedir(), ".aico8", "engines", engine.version));
  let source = options.source ? path.resolve(options.source) : undefined;
  let temporary;
  try {
    if (!source) {
      temporary = await mkdtemp(path.join(tmpdir(), "aico8-engine-source-"));
      run("git", ["clone", "--depth", "1", "--branch", engine.ref, engine.repository, temporary], skillRoot);
      source = temporary;
    }
    const cli = path.join(source, "scripts", "agent", "aico8-agent.mjs");
    const args = [cli, "bootstrap", "--engine-root", destination];
    if (options["skip-dependencies"]) args.push("--skip-dependencies");
    if (options.force) args.push("--force");
    const result = JSON.parse(run(process.execPath, args, source));
    process.stdout.write(`${JSON.stringify({ ...result, skillVersion: engine.version, engineRef: engine.ref }, null, 2)}\n`);
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
