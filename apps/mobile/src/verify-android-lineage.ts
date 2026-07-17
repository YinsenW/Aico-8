import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyAndroidWebLineage } from "./android-lineage.js";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2).filter((argument) => argument !== "--");
if (args.length < 1 || args.length > 4) {
  throw new Error("Usage: pnpm --filter @aico8/mobile verify:lineage -- <validated-web-package> [www-staging] [lineage] [android-assets]");
}
const sourcePackage = path.resolve(args[0]!);
const stagedDirectory = path.resolve(args[1] ?? path.join(appRoot, "www"));
const lineageFile = path.resolve(args[2] ?? path.join(appRoot, "android-web-lineage.json"));
const defaultAndroidAssets = path.join(appRoot, "android/app/src/main/assets/public");
const androidTargetProfile = path.join(appRoot, "target-profile.json");
const androidAssetsDirectory = args[3]
  ? path.resolve(args[3])
  : defaultAndroidAssets;
const lineage = await verifyAndroidWebLineage({
  sourcePackage,
  androidTargetProfile,
  stagedDirectory,
  lineageFile,
  androidAssetsDirectory,
});
console.log(`Android Web lineage verified: ${lineage.webAssets.treeSha256}`);
