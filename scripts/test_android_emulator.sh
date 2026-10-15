#!/usr/bin/env bash
set -euo pipefail

echo "Checking Android emulator boot..."
adb wait-for-device

booted="$(adb shell getprop sys.boot_completed | tr -d '\r')"
if [[ "$booted" != "1" ]]; then
  echo "ERROR: Android emulator did not report boot completion."
  exit 1
fi

echo "Emulator booted successfully."
echo "Android API level: $(adb shell getprop ro.build.version.sdk | tr -d '\r')"
echo "CPU ABI: $(adb shell getprop ro.product.cpu.abi | tr -d '\r')"
echo "ADB devices:"
adb devices -l

# No third-party app install, RBFA account, API request, screenshots,
# personal data capture, or logcat upload in this smoke test.
