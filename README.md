# 🎬 Blendy Play

App built by **Blendy Studio (MK)**.

## 🎬 Blendy Play — v1.5.0

Blendy Play is an Android, Android TV and desktop app for watching films and
shows in their own fullscreen window, without the ads and pop-ups.

### Download

Get the latest version from the **[Blendy Play website](https://blendy.mainakimani.com/#download)**.

| Platform | How to install |
|---|---|
| Android 7.0+ and Android TV / Google TV | Phone: open the APK and allow installing from that source when asked. TV: use the Downloader app or `adb` ([how](./mk-flix-app/README.md#installing)). |
| Windows 10/11 (64-bit) | Run `Blendy-Play-Setup-1.5.0.exe`. If Windows warns you, choose **More info**, then **Run anyway** (the app isn't code-signed yet). |
| Ubuntu/Debian (64-bit) | `sudo apt install ./Blendy-Play_1.5.0_amd64.deb`, then open Blendy Play from your apps menu. |

Once installed, the apps update themselves: at launch they check for a new
version and offer to install it.

### Features

- **Your Blendy Play account.** Sign up with your email (confirmed with a
  4-digit code), reset a forgotten password, and manage your account at
  [blendy.mainakimani.com](https://blendy.mainakimani.com/).
- **Subscriptions with M-Pesa.** Choose a weekly or monthly plan and approve
  the M-Pesa prompt on your phone. Browsing is free; playing needs an active
  subscription. Nothing renews automatically.
- **Ad and tracker blocking.** Requests to known ad and tracking hosts are
  dropped before they load.
- **No pop-up ads.** Ad scripts can't open windows or send the page off to
  another site; trailers on YouTube or Vimeo open in your browser.
- **Fullscreen video.** Rotates to landscape on phones; Back or Esc to leave.
- **Clear errors.** If the listing can't load (offline, or a network that
  blocks it), you get an explanation and a Retry button instead of a blank
  screen. It retries by itself when you reconnect.
- **Downloads** on Android go to your Downloads folder.
- **Locked-down permissions** on desktop: pages get fullscreen and nothing
  else (no notifications, location, camera or microphone).
- **Android TV / Google TV.** The same Android app runs on TVs, with its own
  banner on the home screen. Use the remote's arrows to move a highlight
  between posters and buttons and OK to open them. Films start by
  themselves with the player's controls hidden; any key shows them, and
  they hide again after 10 seconds. Hold OK for a pointer you steer with
  the arrows, for anything the highlight can't reach.

### Repository layout

| Folder | What it is |
|---|---|
| [`mk-flix-app/`](./mk-flix-app/) | Android app (Java, WebView). See its [README](./mk-flix-app/README.md). |
| [`mk-flix-desktop/`](./mk-flix-desktop/) | Windows and Linux app (Electron). See its [README](./mk-flix-desktop/README.md). |
| [`release/`](./release/) | Packaging, signing and publishing a release. See its [README](./release/README.md). |
| [`branding/`](./branding/) | Icon master artwork and the script that generates every icon. |
| [`docs/`](./docs/) | The Terms and Conditions draft. |
| [`cinejoy-v1.2.7/`](./cinejoy-v1.2.7/) | Snapshot of the app's first version, kept for reference. |

The two apps share a few files that must stay identical between
`mk-flix-desktop/` and `mk-flix-app/app/src/main/assets/`: `error.html`,
`mkflix-footer.js`, `mkflix-logo.css`, `adblock-hosts.txt` and
`mkflix-account.html`.

### Building

- **Android:** open `mk-flix-app/` in Android Studio, or see the
  [Android README](./mk-flix-app/README.md) for command-line builds.
- **Desktop:** Node.js 22.12+, then `npm install` and `npm run dist-win` /
  `npm run dist-linux` in `mk-flix-desktop/`. Details in the
  [desktop README](./mk-flix-desktop/README.md).
- **Releases:** see [`release/README.md`](./release/README.md).

## Branding

The app icon's master artwork is in [`branding/`](./branding/). Every icon
size for both apps (Windows `.ico`, Linux `.png`, Android launcher, round,
adaptive and themed icons) and the in-page logo replacement are generated
from it:

```sh
python3 branding/make-icons.py   # needs Pillow
```

## Releases

### v1.5.0

The first release as Blendy Play. Download it from the
[website](https://blendy.mainakimani.com/#download).

- New name, icon and app identity. Blendy Play installs alongside MK-Flix
  rather than over it.
- New: Blendy Play accounts, with email confirmation and password reset.
- New: weekly (KES 119) and monthly (KES 359) subscriptions paid with M-Pesa.
- New: the apps update themselves from signed releases.
- Android TV: films start by themselves, with the controls hidden until you
  press a key.
- Sign-up and plan screens scroll on small screens.

---

_Built with care by Maina Kimani 🤖_
