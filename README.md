# Blendy Studio

Apps built by **Blendy Studio (MK)**. 

## Projects

### 🎬 MK-Flix (Android) — v1.3.0
An Android app, powered by CineJoy, that wraps [cinejoy.pk](https://cinejoy.pk/)
in a fullscreen WebView shell: fullscreen video support, file downloads, adaptive app icon
(with Android 13+ themed-icon support), built-in ad/tracker blocker.

- Package: `com.w2a.um1c`
- Latest source: [`mk-flix-app/`](./mk-flix-app/)
- Snapshot of the last CineJoy-branded release: [`cinejoy-v1.2.7/`](./cinejoy-v1.2.7/)
- Build: run `build-apk.sh` inside the project folder (builds with the
  Android SDK tools directly), or open in Android Studio (compileSdk 34,
  Java 17)

### 🖥️ MK-Flix Desktop (Windows and Linux) — v1.3.0
Electron wrapper for the same site: portable Windows `.exe` (no installer)
and an Ubuntu/Debian `.deb`,
built-in ad/tracker blocker, popup-ad lockdown.

- Source: [`mk-flix-desktop/`](./mk-flix-desktop/)
- Installable zip: published via GitHub Releases (attached manually in the
  GitHub web UI)

## Branding

The app icon's master artwork is [`branding/mkflix-icon-1024.png`](./branding/).
Every icon size for both apps (Windows `.ico`, Linux `.png`, Android launcher,
round, adaptive and themed icons) is generated from it:

```sh
python3 branding/make-icons.py   # needs Pillow
```

## Releases

### 🎬 MK-Flix v1.3.0 (Android)
- Source: [`mk-flix-app/`](./mk-flix-app/)
- Installable APK: build it (see above) and attach it to a GitHub Release.

### 🎬 CineJoy v1.2.7 (Android, before the MK-Flix rename)
- Source snapshot: [`cinejoy-v1.2.7/`](./cinejoy-v1.2.7/)
- Installable APK: published through GitHub Releases — create the release in
  the GitHub web UI and attach the v1.2.7 APK there (the connected GitHub app
  can't publish releases or upload binary files itself).

### 🖥️ MK-Flix Desktop v1.3.0 (Windows)
- Source: [`mk-flix-desktop/`](./mk-flix-desktop/)
- Build the zip with `npm run dist-win` in `mk-flix-desktop/`, and the
  Linux package (`MK-Flix_1.3.0_amd64.deb`) with `npm run dist-linux`.
- Installable zip (`MK-Flix-Windows-x64.zip`, includes `how-to-install.txt`): attached to a GitHub Release
  created manually in the GitHub web UI.

---

_Built with care by Maina Kimani 🤖_
