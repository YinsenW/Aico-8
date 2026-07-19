#!/usr/bin/env node
import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "plugins", "aico8", "skills", "aico8-remake");
const required = [
  "SKILL.md",
  "agents/openai.yaml",
  "engine.json",
  "references/job-catalog.md",
  "scripts/bootstrap.mjs",
];

function parse(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--check") options.check = true;
    else if (argv[index] === "--out") options.out = argv[++index];
    else throw new Error(`unexpected argument: ${argv[index]}`);
  }
  return options;
}

function command(name, args, cwd) {
  const result = spawnSync(name, args, { cwd, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`${name} failed: ${(result.stderr || result.stdout || result.error?.message || "unknown error").trim()}`);
  }
  return result.stdout.trim();
}

async function verify(directory) {
  const errors = [];
  for (const relative of required) {
    try {
      if (!(await stat(path.join(directory, relative))).isFile()) errors.push(`not a file: ${relative}`);
    } catch {
      errors.push(`missing: ${relative}`);
    }
  }
  const engine = JSON.parse(await readFile(path.join(directory, "engine.json"), "utf8"));
  if (!/^\d+\.\d+\.\d+$/.test(engine.version ?? "")) errors.push("portable Skill version must be semver");
  if (engine.ref !== `v${engine.version}`) errors.push("portable Skill engine ref must equal its version tag");
  const skill = await readFile(path.join(directory, "SKILL.md"), "utf8");
  if (!skill.includes("coding Agent") || skill.includes("Use when Codex")) errors.push("Skill trigger must be host-neutral");
  if (errors.length > 0) throw new Error(errors.join("\n"));
  return engine;
}

async function main() {
  const options = parse(process.argv.slice(2));
  const temporary = options.check || !options.out;
  const output = temporary
    ? path.join(tmpdir(), `aico8-skill-check-${process.pid}-${randomBytes(4).toString("hex")}`)
    : path.resolve(options.out);
  const directory = path.join(output, "aico8-remake");
  const archive = path.join(output, "aico8-remake.zip");
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  try {
    await cp(source, directory, { recursive: true, errorOnExist: true });
    const engine = await verify(directory);
    command("zip", ["-q", "-r", archive, "aico8-remake"], output);
    const entries = command("unzip", ["-Z1", archive], output).split("\n");
    for (const relative of required) {
      if (!entries.includes(`aico8-remake/${relative}`)) throw new Error(`archive missing: ${relative}`);
    }
    process.stdout.write(`${JSON.stringify({ status: "passed", version: engine.version, directory, archive }, null, 2)}\n`);
  } finally {
    if (temporary) await rm(output, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
