#!/bin/bash
# build-win.sh — build the portable Windows app and zip it for release.
# Output: dist/MK-Flix-Windows-x64.zip, holding an "MK-Flix" folder with
# MK-Flix.exe and how-to-install.txt. Runs on Linux or macOS; no Wine
# needed (@electron/packager stamps the icon and version with resedit).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

npm run package-win

STAGE="dist/zip-stage"
rm -rf "$STAGE" dist/MK-Flix-Windows-x64.zip
mkdir -p "$STAGE"
cp -r dist/MK-Flix-win32-x64 "$STAGE/MK-Flix"
cp how-to-install.txt "$STAGE/MK-Flix/"
# Windows Notepad copes with LF, but CRLF keeps older viewers happy.
sed -i 's/$/\r/' "$STAGE/MK-Flix/how-to-install.txt"
(cd "$STAGE" && zip -qr -9 ../MK-Flix-Windows-x64.zip MK-Flix)
rm -rf "$STAGE"

echo "Ready: $(pwd)/dist/MK-Flix-Windows-x64.zip"
ls -lh dist/MK-Flix-Windows-x64.zip
