#!/usr/bin/env bash
set -euo pipefail

PACKAGE="be.rbfa"
echo "Checking Google Play availability in the Android emulator..."
adb wait-for-device
adb shell pm path com.android.vending >/dev/null || {
  echo "ERROR: Google Play Store is not installed in this emulator image."
  exit 1
}
echo "PASS: Google Play Store is installed."

echo "Opening the official RBFA Google Play listing (package: ${PACKAGE})..."
adb shell am start -a android.intent.action.VIEW \
  -d "market://details?id=${PACKAGE}" \
  -p com.android.vending

sleep 10
echo "Current foreground window (diagnostic only):"
adb shell dumpsys window | grep -E 'mCurrentFocus|mFocusedApp' || true

if adb shell pm path "${PACKAGE}" >/dev/null 2>&1; then
  echo "PASS: RBFA app already installed; testing launch."
  adb shell monkey -p "${PACKAGE}" -c android.intent.category.LAUNCHER 1
else
  echo "RESULT: RBFA is not installed."
  echo "The listing was opened, but installing an app from Google Play may require"
  echo "a signed-in Google account and manual interaction."
  echo "No Google account login, third-party APK download, or security bypass attempted."
fi

echo "Completed Play Store readiness test."
