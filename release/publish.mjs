#!/usr/bin/env node
// Builds the files to upload for a Blendy Play release:
//
//   release/out/downloads/<version>/Blendy-Play_<version>.apk
//   release/out/downloads/<version>/Blendy-Play-Setup-<version>.exe
//   release/out/downloads/<version>/Blendy-Play_<version>_amd64.deb
//   release/out/downloads/releases.json      the manifest the apps and website read
//   release/out/downloads/releases.json.sig  its ECDSA P-256 signature
//
// Upload the <version>/ folder first and the two manifest files last, into
// the server's downloads/ folder, so no app sees a version before its files.
//
// Before running: bump the version in mk-flix-desktop/package.json and in
// mk-flix-app/app/build.gradle.kts (versionName and a higher versionCode),
// then build: mk-flix-app/build-apk.sh, `npm run dist-win` and
// `npm run dist-linux` in mk-flix-desktop. See release/README.md.
//
// Usage:
//   node release/publish.mjs --notes "Faster start-up" --notes "Fixes the TV remote"
//                            [--min 1.5.0] [--min-android 1.5.0] [--min-windows ...] [--min-linux ...]
//                            [--skip windows] [--date 2026-11-20]
//
// --min sets the oldest version still allowed to run on every platform;
// anything older gets the "Update required" screen. Without it no update is
// required. Secrets come from outside the repo: the manifest key
// (BLENDY_MANIFEST_KEY, default ~/.config/blendy-release/manifest-signing-key.pem)
// and the Android keystore settings in ~/.gradle/gradle.properties.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HERE = path.join(ROOT, 'release');
const DESKTOP = path.join(ROOT, 'mk-flix-desktop');
const ANDROID = path.join(ROOT, 'mk-flix-app');

// The release key's certificate and the app id. An APK signed with anything
// else could never update installed copies, so refuse it.
const ANDROID_PACKAGE = 'com.mainakimani.blendyplay';
const ANDROID_CERT_SHA256 = '1e6c5a1fb57fb3fbab9dfba456500608c7087199e6dff26245d86d83224e5f8b';

const PLATFORM_TEXT = {
  android: {
    label: 'Android phones and TVs',
    requires: 'Android 7.0 or later, including Android TV and Google TV',
    howto: 'Open the file and allow installing from this source when asked. On a TV, use the Downloader app.',
  },
  windows: {
    label: 'Windows',
    requires: 'Windows 10 or 11, 64-bit',
    howto: 'Run the installer. If Windows warns you, choose More info, then Run anyway.',
  },
  linux: {
    label: 'Ubuntu and Debian',
    requires: 'Ubuntu, Debian and similar, 64-bit',
    howto: 'Open the file to install it, or run: sudo apt install ./',
  },
};

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { notes: [], skip: [], min: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`${a} needs a value`);
      return v;
    };
    if (a === '--notes') out.notes.push(next());
    else if (a === '--skip') out.skip.push(next());
    else if (a === '--min') { const v = next(); out.min.android = out.min.windows = out.min.linux = v; }
    else if (a.startsWith('--min-')) out.min[a.slice(6)] = next();
    else if (a === '--date') out.date = next();
    else if (a === '--out') out.out = next();
    else if (a === '--apk' || a === '--exe' || a === '--deb') out[a.slice(2)] = next();
    else fail(`Unknown option ${a}`);
  }
  return out;
}

function gradleValue(name) {
  const text = fs.readFileSync(path.join(ANDROID, 'app', 'build.gradle.kts'), 'utf8');
  const m = text.match(new RegExp(`^\\s*${name}\\s*=\\s*"?([^"\\n]+)"?\\s*$`, 'm'));
  return m ? m[1].trim() : null;
}

function gradleProperties() {
  const file = path.join(os.homedir(), '.gradle', 'gradle.properties');
  const props = {};
  if (!fs.existsSync(file)) return props;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_.]+)\s*=\s*(.*)$/);
    if (m) props[m[1]] = m[2].trim();
  }
  return props;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, ...env } });
  if (r.error) fail(`${path.basename(cmd)}: ${r.error.message}`);
  if (r.status !== 0) fail(`${path.basename(cmd)} failed:\n${r.stderr || r.stdout}`);
  return r.stdout;
}

function buildTools() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), 'Android', 'Sdk');
  return path.join(sdk, 'build-tools', process.env.BUILD_TOOLS_VERSION || '36.0.0');
}

/** Sign the aligned APK from build-apk.sh with the release key and check the result. */
function signApk(source, dest, version, versionCode) {
  const props = gradleProperties();
  const store = props.BLENDY_RELEASE_STORE_FILE;
  if (!store || !props.BLENDY_RELEASE_STORE_PASSWORD || !props.BLENDY_RELEASE_KEY_ALIAS) {
    fail('BLENDY_RELEASE_* settings are missing from ~/.gradle/gradle.properties');
  }
  const bt = buildTools();
  run(path.join(bt, 'apksigner'), [
    'sign', '--ks', store, '--ks-key-alias', props.BLENDY_RELEASE_KEY_ALIAS,
    '--ks-pass', 'env:BLENDY_KS_PASS', '--key-pass', 'env:BLENDY_KEY_PASS',
    '--out', dest, source,
  ], {
    BLENDY_KS_PASS: props.BLENDY_RELEASE_STORE_PASSWORD,
    BLENDY_KEY_PASS: props.BLENDY_RELEASE_KEY_PASSWORD || props.BLENDY_RELEASE_STORE_PASSWORD,
  });
  const certs = run(path.join(bt, 'apksigner'), ['verify', '--print-certs', dest]);
  const digest = (certs.match(/certificate SHA-256 digest: ([0-9a-f]+)/) || [])[1];
  if (digest !== ANDROID_CERT_SHA256) fail(`The APK is signed with an unexpected certificate (${digest})`);
  const badging = run(path.join(bt, 'aapt2'), ['dump', 'badging', dest]);
  const pkg = (badging.match(/package: name='([^']+)'/) || [])[1];
  const code = (badging.match(/versionCode='(\d+)'/) || [])[1];
  const name = (badging.match(/versionName='([^']+)'/) || [])[1];
  if (pkg !== ANDROID_PACKAGE) fail(`The APK's package is ${pkg}, expected ${ANDROID_PACKAGE}`);
  if (name !== version || code !== String(versionCode)) {
    fail(`The APK is ${name} (${code}) but build.gradle.kts says ${version} (${versionCode}). Rebuild it.`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = JSON.parse(fs.readFileSync(path.join(DESKTOP, 'package.json'), 'utf8')).version;
  const androidVersion = gradleValue('versionName');
  const versionCode = parseInt(gradleValue('versionCode'), 10);
  if (androidVersion !== version) {
    fail(`Versions differ: desktop ${version}, Android ${androidVersion}. Bump both to the same version.`);
  }

  const keyFile = process.env.BLENDY_MANIFEST_KEY
    || path.join(os.homedir(), '.config', 'blendy-release', 'manifest-signing-key.pem');
  if (!fs.existsSync(keyFile)) fail(`Manifest signing key not found: ${keyFile}`);
  const publicKey = fs.readFileSync(path.join(HERE, 'manifest-public-key.pem'), 'utf8').trim();
  const updaterSource = fs.readFileSync(path.join(DESKTOP, 'updater.js'), 'utf8');
  const keyBody = publicKey.split('\n').filter((l) => !l.startsWith('-----')).join('');
  if (!updaterSource.replace(/\s/g, '').includes(keyBody)) {
    fail('mk-flix-desktop/updater.js has a different public key than release/manifest-public-key.pem');
  }

  const outRoot = path.resolve(args.out || path.join(HERE, 'out', 'downloads'));
  const outDir = path.join(outRoot, version);
  fs.rmSync(outRoot, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const artifacts = {
    android: { src: args.apk || path.join(ANDROID, 'app', 'build', 'manual', 'app-aligned.apk'), name: `Blendy-Play_${version}.apk` },
    windows: { src: args.exe || path.join(DESKTOP, 'dist', `Blendy-Play-Setup-${version}.exe`), name: `Blendy-Play-Setup-${version}.exe` },
    linux: { src: args.deb || path.join(DESKTOP, 'dist', `Blendy-Play_${version}_amd64.deb`), name: `Blendy-Play_${version}_amd64.deb` },
  };

  const platforms = {};
  for (const [key, a] of Object.entries(artifacts)) {
    if (args.skip.includes(key)) { console.log(`- ${key}: skipped`); continue; }
    if (!fs.existsSync(a.src)) fail(`${key}: ${a.src} not found. Build it first, or pass --skip ${key}.`);
    const dest = path.join(outDir, a.name);
    if (key === 'android') signApk(a.src, dest, version, versionCode);
    else fs.copyFileSync(a.src, dest);
    const size = fs.statSync(dest).size;
    const text = { ...PLATFORM_TEXT[key] };
    if (key === 'linux') text.howto += a.name;
    platforms[key] = {
      version,
      ...(key === 'android' ? { code: versionCode } : {}),
      minimum_version: args.min[key] || null,
      file: `${version}/${a.name}`,
      size,
      sha256: sha256(dest),
      ...text,
    };
    console.log(`✓ ${key}: ${a.name} (${(size / 1048576).toFixed(1)} MB)${args.min[key] ? `, minimum ${args.min[key]}` : ''}`);
  }
  if (!Object.keys(platforms).length) fail('Nothing to publish');

  const manifest = {
    schema: 1,
    version,
    date: args.date || new Date().toISOString().slice(0, 10),
    notes: args.notes,
    platforms,
  };
  const body = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const signature = crypto.sign('sha256', body, { key: fs.readFileSync(keyFile, 'utf8'), dsaEncoding: 'der' });
  if (!crypto.verify('sha256', body, { key: publicKey, dsaEncoding: 'der' }, signature)) {
    fail('The manifest signature does not verify against release/manifest-public-key.pem');
  }
  fs.writeFileSync(path.join(outRoot, 'releases.json'), body);
  fs.writeFileSync(path.join(outRoot, 'releases.json.sig'), `${signature.toString('base64')}\n`);

  console.log(`\nReady: ${outRoot}
Upload, in this order, into the server's downloads/ folder:
  1. the ${version}/ folder
  2. releases.json and releases.json.sig (replacing the old ones)`);
}

main();
