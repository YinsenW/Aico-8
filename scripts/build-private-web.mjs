import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArguments(values) {
  const result = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Expected --name value pairs, received ${key ?? "end of input"}`);
    }
    result.set(key.slice(2), value);
  }
  return result;
}

function required(argumentsMap, name) {
  const value = argumentsMap.get(name);
  if (!value) throw new Error(`Missing required --${name}`);
  return value;
}

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function listFiles(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const relative = path.join(prefix, entry.name);
      return entry.isDirectory() ? listFiles(path.join(directory, entry.name), relative) : [relative];
    });
}

const argumentsMap = parseArguments(process.argv.slice(2));
const workspace = path.resolve(required(argumentsMap, "workspace"));
const output = path.resolve(required(argumentsMap, "out"));
const id = required(argumentsMap, "id");
const title = required(argumentsMap, "title");
const author = required(argumentsMap, "author");
const presentation = argumentsMap.get("presentation") ?? "reference";
const persistenceKey = argumentsMap.get("persistence-key") ?? `aico8.private.${id}.progress.v1`;
const sourceLicense = required(argumentsMap, "source-license");
const sourceUrl = required(argumentsMap, "source-url");
const privateSourceRoot = path.join(root, "apps/web/src/private");
const privateRoot = path.join(root, "apps/web/public/private");

// These are disposable build stages, never canonical private inputs. Cleaning on
// every exit prevents a later public build from accidentally copying stale data.
process.on("exit", () => {
  fs.rmSync(privateSourceRoot, { recursive: true, force: true });
  fs.rmSync(privateRoot, { recursive: true, force: true });
});

if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error("--id must use lowercase letters, digits, and hyphens");
if (!/^[a-z0-9][a-z0-9-]*$/.test(presentation)) throw new Error("--presentation must use lowercase letters, digits, and hyphens");
if (fs.existsSync(output)) throw new Error(`Output already exists: ${output}`);

const romSource = path.join(workspace, "source.rom");
const luaSource = path.join(workspace, "code.p8.lua");
for (const input of [romSource, luaSource]) {
  if (!fs.statSync(input, { throwIfNoEntry: false })?.isFile()) throw new Error(`Missing private input: ${input}`);
}

fs.rmSync(privateSourceRoot, { recursive: true, force: true });
if (presentation !== "reference") {
  const overlaySource = path.join(workspace, "web-overlay", `${presentation}.ts`);
  if (!fs.statSync(overlaySource, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Missing private presentation adapter: ${overlaySource}`);
  }
  fs.mkdirSync(privateSourceRoot, { recursive: true });
  fs.copyFileSync(overlaySource, path.join(privateSourceRoot, `${presentation}.ts`));
  const supportSource = path.join(path.dirname(overlaySource), "support");
  if (fs.statSync(supportSource, { throwIfNoEntry: false })?.isDirectory()) {
    fs.cpSync(supportSource, path.join(privateSourceRoot, "support"), { recursive: true });
  }
}

const moduleRoot = path.join(privateRoot, id);
fs.rmSync(privateRoot, { recursive: true, force: true });
fs.mkdirSync(moduleRoot, { recursive: true });
fs.copyFileSync(romSource, path.join(moduleRoot, "source.rom"));
fs.copyFileSync(luaSource, path.join(moduleRoot, "code.p8.lua"));
const gameManifest = {
  formatVersion: 1,
  id,
  title,
  author,
  rom: `${id}/source.rom`,
  source: `${id}/code.p8.lua`,
  presentation,
  persistenceKey,
  researchOnly: true,
  audio: "original-silent-cart",
  sourceLicense,
  sourceUrl,
};
fs.writeFileSync(path.join(privateRoot, "game.json"), `${JSON.stringify(gameManifest, null, 2)}\n`);

const build = spawnSync("pnpm", ["--filter", "@aico8/web", "build"], {
  cwd: root,
  env: { ...process.env, SOURCE_DATE_EPOCH: "0", TZ: "UTC" },
  stdio: "inherit",
});
if (build.status !== 0) process.exit(build.status ?? 1);

const dist = path.join(root, "apps/web/dist");
fs.mkdirSync(output, { recursive: true });
fs.cpSync(dist, output, { recursive: true });
fs.writeFileSync(path.join(output, "PRIVATE-RESEARCH-ONLY.txt"),
  `${title} — private research and testing build\n\n`
  + "This package is not a formal Aico 8 release and is not intended for public distribution.\n"
  + `Original work: ${author}\nSource license: ${sourceLicense}\nSource: ${sourceUrl}\n`
  + "Serve this directory over HTTP or HTTPS; opening index.html directly is not supported.\n");

const files = listFiles(output).filter((relative) => relative !== "release-manifest.json");
const releaseManifest = {
  schema_version: 1,
  game: { id, title, author },
  target: "web-pwa",
  presentation,
  output_profile: "hd-1024-square",
  rights: { profile: "private-research-and-testing-only", sourceLicense, sourceUrl },
  audio: "original-silent-cart",
  inputs: [
    { path: "source.rom", sha256: sha256(romSource), bytes: fs.statSync(romSource).size },
    { path: "code.p8.lua", sha256: sha256(luaSource), bytes: fs.statSync(luaSource).size },
  ],
  artifacts: files.map((relative) => ({
    path: relative.split(path.sep).join("/"),
    sha256: sha256(path.join(output, relative)),
    bytes: fs.statSync(path.join(output, relative)).size,
  })),
};
fs.writeFileSync(path.join(output, "release-manifest.json"), `${JSON.stringify(releaseManifest, null, 2)}\n`);
process.stdout.write(`Private Web/PWA package: ${output}\n`);
