#!/bin/bash
# build-apk.sh — manual debug APK build for Blendy Play (for machines without Gradle;
# so this drives the official SDK build-tools directly: aapt2 -> javac -> d8 -> zipalign -> apksigner)
#
# Paths can be overridden: ANDROID_HOME (SDK), JAVA_HOME (JDK 17+).
# Package name and version are read from app/build.gradle.kts so the two
# build paths can't drift apart.
set -euo pipefail

PROJ="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$PROJ/app"
SRC="$APP/src/main"
OUT="$APP/build/manual"
APK_OUT="$APP/build/outputs/apk/debug"
KEYSTORE="$PROJ/debug.keystore"

gradle_value() {
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*\"\{0,1\}\([^\"]*\)\"\{0,1\}[[:space:]]*$/\1/p" \
    "$APP/build.gradle.kts" | head -1
}
NAMESPACE="$(gradle_value namespace)"
PACKAGE="$(gradle_value applicationId)"
VERSION_CODE="$(gradle_value versionCode)"
VERSION_NAME="$(gradle_value versionName)"
if [ -z "$NAMESPACE" ] || [ -z "$PACKAGE" ] || [ -z "$VERSION_CODE" ] || [ -z "$VERSION_NAME" ]; then
  echo "Could not read namespace/applicationId/versionCode/versionName from app/build.gradle.kts" >&2
  exit 1
fi
echo "==> $PACKAGE $VERSION_NAME ($VERSION_CODE)"

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/android-sdk}}"
# BUILD_TOOLS_VERSION picks another installed build-tools (e.g. 36.0.0 where
# 34's d8 can't read the JDK's class files).
BT="$SDK/build-tools/${BUILD_TOOLS_VERSION:-34.0.0}"
PLATFORM="$SDK/platforms/android-34/android.jar"
export JAVA_HOME="${JAVA_HOME:-$HOME/jdk}"
export PATH="$JAVA_HOME/bin:$PATH"
for f in "$BT/aapt2" "$PLATFORM"; do
  [ -e "$f" ] || { echo "Missing $f — set ANDROID_HOME to your Android SDK" >&2; exit 1; }
done

mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex" "$APK_OUT"

# The source manifest has no package attribute (Gradle sets it from
# `namespace`), but aapt2 needs one, so link against a copy that has it.
# The namespace decides the R class package; applicationId is applied below.
sed "s|<manifest |<manifest package=\"$NAMESPACE\" |" "$SRC/AndroidManifest.xml" > "$OUT/AndroidManifest.xml"

echo "==> debug keystore"
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -keystore "$KEYSTORE" -alias androiddebugkey \
    -storepass android -keypass android -keyalg RSA -keysize 2048 -validity 10950 \
    -dname "CN=Android Debug,O=Android,C=US"
fi

echo "==> aapt2 compile (resources)"
"$BT/aapt2" compile --dir "$SRC/res" -o "$OUT/compiled_res.zip"

echo "==> aapt2 link"
LINK_ARGS=(-o "$OUT/base.apk"
  --manifest "$OUT/AndroidManifest.xml"
  -I "$PLATFORM"
  --java "$OUT/gen"
  --min-sdk-version 24 --target-sdk-version 34
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME")
[ "$PACKAGE" != "$NAMESPACE" ] && LINK_ARGS+=(--rename-manifest-package "$PACKAGE")
[ -d "$SRC/assets" ] && LINK_ARGS+=(-A "$SRC/assets")
"$BT/aapt2" link "${LINK_ARGS[@]}" "$OUT/compiled_res.zip"

echo "==> javac"
find "$SRC/java" "$OUT/gen" -name "*.java" > "$OUT/sources.txt"
if ! javac -source 17 -target 17 -cp "$PLATFORM" -d "$OUT/classes" @"$OUT/sources.txt" 2> "$OUT/javac.log"; then
  cat "$OUT/javac.log" >&2
  exit 1
fi
# Hide the expected warning about compiling against android.jar with -source.
grep -v -e "bootstrap class path" -e "system modules path" "$OUT/javac.log" || true

echo "==> d8 (dex)"
"$BT/d8" --lib "$PLATFORM" --min-api 24 --output "$OUT/dex" $(find "$OUT/classes" -name "*.class")

echo "==> insert classes.dex"
cp "$OUT/base.apk" "$OUT/app-unsigned.apk"
python3 - "$OUT/app-unsigned.apk" "$OUT/dex/classes.dex" <<'EOF'
import sys, zipfile
apk_path, dex_path = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(apk_path, 'a', zipfile.ZIP_STORED) as z:
    z.write(dex_path, 'classes.dex')
EOF

# release/publish.mjs signs $OUT/app-aligned.apk with the release key.
echo "==> zipalign + apksigner"
"$BT/zipalign" -f 4 "$OUT/app-unsigned.apk" "$OUT/app-aligned.apk"
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android \
  --out "$OUT/app-debug.apk" "$OUT/app-aligned.apk"

echo "==> verify"
"$BT/apksigner" verify "$OUT/app-debug.apk" && echo "SIGNATURE OK"
"$BT/aapt2" dump badging "$OUT/app-debug.apk" | head -6 || true

cp "$OUT/app-debug.apk" "$APK_OUT/app-debug.apk"
echo "APK ready: $APK_OUT/app-debug.apk"
ls -la "$APK_OUT/app-debug.apk"
