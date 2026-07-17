import path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleAndroidWebAssets } from "./android-lineage.js";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2).filter((argument) => argument !== "--");
if (args.length < 1 || args.length > 4) {
  throw new Error("Usage: pnpm --filter @aico8/mobile assemble:web -- <validated-web-package> [target-profile] [www-output] [lineage-output]");
}
const sourcePackage = path.resolve(args[0]!);
const androidTargetProfile = path.resolve(args[1] ?? path.join(appRoot, "target-profile.json"));
const outputDirectory = path.resolve(args[2] ?? path.join(appRoot, "www"));
const lineageFile = path.resolve(args[3] ?? path.join(appRoot, "android-web-lineage.json"));
const lineage = await assembleAndroidWebAssets({ sourcePackage, androidTargetProfile, outputDirectory, lineageFile });
console.log(`Android Web staging assembled: ${lineage.webAssets.artifactCount} files, ${lineage.webAssets.treeSha256}`);
