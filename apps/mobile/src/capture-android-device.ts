import {
  ANDROID_MIN_PERFORMANCE_CAPTURE_SECONDS,
  validateAndroidPhysicalDeviceValidation,
  validateTargetProfile,
  validateAndroidWebLineage,
  type AndroidTargetProfileV1,
  type AndroidWebLineageV1,
} from "@aico8/contracts";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  ANDROID_DEVICE_ARTIFACT_FILES,
  androidNetworkRestoreCommands,
  androidNetworkStateIsOffline,
  buildPendingAndroidDeviceReport,
  evaluateAndroidPerformance,
  instrumentationPassed,
  orientationEvidencePassed,
  parseColdLaunchMilliseconds,
  parseAndroidNetworkState,
  parseConnectedAndroidDevices,
  parsePackageVersion,
  parseGfxFrameDurationsMilliseconds,
  parsePhysicalDensity,
  parsePhysicalPixels,
  pngDimensions,
  sha256,
  verifyAndroidApkWebAssets,
} from "./android-device-capture.js";

const args = process.argv.slice(2).filter((argument) => argument !== "--");
if (args.length !== 8) {
  throw new Error(
    "Usage: pnpm --filter @aico8/mobile capture:device -- "
      + "<debug-apk> <android-test-apk> <android-web-lineage.json> <target-profile.json> "
      + "<device-profile-id> <controller-name> <performance-capture-seconds> <evidence-output-directory>",
  );
}

const [debugApkValue, testApkValue, lineageValue, targetProfileValue, profileId, controllerName, performanceCaptureSecondsValue, outputValue]
  = args as [string, string, string, string, string, string, string, string];
const debugApk = path.resolve(debugApkValue);
const testApk = path.resolve(testApkValue);
const lineagePath = path.resolve(lineageValue);
const targetProfilePath = path.resolve(targetProfileValue);
const output = path.resolve(outputValue);
for (const file of [debugApk, testApk, lineagePath, targetProfilePath]) {
  if (!fs.statSync(file).isFile()) throw new Error(`Required capture input is not a file: ${file}`);
}
const performanceCaptureSeconds = Number(performanceCaptureSecondsValue);
if (profileId.trim().length === 0 || profileId !== profileId.trim()) {
  throw new Error("Physical-device profile ID must be a non-empty trimmed value");
}
if (controllerName.trim().length === 0 || controllerName !== controllerName.trim()) {
  throw new Error("Controller name must be a non-empty trimmed value");
}
if (!Number.isSafeInteger(performanceCaptureSeconds) || performanceCaptureSeconds < ANDROID_MIN_PERFORMANCE_CAPTURE_SECONDS) {
  throw new Error(`Performance capture must be an integer >= ${ANDROID_MIN_PERFORMANCE_CAPTURE_SECONDS} seconds`);
}
if (fs.existsSync(output) && fs.readdirSync(output).length > 0) {
  throw new Error("Physical-device evidence output must be absent or empty");
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
const debugApkBytes = fs.readFileSync(debugApk);
verifyAndroidApkWebAssets(debugApkBytes, lineage);
const applicationId = lineage.host.applicationId;
fs.writeFileSync(path.join(output, "android-web-lineage.json"), lineageRaw);
const targetProfileRaw = fs.readFileSync(targetProfilePath);
const targetProfileUnknown: unknown = JSON.parse(targetProfileRaw.toString("utf8"));
const targetProfileValidation = validateTargetProfile(targetProfileUnknown);
if (!targetProfileValidation.ok) throw new Error(`Invalid Android target profile: ${targetProfileValidation.errors.join("; ")}`);
const targetProfile = targetProfileUnknown as AndroidTargetProfileV1;
if (targetProfile.target !== "android-webview") throw new Error("Physical capture requires an Android target profile");
if (targetProfile.id !== lineage.targetProfile.id || sha256(targetProfileRaw) !== lineage.targetProfile.sha256) {
  throw new Error("Android target profile does not match the lineage-bound profile bytes");
}
fs.writeFileSync(path.join(output, "target-profile.json"), targetProfileRaw);

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
const inputDevicesSha256 = writeText(ANDROID_DEVICE_ARTIFACT_FILES.inputDevicesSha256, inputDevices);
const controllerEnumerated = inputDevices.toLocaleLowerCase().includes(controllerName.toLocaleLowerCase());

const readNetworkState = () => parseAndroidNetworkState({
  airplaneMode: adb(["shell", "settings", "get", "global", "airplane_mode_on"]),
  wifi: adb(["shell", "settings", "get", "global", "wifi_on"]),
  mobileData: adb(["shell", "settings", "get", "global", "mobile_data"]),
});
const waitForNetworkState = async (
  predicate: (state: ReturnType<typeof readNetworkState>) => boolean,
  label: string,
): Promise<ReturnType<typeof readNetworkState>> => {
  let state = readNetworkState();
  for (let attempt = 0; attempt < 20 && !predicate(state); attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    state = readNetworkState();
  }
  if (!predicate(state)) throw new Error(`Android network state did not reach ${label}`);
  return state;
};
const initialNetworkState = readNetworkState();
let networkStateChanged = false;
let captureFailure: unknown;

try {
adb(["install", "-r", debugApk]);
adb(["install", "-r", testApk]);
if (!/^Success$/mu.test(adb(["shell", "pm", "clear", applicationId]))) {
  throw new Error("Unable to clear prior application data before physical-device capture");
}
networkStateChanged = true;
adb(["shell", "cmd", "connectivity", "airplane-mode", "enable"]);
adb(["shell", "svc", "wifi", "disable"]);
adb(["shell", "svc", "data", "disable"]);
await waitForNetworkState(androidNetworkStateIsOffline, "airplane-mode offline isolation");
const offlineMode = true;
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
const instrumentationSha256 = writeText(ANDROID_DEVICE_ARTIFACT_FILES.instrumentationSha256, instrumentationOutput);
const passedInstrumentation = instrumentationPassed(instrumentationOutput, instrumentation.status);

let screenshot: Uint8Array = new Uint8Array();
let orientationEvidence = "";
if (passedInstrumentation) {
  try {
    screenshot = adbBinary(["exec-out", "run-as", applicationId, "cat", "files/physical-host.png"]);
  } catch {
    screenshot = new Uint8Array();
  }
  try {
    orientationEvidence = adb(["exec-out", "run-as", applicationId, "cat", "files/physical-orientation.json"]);
  } catch {
    orientationEvidence = "";
  }
}
const orientationSha256 = writeText(ANDROID_DEVICE_ARTIFACT_FILES.orientationSha256, orientationEvidence);
const orientationChangePassed = orientationEvidencePassed(orientationEvidence);
const screenshotDimensions = pngDimensions(screenshot);
const readyScreenshotCaptured = screenshotDimensions?.width === physicalPixels.width
  && screenshotDimensions.height === physicalPixels.height;
const screenshotSha256 = writeBinary(ANDROID_DEVICE_ARTIFACT_FILES.screenshotSha256, screenshot);

adb(["shell", "am", "force-stop", applicationId]);
adb(["shell", "dumpsys", "gfxinfo", applicationId, "reset"]);
const launch = adb(["shell", "am", "start", "-W", "-n", `${applicationId}/.MainActivity`]);
writeText("cold-launch.txt", launch);
const coldLaunchMilliseconds = parseColdLaunchMilliseconds(launch);
console.log(
  `Play the lineage-bound game continuously with ${controllerName} for ${performanceCaptureSeconds} seconds; `
    + "frame evidence is now being recorded.",
);
await new Promise<void>((resolve) => setTimeout(resolve, performanceCaptureSeconds * 1_000));
const logcat = adb(["logcat", "-d", "-v", "threadtime"]);
const gfxInfo = adb(["shell", "dumpsys", "gfxinfo", applicationId, "framestats"]);
const logcatSha256 = writeText(ANDROID_DEVICE_ARTIFACT_FILES.logcatSha256, logcat);
const gfxInfoSha256 = writeText(ANDROID_DEVICE_ARTIFACT_FILES.gfxInfoSha256, gfxInfo);
const performance = evaluateAndroidPerformance(
  parseGfxFrameDurationsMilliseconds(gfxInfo),
  targetProfile,
  performanceCaptureSeconds,
);

const report = buildPendingAndroidDeviceReport({
  capturedAt: new Date().toISOString(),
  lineage,
  lineageSha256: sha256(lineageRaw),
  apkSha256: sha256(debugApkBytes),
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
    orientationChangePassed,
    readyScreenshotCaptured,
    controllerEnumerated,
    coldLaunchMilliseconds,
    performance,
  },
  artifactHashes: {
    screenshotSha256,
    instrumentationSha256,
    orientationSha256,
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
} catch (error) {
  captureFailure = error;
  throw error;
} finally {
  if (networkStateChanged) {
    try {
      for (const command of androidNetworkRestoreCommands(initialNetworkState)) adb(command);
      await waitForNetworkState(
        (state) => JSON.stringify(state) === JSON.stringify(initialNetworkState),
        "the pre-capture state",
      );
    } catch (restorationError) {
      if (captureFailure === undefined) throw restorationError;
      console.error(`Android capture also failed to restore the pre-capture network state: ${String(restorationError)}`);
    }
  }
}
