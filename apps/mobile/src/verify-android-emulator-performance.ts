import { validateTargetProfile, type AndroidTargetProfileV1 } from "@aico8/contracts";
import fs from "node:fs";
import path from "node:path";
import {
  evaluateAndroidPerformance,
  parseAndroidFrameDurationCsv,
  parseColdLaunchMilliseconds,
} from "./android-device-capture.js";

const args = process.argv.slice(2).filter((argument) => argument !== "--");
if (args.length !== 6) {
  throw new Error(
    "Usage: verify-android-emulator-performance "
      + "<target-profile.json> <frame-durations.csv> <host-launch.txt> "
      + "<capture-seconds> <emulator-profile-id> <output.json>",
  );
}
const [profileValue, gfxValue, launchValue, secondsValue, emulatorProfileId, outputValue] = args as string[];
const profileUnknown: unknown = JSON.parse(fs.readFileSync(path.resolve(profileValue!), "utf8"));
const validation = validateTargetProfile(profileUnknown);
if (!validation.ok || (profileUnknown as { target?: unknown }).target !== "android-webview") {
  throw new Error(`Invalid Android target profile: ${validation.errors.join("; ")}`);
}
const profile = profileUnknown as AndroidTargetProfileV1;
const captureSeconds = Number(secondsValue);
if (!Number.isSafeInteger(captureSeconds) || captureSeconds < 60) {
  throw new Error("Android emulator performance capture must be an integer >= 60 seconds");
}
if (!emulatorProfileId || emulatorProfileId.trim() !== emulatorProfileId) {
  throw new Error("Android emulator profile ID must be a non-empty trimmed value");
}
const launchMilliseconds = parseColdLaunchMilliseconds(fs.readFileSync(path.resolve(launchValue!), "utf8"));
const frameDurations = parseAndroidFrameDurationCsv(fs.readFileSync(path.resolve(gfxValue!), "utf8"));
const performance = evaluateAndroidPerformance(
  frameDurations,
  profile,
  captureSeconds,
);
const result = {
  schemaVersion: "aico8.android-emulator-performance.v1",
  emulatorProfileId,
  targetProfileId: profile.id,
  coldLaunchMilliseconds: launchMilliseconds,
  startupBudgetPassed: launchMilliseconds <= profile.budgets.startupMillisecondsMax,
  performance,
};
fs.writeFileSync(path.resolve(outputValue!), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
if (!result.startupBudgetPassed || !performance.budgetPassed) {
  throw new Error("Android square-emulator startup or sustained-frame budget failed");
}
console.log(
  `Android square-emulator performance passed: ${performance.observedSampleFrames} frames, `
    + `p95 ${performance.p95FrameMilliseconds} ms, dropped ratio ${performance.droppedFrameRatio}.`,
);
