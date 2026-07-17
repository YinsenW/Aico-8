import { validateTargetProfile, type AndroidTargetProfileV1 } from "@aico8/contracts";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(import.meta.dirname, "..");
const read = (relative: string): string => fs.readFileSync(path.join(appRoot, relative), "utf8");
const profile = JSON.parse(read("target-profile.json")) as AndroidTargetProfileV1;

describe("Capacitor Android host project", () => {
  it("pins the target profile to the generated native project", () => {
    expect(validateTargetProfile(profile)).toEqual({ ok: true, errors: [] });
    const variables = read("android/variables.gradle");
    const appBuild = read("android/app/build.gradle");
    const capacitorConfig = read("capacitor.config.ts");
    expect(variables).toMatch(new RegExp(`minSdkVersion = ${profile.android.minSdk}\\b`));
    expect(variables).toMatch(new RegExp(`compileSdkVersion = ${profile.android.compileSdk}\\b`));
    expect(variables).toMatch(new RegExp(`targetSdkVersion = ${profile.android.targetSdk}\\b`));
    expect(appBuild).toContain(`applicationId "${profile.android.applicationId}"`);
    expect(capacitorConfig).toContain(`appId: "${profile.android.applicationId}"`);
    expect(read("package.json")).toContain(`"@capacitor/android": "${profile.android.capacitorVersion}"`);
  });

  it("keeps native policy narrow, offline, lifecycle-safe, and externally signed", () => {
    const manifest = read("android/app/src/main/AndroidManifest.xml");
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('android:usesCleartextTraffic="false"');
    expect(manifest).toContain('android:screenOrientation="user"');
    expect(manifest).toContain('android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation|density"');
    expect(manifest.match(/<uses-permission\b/g)).toHaveLength(1);
    expect(manifest).toContain('android.permission.INTERNET');

    const activity = read("android/app/src/main/java/dev/aico8/research/MainActivity.java");
    expect(activity).toContain("implements AudioManager.OnAudioFocusChangeListener");
    expect(activity).toContain("AudioAttributes.USAGE_GAME");
    expect(activity).toContain("aico8:audio-focus");
    expect(activity).toContain("public void onResume()");
    expect(activity).toContain("public void onPause()");
    expect(activity).toContain("requestGameAudioFocus();");
    expect(activity).toContain("abandonGameAudioFocus();");

    const appBuild = read("android/app/build.gradle");
    for (const variable of [
      "AICO8_ANDROID_KEYSTORE",
      "AICO8_ANDROID_KEYSTORE_PASSWORD",
      "AICO8_ANDROID_KEY_ALIAS",
      "AICO8_ANDROID_KEY_PASSWORD",
    ]) expect(appBuild).toContain(variable);
    expect(appBuild).toContain("Release packaging requires external");
    expect(appBuild).not.toMatch(/storePassword\s+["'][^$]/);
    expect(appBuild).not.toMatch(/keyPassword\s+["'][^$]/);

    const lifecycleTest = read("android/app/src/androidTest/java/dev/aico8/research/MainActivityLifecycleTest.java");
    expect(lifecycleTest).toContain("ActivityScenario.launch(MainActivity.class)");
    expect(lifecycleTest).toContain("Lifecycle.State.STARTED");
    expect(lifecycleTest).toContain("Lifecycle.State.RESUMED");

    const squareTest = read("android/app/src/androidTest/java/dev/aico8/research/SquareEmulatorAcceptanceTest.java");
    expect(squareTest).toContain("SQUARE_EDGE_PX = 1024");
    expect(squareTest).toContain("location.hostname === 'localhost'");
    expect(squareTest).toContain("localStorage.setItem('aico8-square-acceptance'");
    expect(squareTest).toContain("onView(isAssignableFrom(WebView.class)).perform(click())");

    const emulatorRunner = read("../../scripts/run-android-square-emulator.sh");
    expect(emulatorRunner).toContain('profile_id="aico8-square-api35"');
    expect(emulatorRunner).toContain("adb shell wm size 1024x1024");
    expect(emulatorRunner).toContain("adb shell cmd connectivity airplane-mode enable");
    expect(emulatorRunner).toContain("dev.aico8.research.test/androidx.test.runner.AndroidJUnitRunner");
  });

  it("pins Capacitor-generated Java and Gradle toolchain inputs", () => {
    const capacitorBuild = read("android/app/capacitor.build.gradle");
    expect(capacitorBuild).toContain("JavaVersion.VERSION_21");
    const wrapper = read("android/gradle/wrapper/gradle-wrapper.properties");
    expect(wrapper).toContain("gradle-8.14.3-all.zip");
    const settings = read("android/capacitor.settings.gradle");
    expect(settings).toContain(`@capacitor+android@${profile.android.capacitorVersion}`);
    expect(settings).toContain("@capacitor+app@8.1.1");
  });
});
