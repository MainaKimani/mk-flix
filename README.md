# Blendy Studio

Apps built by **Blendy Studio (MK)**.

## 🎬 MK-Flix — v1.3.0

_MK-Flix: Powered by CineJoy. NutFlix just got better 😉_

MK-Flix is an Android and desktop app for watching [cinejoy.pk](https://cinejoy.pk/)
in its own fullscreen window, without the ads and pop-ups.

### Download

Latest release: **[v1.3.0](https://github.com/MainaKimani/mk-flix/releases/tag/v1.3.0)**

| Platform | Download | How to install |
|---|---|---|
| Android 7.0+ | [MK-Flix_1.3.0.apk](https://github.com/MainaKimani/mk-flix/releases/download/v1.3.0/MK-Flix_1.3.0.apk) | Open the file on your phone and allow installing from that source when asked. |
| Windows 10/11 (64-bit) | [MK-Flix-Windows-x64.zip](https://github.com/MainaKimani/mk-flix/releases/download/v1.3.0/MK-Flix-Windows-x64.zip) | Extract the zip and run `MK-Flix.exe`. Step-by-step guide inside: `how-to-install.txt`. |
| Ubuntu/Debian (64-bit) | [MK-Flix_1.3.0_amd64.deb](https://github.com/MainaKimani/mk-flix/releases/download/v1.3.0/MK-Flix_1.3.0_amd64.deb) | `sudo apt install ./MK-Flix_1.3.0_amd64.deb`, then open MK-Flix from your apps menu. |

- **Upgrading from CineJoy on Android:** uninstall the CineJoy app first.
  MK-Flix is signed with a new key, so Android won't install it over CineJoy.
- **Windows "Windows protected your PC" warning:** the app isn't code-signed
  yet. Click **More info**, then **Run anyway** (only needed once).

### Features

- **Ad and tracker blocking.** Requests to known ad and tracking hosts are
  dropped before they load.
- **No pop-up ads.** On desktop, only cinejoy.pk can open windows, and ad
  scripts can't send the page off to another site; trailers on YouTube or
  Vimeo open in your browser.
- **Fullscreen video.** Rotates to landscape on phones; Back or Esc to leave.
- **MK-Flix branding on the site.** The site's logo (in the header and on the
  video loading screen) and its footer are replaced with MK-Flix's, without
  a flash of the old logo.
- **Clear errors.** If cinejoy.pk can't load (offline, or a network that
  blocks it), you get an explanation and a Retry button instead of a blank
  screen. It retries by itself when you reconnect.
- **Downloads** on Android go to your Downloads folder.
- **Locked-down permissions** on desktop: pages get fullscreen and nothing
  else (no notifications, location, camera or microphone).

### Repository layout

| Folder | What it is |
|---|---|
| [`mk-flix-app/`](./mk-flix-app/) | Android app (Java, WebView). See its [README](./mk-flix-app/README.md). |
| [`mk-flix-desktop/`](./mk-flix-desktop/) | Windows and Linux app (Electron). See its [README](./mk-flix-desktop/README.md). |
| [`branding/`](./branding/) | Icon master artwork and the script that generates every icon. |
| [`cinejoy-v1.2.7/`](./cinejoy-v1.2.7/) | Snapshot of the last release under the CineJoy name, kept for reference. |

The two apps share a few files that must stay identical between
`mk-flix-desktop/` and `mk-flix-app/app/src/main/assets/`: `error.html`,
`mkflix-footer.js`, `mkflix-logo.css` and `adblock-hosts.txt`.

### Building

- **Android:** open `mk-flix-app/` in Android Studio, or see the
  [Android README](./mk-flix-app/README.md) for command-line and signed
  release builds.
- **Desktop:** Node.js 22.12+, then `npm install` and `npm run dist-win` /
  `npm run dist-linux` in `mk-flix-desktop/`. Details in the
  [desktop README](./mk-flix-desktop/README.md).

## Branding

The app icon's master artwork is [`branding/mkflix-icon-1024.png`](./branding/).
Every icon size for both apps (Windows `.ico`, Linux `.png`, Android launcher,
round, adaptive and themed icons) and the in-page logo replacement are
generated from it:

```sh
python3 branding/make-icons.py   # needs Pillow
```

## Releases

### v1.3.0 — MK-Flix
[Release page and downloads](https://github.com/MainaKimani/mk-flix/releases/tag/v1.3.0)

- Renamed from CineJoy to MK-Flix, with a new icon and MK-Flix branding on
  the site (logo, loading screen, footer).
- New: Ubuntu/Debian `.deb` build alongside Windows.
- New: error screen with Retry in both apps.
- Android: fixed a crash on Android 7 when leaving fullscreen video, the
  screen getting stuck in portrait, downloads failing (Android 7–9 and
  signed-in downloads), and links to other apps being ignored on
  Android 11+. Web pages can no longer open arbitrary parts of other apps.
- Desktop: upgraded to Electron 45; locked down permissions, pop-ups and
  navigation.
- Android builds are now signed with a dedicated release key.

### v1.2.7 — CineJoy
The last release under the CineJoy name. Source snapshot:
[`cinejoy-v1.2.7/`](./cinejoy-v1.2.7/).

---

_Built with care by Maina Kimani 🤖_
