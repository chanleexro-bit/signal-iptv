#!/usr/bin/env bash
# Builds Signal IPTV for Android.
#   scripts/build-android.sh full   → SignalIPTV.apk (GitHub download)
#   scripts/build-android.sh play   → SignalIPTV-play.aab (Google Play)
# Signing: set KS_B64 (base64 of the upload keystore) and KS_PASS. Without them the APK is debug-signed.
# Versions: VERSION_CODE and VERSION_NAME.
set -euo pipefail
EDITION="${1:-full}"
cd "$(dirname "$0")/.."

npm install --no-audit --no-fund
cp node_modules/hls.js/dist/hls.min.js www/hls.min.js
if [ "$EDITION" = "play" ]; then node scripts/play-variant.js www; fi

rm -rf android
npx cap add android
npx capacitor-assets generate --android \
  --iconBackgroundColor '#0e1014' --iconBackgroundColorDark '#0e1014' \
  --splashBackgroundColor '#0e1014' --splashBackgroundColorDark '#0e1014'
npx cap sync android
node scripts/patch-android.js
echo "--- plugins ---"; cat android/app/src/main/assets/capacitor.plugins.json; echo

SIGNED=false
if [ -n "${KS_B64:-}" ] && [ -n "${KS_PASS:-}" ]; then
  echo "$KS_B64" | base64 -d > android/app/upload.jks
  cat >> android/app/build.gradle <<'GRADLE'

android {
    signingConfigs {
        upload {
            storeFile file('upload.jks')
            storePassword System.getenv('KS_PASS')
            keyAlias 'upload'
            keyPassword System.getenv('KS_PASS')
        }
    }
    buildTypes {
        release { signingConfig signingConfigs.upload }
    }
}
GRADLE
  SIGNED=true
fi

cd android
chmod +x gradlew
if [ "$EDITION" = "play" ]; then
  [ "$SIGNED" = true ] || { echo "Play bundle needs the upload key (KS_B64, KS_PASS)"; exit 1; }
  ./gradlew bundleRelease --no-daemon --stacktrace
  cp app/build/outputs/bundle/release/app-release.aab ../SignalIPTV-play.aab
elif [ "$SIGNED" = true ]; then
  ./gradlew assembleRelease --no-daemon --stacktrace
  cp app/build/outputs/apk/release/app-release.apk ../SignalIPTV.apk
else
  ./gradlew assembleDebug --no-daemon --stacktrace
  cp app/build/outputs/apk/debug/app-debug.apk ../SignalIPTV.apk
fi
rm -f app/upload.jks
echo "Built $EDITION edition (signed: $SIGNED)"
