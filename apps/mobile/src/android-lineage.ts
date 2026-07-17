import {
  ANDROID_WEB_ASSET_POLICY,
  ANDROID_WEB_LINEAGE_SCHEMA_VERSION,
  validateAndroidWebLineage,
  validateReleaseManifest,
  validateTargetProfile,
  type AndroidTargetProfileV1,
  type AndroidWebLineageFileV1,
  type AndroidWebLineageV1,
  type WebTargetProfileV1,
} from "@aico8/contracts";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const hashPattern = /^[a-f0-9]{64}$/;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, "utf8")) as unknown;
}

async function walk(root: string, relative = ""): Promise<AndroidWebLineageFileV1[]> {
  const directory = path.join(root, relative);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  const files: AndroidWebLineageFileV1[] = [];
  for (const entry of entries) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Web artifact contains symlink: ${child}`);
    if (entry.isDirectory()) files.push(...await walk(root, child));
    else if (entry.isFile()) {
      const bytes = await fs.readFile(path.join(root, child));
      files.push({ path: child, sha256: sha256(bytes), bytes: bytes.length });
    } else throw new Error(`Web artifact contains unsupported filesystem entry: ${child}`);
  }
  return files;
}

export async function inventoryWebAssets(root: string): Promise<readonly AndroidWebLineageFileV1[]> {
  const stat = await fs.stat(root).catch(() => undefined);
  if (!stat?.isDirectory()) throw new Error(`Web artifact directory is missing: ${root}`);
  const files = await walk(root);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

export function webAssetTreeSha256(files: readonly AndroidWebLineageFileV1[]): string {
  const digest = createHash("sha256");
  for (const file of files) digest.update(file.path).update("\0").update(file.sha256).update("\0").update(String(file.bytes)).update("\n");
  return digest.digest("hex");
}

function assertSameInventory(
  expected: readonly AndroidWebLineageFileV1[],
  actual: readonly AndroidWebLineageFileV1[],
  label: string,
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const expectedByPath = new Map(expected.map((file) => [file.path, file]));
    const actualByPath = new Map(actual.map((file) => [file.path, file]));
    const paths = [...new Set([...expectedByPath.keys(), ...actualByPath.keys()])].sort();
    const first = paths.find((entry) => JSON.stringify(expectedByPath.get(entry)) !== JSON.stringify(actualByPath.get(entry)));
    throw new Error(`${label} differs from validated Web artifact${first ? ` at ${first}` : ""}`);
  }
}

async function assertWebRelease(root: string, files: readonly AndroidWebLineageFileV1[]): Promise<{
  releaseManifestSha256: string;
  visualRuntimeSha256: string;
  sourceTargetProfileId: string;
  sourceTargetProfileSha256: string;
}> {
  const releasePath = path.join(root, "release-manifest.json");
  const profilePath = path.join(root, "target-profile.json");
  const releaseValue = await readJson(releasePath);
  const releaseValidation = validateReleaseManifest(releaseValue);
  if (!releaseValidation.ok) throw new Error(`Invalid Web release manifest: ${releaseValidation.errors.join("; ")}`);
  const profileValue = await readJson(profilePath);
  const profileValidation = validateTargetProfile(profileValue);
  if (!profileValidation.ok || (profileValue as { target?: unknown }).target !== "web-pwa") {
    throw new Error(`Invalid source Web target profile: ${profileValidation.errors.join("; ")}`);
  }
  const release = releaseValue as {
    target: string;
    target_profile: { id: string; sha256: string };
    identities: { visual_runtime_sha256: string };
    artifacts: readonly AndroidWebLineageFileV1[];
  };
  const sourceProfile = profileValue as WebTargetProfileV1;
  if (release.target !== "web-pwa") throw new Error("Android host source must be a web-pwa release");
  const profileBytes = await fs.readFile(profilePath);
  const sourceProfileSha256 = sha256(profileBytes);
  if (release.target_profile.id !== sourceProfile.id || release.target_profile.sha256 !== sourceProfileSha256) {
    throw new Error("Web release target-profile identity does not match packaged target-profile.json");
  }
  const actualArtifacts = files.filter((file) => file.path !== "release-manifest.json");
  const declaredArtifacts = [...release.artifacts].sort((left, right) => left.path.localeCompare(right.path));
  assertSameInventory(declaredArtifacts, actualArtifacts, "Web release artifact manifest");
  if (!hashPattern.test(release.identities.visual_runtime_sha256)) {
    throw new Error("Web release visual runtime identity is invalid");
  }
  return {
    releaseManifestSha256: sha256(await fs.readFile(releasePath)),
    visualRuntimeSha256: release.identities.visual_runtime_sha256,
    sourceTargetProfileId: sourceProfile.id,
    sourceTargetProfileSha256: sourceProfileSha256,
  };
}

async function copyInventory(source: string, destination: string, files: readonly AndroidWebLineageFileV1[]): Promise<void> {
  for (const file of files) {
    const output = path.join(destination, ...file.path.split("/"));
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.copyFile(path.join(source, ...file.path.split("/")), output);
  }
}

export interface AssembleAndroidWebAssetsOptions {
  readonly sourcePackage: string;
  readonly androidTargetProfile: string;
  readonly outputDirectory: string;
  readonly lineageFile: string;
}

export async function assembleAndroidWebAssets(options: AssembleAndroidWebAssetsOptions): Promise<AndroidWebLineageV1> {
  const sourcePackage = await fs.realpath(options.sourcePackage);
  const sourceFiles = await inventoryWebAssets(sourcePackage);
  const webRelease = await assertWebRelease(sourcePackage, sourceFiles);
  const targetBytes = await fs.readFile(options.androidTargetProfile);
  const targetValue = JSON.parse(targetBytes.toString("utf8")) as unknown;
  const targetValidation = validateTargetProfile(targetValue);
  if (!targetValidation.ok || (targetValue as { target?: unknown }).target !== "android-webview") {
    throw new Error(`Invalid Android target profile: ${targetValidation.errors.join("; ")}`);
  }
  const target = targetValue as AndroidTargetProfileV1;
  const destination = path.resolve(options.outputDirectory);
  if (destination === sourcePackage || destination.startsWith(`${sourcePackage}${path.sep}`)) {
    throw new Error("Android Web staging directory must not overlap the source package");
  }
  const temporary = `${destination}.tmp-${process.pid}`;
  await fs.rm(temporary, { recursive: true, force: true });
  await fs.mkdir(temporary, { recursive: true });
  try {
    await copyInventory(sourcePackage, temporary, sourceFiles);
    assertSameInventory(sourceFiles, await inventoryWebAssets(temporary), "Staged Web assets");
    await fs.rm(destination, { recursive: true, force: true });
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    throw error;
  }
  const lineage: AndroidWebLineageV1 = {
    schemaVersion: ANDROID_WEB_LINEAGE_SCHEMA_VERSION,
    generatedBy: "aico8-mobile-assembler-v1",
    targetProfile: { id: target.id, sha256: sha256(targetBytes) },
    webRelease,
    webAssets: {
      policy: ANDROID_WEB_ASSET_POLICY,
      treeSha256: webAssetTreeSha256(sourceFiles),
      artifactCount: sourceFiles.length,
      unpackedBytes: sourceFiles.reduce((total, file) => total + file.bytes, 0),
      files: sourceFiles,
    },
    host: {
      applicationId: target.android.applicationId,
      capacitorVersion: target.android.capacitorVersion,
      minSdk: target.android.minSdk,
      targetSdk: target.android.targetSdk,
      compileSdk: target.android.compileSdk,
      signingPolicy: target.android.signingPolicy,
      allowedGeneratedAssetPaths: ["cordova.js", "cordova_plugins.js"],
    },
  };
  const lineageValidation = validateAndroidWebLineage(lineage);
  if (!lineageValidation.ok) throw new Error(`Generated invalid Android lineage: ${lineageValidation.errors.join("; ")}`);
  const lineagePath = path.resolve(options.lineageFile);
  await fs.mkdir(path.dirname(lineagePath), { recursive: true });
  const lineageTemporary = `${lineagePath}.tmp-${process.pid}`;
  await fs.writeFile(lineageTemporary, `${JSON.stringify(lineage, null, 2)}\n`, { flag: "wx" });
  await fs.rename(lineageTemporary, lineagePath);
  return lineage;
}

export interface VerifyAndroidWebLineageOptions {
  readonly sourcePackage: string;
  readonly androidTargetProfile: string;
  readonly stagedDirectory: string;
  readonly lineageFile: string;
  readonly androidAssetsDirectory?: string;
}

export async function verifyAndroidWebLineage(options: VerifyAndroidWebLineageOptions): Promise<AndroidWebLineageV1> {
  const lineageValue = await readJson(options.lineageFile);
  const validation = validateAndroidWebLineage(lineageValue);
  if (!validation.ok) throw new Error(`Invalid Android lineage: ${validation.errors.join("; ")}`);
  const lineage = lineageValue as AndroidWebLineageV1;
  const targetBytes = await fs.readFile(options.androidTargetProfile);
  const targetValue = JSON.parse(targetBytes.toString("utf8")) as unknown;
  const targetValidation = validateTargetProfile(targetValue);
  if (!targetValidation.ok || (targetValue as { target?: unknown }).target !== "android-webview") {
    throw new Error(`Invalid Android target profile: ${targetValidation.errors.join("; ")}`);
  }
  const target = targetValue as AndroidTargetProfileV1;
  if (lineage.targetProfile.id !== target.id || lineage.targetProfile.sha256 !== sha256(targetBytes)) {
    throw new Error("Android target profile identity differs from Android lineage");
  }
  const expectedHost = {
    applicationId: target.android.applicationId,
    capacitorVersion: target.android.capacitorVersion,
    minSdk: target.android.minSdk,
    targetSdk: target.android.targetSdk,
    compileSdk: target.android.compileSdk,
    signingPolicy: target.android.signingPolicy,
    allowedGeneratedAssetPaths: ["cordova.js", "cordova_plugins.js"],
  };
  if (JSON.stringify(lineage.host) !== JSON.stringify(expectedHost)) {
    throw new Error("Android host configuration differs from target profile");
  }
  const sourceFiles = await inventoryWebAssets(options.sourcePackage);
  assertSameInventory(lineage.webAssets.files, sourceFiles, "Source Web package");
  assertSameInventory(lineage.webAssets.files, await inventoryWebAssets(options.stagedDirectory), "Staged Web assets");
  if (webAssetTreeSha256(sourceFiles) !== lineage.webAssets.treeSha256) {
    throw new Error("Source Web package tree hash differs from Android lineage");
  }
  const webRelease = await assertWebRelease(options.sourcePackage, sourceFiles);
  if (JSON.stringify(webRelease) !== JSON.stringify(lineage.webRelease)) {
    throw new Error("Source Web release identity differs from Android lineage");
  }
  if (options.androidAssetsDirectory) {
    const copied = await inventoryWebAssets(options.androidAssetsDirectory);
    const allowed = new Set(lineage.host.allowedGeneratedAssetPaths);
    const copiedWeb = copied.filter((file) => !allowed.has(file.path as typeof lineage.host.allowedGeneratedAssetPaths[number]));
    assertSameInventory(lineage.webAssets.files, copiedWeb, "Capacitor Android assets");
    const unexpected = copied.filter((file) => !lineage.webAssets.files.some((source) => source.path === file.path) && !allowed.has(file.path as typeof lineage.host.allowedGeneratedAssetPaths[number]));
    if (unexpected.length > 0) throw new Error(`Capacitor Android assets contain undeclared ${unexpected[0]!.path}`);
  }
  return lineage;
}
