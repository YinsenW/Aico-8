import {
  validateAndroidPhysicalDeviceValidation,
  validateAndroidWebLineage,
  type AndroidWebLineageV1,
} from "@aico8/contracts";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  buildPendingAndroidDeviceReport,
  instrumentationPassed,
  parseColdLaunchMilliseconds,
  parseConnectedAndroidDevices,
  parsePackageVersion,
  parsePhysicalDensity,
  parsePhysicalPixels,
  pngDimensions,
  sha256,
} from "./android-device-capture.js";

const args = process.argv.slice(2).filter((argument) => argument !== "--");
if (args.length !== 6) {
  throw new Error(
    "Usage: pnpm --filter @aico8/mobile capture:device -- "
      + "<debug-apk> <android-test-apk> <android-web-lineage.json> "
      + "<device-profile-id> <controller-name> <evidence-output-directory>",
  );
}

const [debugApkValue, testApkValue, lineageValue, profileId, controllerName, outputValue] = args as [string, string, string, string, string, string];
const debugApk = path.resolve(debugApkValue);
const testApk = path.resolve(testApkValue);
const lineagePath = path.resolve(lineageValue);
const output = path.resolve(outputValue);
for (const file of [debugApk, testApk, lineagePath]) {
  if (!fs.statSync(file).isFile()) throw new Error(`Required capture input is not a file: ${file}`);
}
fs.mkdirSync(output, { recursive: true });

const text = (command: string, commandArgs: readonly string[]): string => execFileSync(
  command,
  [...commandArgs],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
);
const binary = (command: string, commandArgs: readonly string[]): Buffer => execFileSync(
  command,
  [...commandArgs],
  { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 },
);
const writeText = (name: string, value: string): string => {
  const target = path.join(output, name);
  fs.writeFileSync(target, value, "utf8");
  return sha256(value);
};
const writeBinary = (name: string, value: Uint8Array): string => {
  const target = path.join(output, name);
  fs.writeFileSync(target, value);
  return sha256(value);
};

const lineageRaw = fs.readFileSync(lineagePath);
const lineageUnknown: unknown = JSON.parse(lineageRaw.toString("utf8"));
const lineageValidation = validateAndroidWebLineage(lineageUnknown);
if (!lineageValidation.ok) throw new Error(`Invalid Android Web lineage: ${lineageValidation.errors.join("; ")}`);
const lineage = lineageUnknown as AndroidWebLineageV1;
const applicationId = lineage.host.applicationId;

const connected = parseConnectedAndroidDevices(text("adb", ["devices", "-l"]));
if (connected.length !== 1) {
  throw new Error(`Physical capture requires exactly one authorized adb device; found ${connected.length}`);
}
const serial = connected[0]!.serial;
const adb = (commandArgs: readonly string[]): string => text("adb", ["-s", serial, ...commandArgs]);
const adbBinary = (commandArgs: readonly string[]): Buffer => binary("adb", ["-s", serial, ...commandArgs]);
const property = (name: string): string => adb(["shell", "getprop", name]).trim();

const qemu = [property("ro.kernel.qemu"), property("ro.boot.qemu")].includes("1") || serial.startsWith("emulator-");
if (qemu) throw new Error("Physical-device capture rejects Android emulators");

const physicalPixels = parsePhysicalPixels(adb(["shell", "wm", "size"]));
const densityDpi = parsePhysicalDensity(adb(["shell", "wm", "density"]));
const webViewPackageOutput = adb(["shell", "cmd", "webviewupdate", "getCurrentWebViewPackage"]);
const webViewPackage = webViewPackageOutput.match(/[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+/iu)?.[0];
if (!webViewPackage) throw new Error("Unable to identify the active vendor WebView package");
const webViewVersion = parsePackageVersion(adb(["shell", "dumpsys", "package", webViewPackage]));

const inputDevices = adb(["shell", "dumpsys", "input"]);
const inputDevicesSha256 = writeText("input-devices.txt", inputDevices);
const controllerEnumerated = inputDevices.toLocaleLowerCase().includes(controllerName.toLocaleLowerCase());

adb(["install", "-r", debugApk]);
adb(["install", "-r", testApk]);
adb(["shell", "cmd", "connectivity", "airplane-mode", "enable"]);
adb(["shell", "svc", "wifi", "disable"]);
adb(["shell", "svc", "data", "disable"]);
const offlineMode = adb(["shell", "settings", "get", "global", "airplane_mode_on"]).trim() === "1";
adb(["logcat", "-c"]);

const instrumentation = spawnSync(
  "adb",
  [
    "-s", serial,
    "shell", "am", "instrument", "-w", "-r",
    "-e", "class", "dev.aico8.research.PhysicalDeviceAcceptanceTest",
    `${applicationId}.test/androidx.test.runner.AndroidJUnitRunner`,
  ],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
);
const instrumentationOutput = `${instrumentation.stdout ?? ""}${instrumentation.stderr ?? ""}`;
const instrumentationSha256 = writeText("instrumentation.txt", instrumentationOutput);
const passedInstrumentation = instrumentationPassed(instrumentationOutput, instrumentation.status);

let screenshot: Uint8Array = new Uint8Array();
if (passedInstrumentation) {
  screenshot = adbBinary(["exec-out", "run-as", applicationId, "cat", "files/physical-host.png"]);
}
const screenshotDimensions = pngDimensions(screenshot);
const readyScreenshotCaptured = screenshotDimensions?.width === physicalPixels.width
  && screenshotDimensions.height === physicalPixels.height;
const screenshotSha256 = writeBinary("physical-host.png", screenshot);

adb(["shell", "am", "force-stop", applicationId]);
const launch = adb(["shell", "am", "start", "-W", "-n", `${applicationId}/.MainActivity`]);
writeText("cold-launch.txt", launch);
const coldLaunchMilliseconds = parseColdLaunchMilliseconds(launch);
const logcat = adb(["logcat", "-d", "-v", "threadtime"]);
const gfxInfo = adb(["shell", "dumpsys", "gfxinfo", applicationId, "framestats"]);
const logcatSha256 = writeText("logcat.txt", logcat);
const gfxInfoSha256 = writeText("gfxinfo-framestats.txt", gfxInfo);

const report = buildPendingAndroidDeviceReport({
  capturedAt: new Date().toISOString(),
  lineage,
  lineageSha256: sha256(lineageRaw),
  apkSha256: sha256(fs.readFileSync(debugApk)),
  profileId,
  serial,
  manufacturer: property("ro.product.manufacturer"),
  model: property("ro.product.model"),
  product: property("ro.product.name"),
  buildFingerprint: property("ro.build.fingerprint"),
  apiLevel: Number(property("ro.build.version.sdk")),
  abi: property("ro.product.cpu.abi"),
  emulator: qemu,
  physicalPixels,
  densityDpi,
  webView: {
    packageName: webViewPackage,
    versionName: webViewVersion.versionName,
    versionCode: webViewVersion.versionCode,
  },
  controllerName,
  automatedChecks: {
    singleAuthorizedDevice: true,
    physicalDevice: !qemu,
    apkInstalled: true,
    offlineMode,
    instrumentationPassed: passedInstrumentation,
    readyScreenshotCaptured,
    controllerEnumerated,
    coldLaunchMilliseconds,
  },
  artifactHashes: {
    screenshotSha256,
    instrumentationSha256,
    logcatSha256,
    inputDevicesSha256,
    gfxInfoSha256,
  },
});
const reportValidation = validateAndroidPhysicalDeviceValidation(report);
if (!reportValidation.ok) throw new Error(`Generated invalid device report: ${reportValidation.errors.join("; ")}`);
fs.writeFileSync(path.join(output, "android-device-validation.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (report.status === "failed") {
  throw new Error("Android physical-device automated capture failed; inspect retained evidence");
}
console.log(
  `Android physical-device evidence captured for ${report.device.profileId}; `
    + "status remains pending-human until all four manual checks pass.",
);
