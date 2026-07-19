#!/usr/bin/env node
import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "plugins", "aico8");

function parse(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--check") options.check = true;
    else if (argv[index] === "--out") options.out = argv[++index];
    else throw new Error(`unexpected argument: ${argv[index]}`);
  }
  return options;
}

async function verifyPlugin(directory) {
  const manifest = JSON.parse(await readFile(path.join(directory, ".codex-plugin", "plugin.json"), "utf8"));
  const errors = [];
  if (path.basename(directory) !== manifest.name) errors.push("package folder must match plugin name");
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version ?? "")) errors.push("plugin version must be semver");
  if (manifest.skills !== "./skills/") errors.push("plugin must expose ./skills/");
  for (const required of ["engine.json", ".codex-plugin/plugin.json", "skills/aico8-remake/SKILL.md", "skills/aico8-remake/agents/openai.yaml", "skills/aico8-remake/engine.json", "skills/aico8-remake/references/job-catalog.md", "skills/aico8-remake/scripts/bootstrap.mjs", "scripts/bootstrap.mjs"]) {
    try {
      if (!(await stat(path.join(directory, required))).isFile()) errors.push(`required file is not regular: ${required}`);
    } catch {
      errors.push(`required file is missing: ${required}`);
    }
  }
  for (const forbidden of [".git", "node_modules", "workspaces", "private", "pico8_carts", "captures"]) {
    try {
      await stat(path.join(directory, forbidden));
      errors.push(`private or generated path escaped into plugin: ${forbidden}`);
    } catch {}
  }
  const engine = JSON.parse(await readFile(path.join(directory, "engine.json"), "utf8"));
  if (engine.repository !== "https://github.com/YinsenW/Aico-8.git") errors.push("engine repository is not the public Aico 8 source");
  const portableEngine = JSON.parse(await readFile(path.join(directory, "skills", "aico8-remake", "engine.json"), "utf8"));
  if (engine.ref !== portableEngine.ref || manifest.version !== portableEngine.version) errors.push("Codex wrapper and portable Skill versions differ");
  if (errors.length > 0) throw new Error(errors.join("\n"));
  return manifest;
}

async function main() {
  const options = parse(process.argv.slice(2));
  const temporary = options.check || !options.out;
  const parent = temporary
    ? path.join(tmpdir(), `aico8-plugin-check-${process.pid}-${randomBytes(4).toString("hex")}`)
    : path.resolve(options.out);
  const destination = path.basename(parent) === "aico8" ? parent : path.join(parent, "aico8");
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await cp(source, destination, { recursive: true, errorOnExist: true });
    const manifest = await verifyPlugin(destination);
    process.stdout.write(`${JSON.stringify({ status: "passed", plugin: destination, name: manifest.name, version: manifest.version }, null, 2)}\n`);
  } finally {
    if (temporary) await rm(parent, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
