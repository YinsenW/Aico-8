import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { validateReleaseManifest, validateTargetProfile } from "../../packages/contracts/src/release.ts";
import { packageTreeSha256 } from "./release-identities.mjs";

export interface VerifiedStandaloneWebPackage {
  readonly root: string;
  readonly game: { readonly id: string; readonly title: string; readonly author: string };
  readonly rights: { readonly profile: string; readonly sourceLicense: string; readonly sourceUrl: string };
  readonly targetProfile: { readonly id: string; readonly sha256: string };
  readonly persistenceKey: string;
  readonly releaseManifestSha256: string;
  readonly treeSha256: string;
  readonly files: readonly {
    readonly path: string;
    readonly absolutePath: string;
    readonly sha256: string;
    readonly bytes: number;
  }[];
}

type UnknownRecord = Record<string, unknown>;
const HASH = /^[a-f0-9]{64}$/;

function object(value: unknown, label: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as UnknownRecord;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function safeRelativePath(value: string, label: string): string {
  const segments = value.split("/");
  if (value.startsWith("/") || value.includes("\\")
    || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`${label} must be a safe package-relative path`);
  }
  return value;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function listRegularFiles(root: string): Promise<readonly { path: string; absolutePath: string }[]> {
  const files: { path: string; absolutePath: string }[] = [];
  async function walk(directory: string, prefix: string): Promise<void> {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Standalone package contains symlink: ${relative}`);
      if (entry.isDirectory()) await walk(absolutePath, relative);
      else if (entry.isFile()) files.push({ path: relative, absolutePath });
      else throw new Error(`Standalone package contains unsupported entry: ${relative}`);
    }
  }
  await walk(root, "");
  return files;
}

export async function verifyStandaloneWebPackage(packageRoot: string): Promise<VerifiedStandaloneWebPackage> {
  const root = await fs.realpath(path.resolve(packageRoot));
  const rootStat = await fs.stat(root);
  if (!rootStat.isDirectory()) throw new Error(`Standalone package root must be a directory: ${packageRoot}`);
  const listed = await listRegularFiles(root);
  const byPath = new Map(listed.map((file) => [file.path, file]));
  for (const required of ["index.html", "private/game.json", "release-manifest.json", "target-profile.json"]) {
    if (!byPath.has(required)) throw new Error(`Standalone package is missing ${required}`);
  }

  const releaseManifestBytes = await fs.readFile(byPath.get("release-manifest.json")!.absolutePath);
  const releaseValue: unknown = JSON.parse(releaseManifestBytes.toString("utf8"));
  const releaseValidation = validateReleaseManifest(releaseValue);
  if (!releaseValidation.ok) {
    throw new Error(`Standalone release manifest is invalid:\n${releaseValidation.errors.join("\n")}`);
  }
  const release = releaseValue as UnknownRecord;
  const game = object(release.game, "release.game");
  const rights = object(release.rights, "release.rights");
  const targetProfileBinding = object(release.target_profile, "release.target_profile");
  const artifacts = release.artifacts as readonly UnknownRecord[];
  const declared = new Set<string>(["release-manifest.json"]);
  const verifiedArtifacts: { path: string; sha256: string; bytes: number }[] = [];
  for (const [index, artifactValue] of artifacts.entries()) {
    const artifact = object(artifactValue, `release.artifacts[${index}]`);
    const relative = safeRelativePath(string(artifact.path, `release.artifacts[${index}].path`), `release.artifacts[${index}].path`);
    const expectedHash = string(artifact.sha256, `release.artifacts[${index}].sha256`);
    const expectedBytes = artifact.bytes;
    if (!HASH.test(expectedHash) || !Number.isSafeInteger(expectedBytes) || (expectedBytes as number) < 0) {
      throw new Error(`Standalone release artifact metadata is invalid: ${relative}`);
    }
    const file = byPath.get(relative);
    if (!file) throw new Error(`Standalone release artifact is missing: ${relative}`);
    const bytes = await fs.readFile(file.absolutePath);
    if (bytes.byteLength !== expectedBytes) throw new Error(`Standalone release artifact byte mismatch: ${relative}`);
    if (sha256(bytes) !== expectedHash) throw new Error(`Standalone release artifact hash mismatch: ${relative}`);
    declared.add(relative);
    verifiedArtifacts.push({ path: relative, sha256: expectedHash, bytes: expectedBytes as number });
  }
  const actualPaths = [...byPath.keys()].sort();
  const declaredPaths = [...declared].sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(declaredPaths)) {
    const extras = actualPaths.filter((relative) => !declared.has(relative));
    throw new Error(`Standalone package contains undeclared files: ${extras.join(", ") || "declared artifact mismatch"}`);
  }

  const targetProfileBytes = await fs.readFile(byPath.get("target-profile.json")!.absolutePath);
  const targetProfileValue: unknown = JSON.parse(targetProfileBytes.toString("utf8"));
  const targetValidation = validateTargetProfile(targetProfileValue);
  if (!targetValidation.ok) throw new Error(`Standalone target profile is invalid:\n${targetValidation.errors.join("\n")}`);
  const targetProfile = object(targetProfileValue, "target profile");
  const targetHash = sha256(targetProfileBytes);
  if (targetProfileBinding.id !== targetProfile.id || targetProfileBinding.sha256 !== targetHash) {
    throw new Error("Standalone release target profile binding does not match target-profile.json bytes");
  }

  const privateGameValue: unknown = JSON.parse(await fs.readFile(byPath.get("private/game.json")!.absolutePath, "utf8"));
  const privateGame = object(privateGameValue, "private/game.json");
  const gameId = string(game.id, "release.game.id");
  if (privateGame.id !== gameId) throw new Error("Standalone private game ID does not match release manifest");
  const persistenceKey = string(privateGame.persistenceKey, "private/game.json.persistenceKey");

  const files = await Promise.all(listed.map(async (file) => {
    const bytes = await fs.readFile(file.absolutePath);
    return { ...file, sha256: sha256(bytes), bytes: bytes.byteLength };
  }));
  return {
    root,
    game: {
      id: gameId,
      title: string(game.title, "release.game.title"),
      author: string(game.author, "release.game.author"),
    },
    rights: {
      profile: string(rights.profile, "release.rights.profile"),
      sourceLicense: string(rights.sourceLicense, "release.rights.sourceLicense"),
      sourceUrl: string(rights.sourceUrl, "release.rights.sourceUrl"),
    },
    targetProfile: { id: string(targetProfile.id, "target profile id"), sha256: targetHash },
    persistenceKey,
    releaseManifestSha256: sha256(releaseManifestBytes),
    treeSha256: packageTreeSha256(releaseManifestBytes, verifiedArtifacts),
    files,
  };
}
