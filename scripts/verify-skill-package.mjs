#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_FILES = [
  "agents/openai.yaml",
  "references/job-catalog.md",
  "SKILL.md",
];
const STOP_IDS = [
  "semantic-intent",
  "art-direction",
  "representative-gameplay",
  "final-scope",
];
const REQUIRED_JOB_IDS = [
  "JOB-SUPERVISED-TRANSFER-001",
  "JOB-CAPTURE-001",
  "JOB-PACKAGE-001",
];

function files(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const relative = path.posix.join(prefix, entry.name);
      if (entry.isSymbolicLink()) return [`${relative}:symlink`];
      return entry.isDirectory() ? files(path.join(directory, entry.name), relative) : [relative];
    });
}

function frontmatter(markdown, errors) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  if (!match) {
    errors.push("SKILL.md must start with YAML frontmatter");
    return new Map();
  }
  const entries = new Map();
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 1) {
      errors.push(`Unsupported SKILL.md frontmatter line: ${line}`);
      continue;
    }
    entries.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  if (JSON.stringify([...entries.keys()].sort()) !== JSON.stringify(["description", "name"])) {
    errors.push("SKILL.md frontmatter must contain only name and description");
  }
  return entries;
}

export function verifySkillPackage(skillDirectory) {
  const root = path.resolve(skillDirectory);
  const errors = [];
  if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    return { valid: false, errors: [`Missing Skill directory: ${root}`] };
  }
  const actualFiles = files(root);
  if (JSON.stringify(actualFiles) !== JSON.stringify(REQUIRED_FILES)) {
    errors.push(`Skill file set must equal ${REQUIRED_FILES.join(", ")}; observed ${actualFiles.join(", ")}`);
  }
  for (const relative of REQUIRED_FILES) {
    if (!fs.statSync(path.join(root, relative), { throwIfNoEntry: false })?.isFile()) {
      errors.push(`Missing required Skill file: ${relative}`);
    }
  }
  if (errors.some((error) => error.startsWith("Missing required"))) return { valid: false, errors };

  const markdown = fs.readFileSync(path.join(root, "SKILL.md"), "utf8");
  const metadata = frontmatter(markdown, errors);
  if (metadata.get("name") !== "aico8-remake") errors.push("Skill name must equal aico8-remake");
  const description = metadata.get("description") ?? "";
  if (!description.includes("PICO-8") || !description.includes("human-reviewed") || !description.includes("Web")) {
    errors.push("Skill description must name PICO-8, human review, and Web triggering context");
  }
  if (markdown.split("\n").length > 220) errors.push("SKILL.md exceeds the 220-line context budget");
  if (!markdown.includes("references/job-catalog.md")) errors.push("SKILL.md must route detailed commands to the Job catalog");
  if (!markdown.includes("Never ask the user to run a command") || !markdown.includes("private intake command")) {
    errors.push("Skill must preserve the non-technical attachment entry");
  }
  if (!markdown.includes("Never create, infer, edit, or replace a human decision.")) {
    errors.push("Skill must forbid Agent-created or inferred human decisions");
  }
  if (!markdown.includes("Never self-accept or self-release.")) {
    errors.push("Skill must forbid self-acceptance and self-release");
  }
  const stopPositions = STOP_IDS.map((id) => markdown.indexOf(`\`${id}\``));
  if (stopPositions.some((position) => position < 0)
    || stopPositions.some((position, index) => index > 0 && position <= stopPositions[index - 1])) {
    errors.push("Skill must list all four human stops once in contract order");
  }
  if (!markdown.includes("retain-supervised-trial") || !markdown.includes("authorize-full-validation")) {
    errors.push("Skill must distinguish retained trial from full-validation authorization");
  }
  if (!markdown.includes("1024×1024") || !markdown.includes("service-worker cache isolation")) {
    errors.push("Skill must preserve square-layout and scoped Web package requirements");
  }
  if (/\/Users\/|\/private\/tmp|pico8_carts|workspaces\/202_steps/.test(markdown)) {
    errors.push("Skill must not embed machine-specific or private workspace paths");
  }

  const catalog = fs.readFileSync(path.join(root, "references/job-catalog.md"), "utf8");
  for (const id of REQUIRED_JOB_IDS) if (!catalog.includes(id)) errors.push(`Job catalog must include ${id}`);
  for (const command of [
    "pnpm verify:governance",
    "pnpm verify:supervised-transfer",
    "pnpm verify:web-package",
    "pnpm verify:skill",
    "scripts/bootstrap.mjs",
    "aico8-agent.mjs doctor",
    "aico8-agent.mjs intake",
    "aico8-agent.mjs handoff",
  ]) if (!catalog.includes(command)) errors.push(`Job catalog must include ${command}`);
  if (!catalog.includes("cannot approve") || !catalog.includes("signs outside the Agent")) {
    errors.push("Job catalog must preserve the human authority boundary");
  }

  const interfaceYaml = fs.readFileSync(path.join(root, "agents/openai.yaml"), "utf8");
  if (!interfaceYaml.includes('display_name: "Aico 8 Remake"')) errors.push("openai.yaml display name is stale");
  if (!interfaceYaml.includes("$aico8-remake")) errors.push("openai.yaml default prompt must mention $aico8-remake");
  if (/icon_|brand_color|dependencies:/.test(interfaceYaml)) {
    errors.push("openai.yaml must not declare unprovided assets or dependencies");
  }

  return { valid: errors.length === 0, errors };
}

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const skill = process.argv[2] ? path.resolve(process.argv[2]) : path.join(repository, "plugins/aico8/skills/aico8-remake");
  const result = verifySkillPackage(skill);
  if (!result.valid) {
    process.stderr.write(`${result.errors.join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`Aico 8 Skill package: PASS (${REQUIRED_FILES.length} maintained files)\n`);
  }
}
