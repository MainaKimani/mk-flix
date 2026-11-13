#!/bin/bash
# build-win.sh — build the portable Windows app and zip it for release.
# Output: dist/Blendy-Play-Windows-x64.zip, holding a "Blendy Play" folder
# with "Blendy Play.exe" and how-to-install.txt. Runs on Linux or macOS; no
# Wine needed (@electron/packager stamps the icon and version with resedit).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

npm run package-win

APP="Blendy Play"
ZIP="dist/Blendy-Play-Windows-x64.zip"
STAGE="dist/zip-stage"
rm -rf "$STAGE" "$ZIP"
mkdir -p "$STAGE"
cp -r "dist/$APP-win32-x64" "$STAGE/$APP"
cp how-to-install.txt "$STAGE/$APP/"
# Windows Notepad copes with LF, but CRLF keeps older viewers happy.
sed -i 's/$/\r/' "$STAGE/$APP/how-to-install.txt"
(cd "$STAGE" && zip -qr -9 "../$(basename "$ZIP")" "$APP")
rm -rf "$STAGE"

echo "Ready: $(pwd)/$ZIP"
ls -lh "$ZIP"
