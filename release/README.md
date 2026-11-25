# Releasing Blendy Play

Releases are downloaded from `https://blendy.mainakimani.com/downloads/`,
and the apps update themselves from the same place:

```
downloads/
  releases.json          the release manifest (what's latest, what's required)
  releases.json.sig      its signature
  1.5.0/
    Blendy-Play_1.5.0.apk
    Blendy-Play-Setup-1.5.0.exe
    Blendy-Play_1.5.0_amd64.deb
```

Only the latest version is kept: once a new release is live, its previous
version folder is deleted (step 5 below).

At launch, each app downloads `releases.json` and `releases.json.sig` and
checks the signature against the public key built into it
(`release/manifest-public-key.pem`). If its version is older than the latest
it shows **Update available** (Update now / Later); if it's older than
`minimum_version` it shows **Update required**, with no way past. Downloads
are checked against the SHA-256 in the manifest before anything is installed.

- **Android** downloads the APK and opens Android's installer; the user
  confirms. The first time, Android asks to allow Blendy Play to install apps.
- **Windows** downloads the installer, runs it silently, and Blendy Play
  restarts on the new version.
- **Linux** downloads the `.deb` and opens it in the system's software
  installer.

## Keys (keep them safe, outside the repo)

| What | Where | If it's lost |
|---|---|---|
| Manifest signing key | `~/.config/blendy-release/manifest-signing-key.pem` | No installed app will ever accept another update. |
| Android release keystore | `~/keys/blendy-play-release.jks`, password in `~/.gradle/gradle.properties` (`BLENDY_RELEASE_*`) | Android refuses every later APK as an update. |

Back both up somewhere encrypted. Neither may ever be replaced: the apps
hold the manifest's public key, and Android remembers the APK's signer.

## Release checklist

1. **Bump the version** to the same value in both places:
   - `mk-flix-desktop/package.json` → `"version"`
   - `mk-flix-app/app/build.gradle.kts` → `versionName`, and a **higher**
     `versionCode` (e.g. 1.5.0 → 150)
2. **Build**:
   ```sh
   cd mk-flix-app && BUILD_TOOLS_VERSION=36.0.0 ANDROID_HOME=~/Android/Sdk \
     JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./build-apk.sh
   cd ../mk-flix-desktop && npm run dist-win && npm run dist-linux
   ```
   `dist-win` builds the Windows installer and needs Wine on Linux,
   including its 32-bit part (`wine32`). If that can't be installed, build
   it in a container instead (see "Windows without wine32" below).
3. **Package and sign**, from the repo root:
   ```sh
   node release/publish.mjs --notes "What changed, in a sentence" --notes "Another change"
   ```
   Add `--min 1.5.0` (or `--min-android`, `--min-windows`, `--min-linux`) to
   **require** everyone below that version to update. Leave it out for an
   optional update. The APK is signed here with the release key; the tool
   refuses an APK with the wrong key, package or version.
4. **Upload** `release/out/downloads/` to the server's `downloads/` folder:
   the new version folder first, then `releases.json` and
   `releases.json.sig` last, so no app sees the new version before its files
   are there.
5. **Delete the previous version's folder** from `downloads/` (e.g. `1.4.0/`)
   once the new manifest is up: nothing points at it any more. Only the
   latest version is offered.
6. If you set a minimum, set the same one on the backend
   (`MIN_APP_VERSION_ANDROID` / `_WINDOWS` / `_LINUX` in `mk-flix-be/.env`):
   apps that don't check the manifest then get `426` from the API and show
   **Update required** too.

## Releasing one platform only

When only one app changed, release just that one and leave the others as
they are. Download the live `releases.json` and `releases.json.sig` from
`downloads/`, then bump only that app's version and build it:

```sh
node release/publish.mjs --notes "..." \
  --keep windows --keep linux --previous path/to/releases.json
```

`--keep` copies a platform's entry from the live manifest unchanged, after
checking its signature, so those apps see no update and their download
still points at the older version's folder. **Don't delete that folder**
in step 5: only remove the files of the platform you released. (`--skip`
is different: it leaves the platform out of the manifest, and its
download disappears from the website.)

## Windows without wine32

electron-builder runs a 32-bit Windows program through Wine while it builds
the installer, so a 64-bit-only Wine fails with
`wine: failed to load ...\syswow64\ntdll.dll`. Installing `wine32` can be
impossible when another source (such as a PHP PPA) holds a newer 64-bit
library than Ubuntu's 32-bit one; apt then offers to remove half the desktop.
Don't accept that. Build in electron-builder's own image instead (about 5 GB
of disk, downloaded once), with podman or docker:

```sh
cd mk-flix-desktop
podman run --rm -v "$PWD":/project:Z \
  -v ~/.cache/electron:/root/.cache/electron:Z \
  -v ~/.cache/electron-builder:/root/.cache/electron-builder:Z \
  -w /project docker.io/electronuserland/builder:wine \
  npx electron-builder --win nsis --x64
```

The installer lands in `mk-flix-desktop/dist/` as usual. `mkflix-config.json`
must hold an empty `apiBase` while building, as for every release build.
Remove the image afterwards with `podman rmi electronuserland/builder:wine`
if disk space is short.

## Testing an update locally

Point an app at a local manifest with `updateUrl` in its `mkflix-config.json`
(or `MKFLIX_UPDATE_URL` for the desktop app), e.g.
`http://localhost:8765/downloads/releases.json`, and serve a folder made by
`publish.mjs --out`. Plain `http` is only accepted for `localhost`.
