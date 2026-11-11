# 🖥️ CineJoy Desktop — Windows app

Electron-based desktop client for [cinejoy.pk](https://cinejoy.pk/).
Portable Windows (x64) build — unzip and run, no installer needed.

## Contents

- `main.js` — app entry point: window setup, ad/tracker blocking, popup policy
- `package.json` — project metadata and dev dependencies
- `adblock-hosts.txt` — ad/tracker host blocklist (shared with the Android app)
- `icon.ico` — app icon (16–256 px), made from the Android launcher artwork

## Popup policy

The app is a dedicated CineJoy client, so popups are locked down: only
cinejoy.pk opens new windows. Blocklisted ad hosts and background popunders
are denied silently. Only a genuine foreground trailer link (YouTube/Vimeo)
opens in the default browser.

The same rules apply to every window the app opens, and to the page itself:
a script that tries to send the whole window to another site is stopped
(YouTube/Vimeo go to the default browser instead). Embedded players inside
the page are not affected.

## Permissions

Web content gets fullscreen and nothing else. Notifications, location,
camera, microphone and similar requests are refused automatically —
Electron would otherwise grant them all without asking.

## Build

Requires Node.js 22.12 or newer (`.nvmrc` pins 22, so `nvm use` picks it).
Node is only needed for installing and packaging; the app runs on the
Node built into Electron.

```sh
npm install
npm start               # run locally
npm run package-win     # build the Windows app into dist/
```

Notes:
- `@electron/packager` needs Wine on Linux to stamp the exe icon via rcedit.
  Alternative used here: assemble the win32 Electron dist manually and embed
  the icon plus version metadata with `resedit-cli` (pure JS, no Wine).
- `main.js` only uses Electron/Node built-ins, so the packaged app needs no
  `node_modules`. It does need `mkflix-footer.js` and `adblock-hosts.txt`
  next to it.
- On Ubuntu 24.04 and other distros that restrict unprivileged user
  namespaces, `npm start` aborts with a SUID sandbox error. Fix it after
  each install that downloads a new Electron:

  ```sh
  sudo chown root:root node_modules/electron/dist/chrome-sandbox
  sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
  ```

## Releases

Installable zips (`CineJoy-Windows-x64.zip`) are published through GitHub
Releases, created manually in the GitHub web UI.
