#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <debug-apk> <android-test-apk>" >&2
  exit 2
fi

: "${ANDROID_HOME:?ANDROID_HOME is required}"

debug_apk="$1"
test_apk="$2"
profile_id="aico8-square-api35"
avd_name="aico8_square_api35"
evidence_dir="${AICO8_ANDROID_EMULATOR_EVIDENCE_DIR:-artifacts/test-reports/android-square-api35}"
emulator_log="$evidence_dir/emulator.log"

mkdir -p "$evidence_dir"
evidence_dir="$(cd "$evidence_dir" && pwd)"
emulator_log="$evidence_dir/emulator.log"
{
  echo "profile_id=$profile_id"
  echo "avd_name=$avd_name"
  echo "status=bootstrap"
} > "$evidence_dir/bootstrap.txt"
test -f "$debug_apk"
test -f "$test_apk"

echo "no" | avdmanager create avd \
  --force \
  --name "$avd_name" \
  --package "system-images;android-35;google_apis;x86_64" \
  --device "pixel_2"

avd_path="$(
  avdmanager list avd | awk -v wanted="$avd_name" '
    $1 == "Name:" { selected = ($2 == wanted) }
    selected && $1 == "Path:" { print $2; exit }
  '
)"
if [[ -z "$avd_path" || ! -f "$avd_path/config.ini" ]]; then
  echo "Unable to resolve the created AVD path" >&2
  avdmanager list avd | tee "$evidence_dir/avd-list.txt" >&2
  exit 1
fi
export ANDROID_AVD_HOME="$(dirname "$avd_path")"
avd_config="$avd_path/config.ini"
printf '%s\n' \
  'hw.lcd.width=1024' \
  'hw.lcd.height=1024' \
  'hw.lcd.density=320' \
  'hw.keyboard=yes' \
  'showDeviceFrame=no' >> "$avd_config"

"$ANDROID_HOME/emulator/emulator" "@$avd_name" \
  -no-window \
  -no-audio \
  -no-boot-anim \
  -no-snapshot \
  -wipe-data \
  -gpu swiftshader_indirect \
  -camera-back none \
  -camera-front none > "$emulator_log" 2>&1 &
emulator_pid=$!

cleanup() {
  adb emu kill >/dev/null 2>&1 || true
  wait "$emulator_pid" >/dev/null 2>&1 || true
}
trap cleanup EXIT

booted=""
for _ in $(seq 1 180); do
  if ! kill -0 "$emulator_pid" 2>/dev/null; then
    echo "Android emulator exited before boot" >&2
    tail -n 120 "$emulator_log" >&2
    exit 1
  fi
  booted="$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
  if [[ "$booted" == "1" ]]; then break; fi
  sleep 1
done
if [[ "$booted" != "1" ]]; then
  echo "Android emulator did not boot within 180 seconds" >&2
  tail -n 120 "$emulator_log" >&2
  exit 1
fi

adb shell settings put system accelerometer_rotation 0
adb shell wm size 1024x1024
adb shell wm density 320
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard || true
adb shell locksettings set-disabled true || true
adb shell svc power stayon true
adb shell settings put system screen_off_timeout 2147483647
adb shell cmd connectivity airplane-mode enable || true
adb shell svc wifi disable || true
adb shell svc data disable || true

wm_size="$(adb shell wm size | tr -d '\r')"
wm_density="$(adb shell wm density | tr -d '\r')"
api_level="$(adb shell getprop ro.build.version.sdk | tr -d '\r')"
adb shell dumpsys power > "$evidence_dir/power-state.txt"
adb shell dumpsys window policy > "$evidence_dir/keyguard-state.txt"
if [[ "$wm_size" != *"1024x1024"* ]]; then
  echo "Square display override was not applied: $wm_size" >&2
  exit 1
fi
if [[ "$api_level" != "35" ]]; then
  echo "Expected API 35 emulator, found API $api_level" >&2
  exit 1
fi
if ! grep -q 'mWakefulness=Awake' "$evidence_dir/power-state.txt"; then
  echo "Square emulator is not awake; sustained rendering evidence would be invalid" >&2
  exit 1
fi

adb install -r "$debug_apk"
adb install -r "$test_apk"
adb logcat -c

set +e
adb shell am instrument -w -r \
  -e notClass dev.aico8.research.SquareEmulatorPerformanceTest \
  dev.aico8.research.test/androidx.test.runner.AndroidJUnitRunner \
  | tee "$evidence_dir/instrumentation.txt"
instrumentation_process_status=${PIPESTATUS[0]}
set -e

instrumentation_outcome="failed"
if [[ $instrumentation_process_status -eq 0 ]] \
  && grep -Eq '^OK \([1-9][0-9]* tests?\)$' "$evidence_dir/instrumentation.txt" \
  && ! grep -q '^FAILURES!!!' "$evidence_dir/instrumentation.txt"; then
  instrumentation_outcome="passed"
fi

set +e
adb shell am instrument -w -r \
  -e class dev.aico8.research.SquareEmulatorPerformanceTest \
  dev.aico8.research.test/androidx.test.runner.AndroidJUnitRunner \
  | tee "$evidence_dir/performance-instrumentation.txt"
performance_process_status=${PIPESTATUS[0]}
set -e
performance_outcome="failed"
if [[ $performance_process_status -eq 0 ]] \
  && grep -Eq '^OK \(1 test\)$' "$evidence_dir/performance-instrumentation.txt" \
  && ! grep -q '^FAILURES!!!' "$evidence_dir/performance-instrumentation.txt"; then
  performance_outcome="passed"
fi
set +e
adb exec-out run-as dev.aico8.research \
  cat files/emulator-frame-durations.csv > "$evidence_dir/emulator-frame-durations.csv"
frame_evidence_status=$?
adb exec-out run-as dev.aico8.research \
  cat files/emulator-animation-summary.txt > "$evidence_dir/emulator-animation-summary.txt"
animation_summary_status=$?
set -e

if [[ "$instrumentation_outcome" == "passed" ]]; then
  adb exec-out run-as dev.aico8.research \
    cat files/square-host.png > "$evidence_dir/square-host.png"
  file "$evidence_dir/square-host.png" | tee "$evidence_dir/square-host-file.txt"
  if ! grep -q 'PNG image data, 1024 x 1024' "$evidence_dir/square-host-file.txt"; then
    echo "Ready-host screenshot is not the expected 1024x1024 PNG" >&2
    exit 1
  fi
fi

# The instrumentation result and the lineage-bound 1024-square screenshot are
# the acceptance boundary. These commands collect post-acceptance diagnostics;
# an adb transport closing while logcat drains must remain visible in evidence,
# but must not relabel successful functional instrumentation tests as a product
# failure.
set +e
adb shell am start -W -n dev.aico8.research/.MainActivity > "$evidence_dir/host-launch.txt"
host_launch_status=$?
sleep 3

adb shell dumpsys window displays > "$evidence_dir/window-displays.txt"
window_displays_status=$?
adb shell dumpsys activity activities > "$evidence_dir/activities.txt"
activities_status=$?
adb logcat -d -v threadtime > "$evidence_dir/logcat.txt"
logcat_status=$?
set -e

rm -f "$evidence_dir/performance.json"
set +e
pnpm --filter @aico8/mobile verify:emulator-performance -- \
  "$PWD/apps/mobile/target-profile.json" \
  "$evidence_dir/emulator-frame-durations.csv" \
  "$evidence_dir/host-launch.txt" \
  60 \
  "$profile_id" \
  "$evidence_dir/performance.json" \
  > "$evidence_dir/performance-verifier.txt" 2>&1
performance_verifier_status=$?
set -e
performance_budget_outcome="failed"
if [[ $performance_verifier_status -eq 0 ]]; then
  performance_budget_outcome="passed"
fi

diagnostics_outcome="complete"
if [[ $host_launch_status -ne 0 || $window_displays_status -ne 0 \
  || $activities_status -ne 0 || $logcat_status -ne 0 ]]; then
  diagnostics_outcome="partial"
fi
{
  echo "profile_id=$profile_id"
  echo "avd_name=$avd_name"
  echo "avd_home=$ANDROID_AVD_HOME"
  echo "api_level=$api_level"
  echo "wm_size=$wm_size"
  echo "wm_density=$wm_density"
  echo "network_mode=airplane-wifi-off-data-off"
  echo "instrumentation_process_status=$instrumentation_process_status"
  echo "instrumentation_outcome=$instrumentation_outcome"
  echo "performance_instrumentation_process_status=$performance_process_status"
  echo "performance_instrumentation_outcome=$performance_outcome"
  echo "frame_evidence_status=$frame_evidence_status"
  echo "animation_summary_status=$animation_summary_status"
  echo "performance_verifier_status=$performance_verifier_status"
  echo "performance_budget_outcome=$performance_budget_outcome"
  echo "diagnostics_outcome=$diagnostics_outcome"
  echo "host_launch_status=$host_launch_status"
  echo "window_displays_status=$window_displays_status"
  echo "activities_status=$activities_status"
  echo "logcat_status=$logcat_status"
} > "$evidence_dir/device-profile.txt"

if [[ "$instrumentation_outcome" != "passed" \
  || "$performance_outcome" != "passed" \
  || $frame_evidence_status -ne 0 \
  || $animation_summary_status -ne 0 \
  || "$performance_budget_outcome" != "passed" ]]; then
  exit 1
fi

exit 0
