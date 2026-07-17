import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function sha256(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export interface WebArtifactInventoryFile {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

async function walk(root: string, relative = ""): Promise<WebArtifactInventoryFile[]> {
  const directory = path.join(root, relative);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  const files: WebArtifactInventoryFile[] = [];
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

export async function inventoryWebAssets(root: string): Promise<readonly WebArtifactInventoryFile[]> {
  const stat = await fs.stat(root).catch(() => undefined);
  if (!stat?.isDirectory()) throw new Error(`Web artifact directory is missing: ${root}`);
  const files = await walk(root);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

export function webAssetTreeSha256(files: readonly WebArtifactInventoryFile[]): string {
  const digest = crypto.createHash("sha256");
  for (const file of files) {
    digest.update(file.path).update("\0").update(file.sha256).update("\0").update(String(file.bytes)).update("\n");
  }
  return digest.digest("hex");
}
