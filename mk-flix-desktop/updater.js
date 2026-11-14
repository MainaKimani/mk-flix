// In-app updates for the desktop app.
//
// Every release publishes a manifest, releases.json, next to the downloads
// (https://blendy.mainakimani.com/downloads/), with a detached ECDSA P-256
// signature in releases.json.sig. The app trusts a manifest only if that
// signature checks out against MANIFEST_PUBLIC_KEY below, whose private half
// never leaves the release machine; so a hacked web server can't push a
// fake update. The manifest gives, per platform, the latest version, the
// oldest version still allowed to run (minimum_version), and the file with
// its size and SHA-256, which the download is checked against.
//
// Windows installs the new NSIS installer silently and restarts the app.
// Linux downloads the .deb and opens it in the system's software installer.
const { app, shell } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

const MANIFEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEGReuWJqg+LRrNCaBNKlzg1yascNT
AW5xgCmrMAMb9cF8lTk2WzdSCyxXdF5JLoXw5u18PCE2AK/TxRPYUgssEw==
-----END PUBLIC KEY-----`;

const DEFAULT_MANIFEST_URL = 'https://blendy.mainakimani.com/downloads/releases.json';
// How long "Later" hides an optional update for.
const LATER_MS = 24 * 60 * 60 * 1000;

let manifestUrl = DEFAULT_MANIFEST_URL;
let latest = null; // { entry, url } from the last successful check

/** Overrides the manifest URL (MKFLIX_UPDATE_URL or updateUrl in mkflix-config.json). */
function configure(url) {
  if (url) manifestUrl = url;
}

function platformKey() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'linux') return 'linux';
  return null;
}

/** -1, 0 or 1, comparing dotted numeric versions ("1.10.0" > "1.9.2"). */
function compareVersions(a, b) {
  const pa = String(a).split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// Plain http is accepted only for a local test server.
function libFor(url) {
  const u = new URL(url);
  if (u.protocol === 'https:') return https;
  if (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)) return http;
  throw new Error(`Refusing to download updates from ${u.origin}`);
}

/** GET a URL into memory (or into `toFile`), following up to 5 redirects. */
function fetch(url, { timeout = 10000, toFile = null, onProgress = null, redirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    let lib;
    try { lib = libFor(url); } catch (e) { return reject(e); }
    const req = lib.get(url, { timeout, headers: { 'Cache-Control': 'no-cache' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(fetch(new URL(res.headers.location, url).href, { timeout, toFile, onProgress, redirects: redirects - 1 }));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const total = parseInt(res.headers['content-length'], 10) || 0;
      let received = 0;
      const hash = crypto.createHash('sha256');
      const chunks = [];
      const out = toFile ? fs.createWriteStream(toFile) : null;
      res.on('data', (d) => {
        received += d.length;
        hash.update(d);
        if (out) out.write(d); else chunks.push(d);
        if (onProgress) onProgress(received, total);
      });
      res.on('end', () => {
        const done = () => resolve({ body: out ? null : Buffer.concat(chunks), sha256: hash.digest('hex'), size: received });
        if (out) out.end(done); else done();
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Timed out')));
    req.on('error', reject);
  });
}

function stateFile() {
  return path.join(app.getPath('userData'), 'update-state.json');
}

function readState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (e) { return {}; }
}

/** Hide the optional update to `version` for a day. */
function dismiss(version) {
  try {
    fs.writeFileSync(stateFile(), JSON.stringify({ dismissed: { version, at: Date.now() } }));
  } catch (e) { /* not worth failing over */ }
}

function isDismissed(version) {
  const d = readState().dismissed;
  return !!d && d.version === version && Date.now() - d.at < LATER_MS;
}

/**
 * Ask the release server whether there's a newer version.
 * Resolves to { status: 'none' } or { status: 'optional' | 'required', ... };
 * rejects if the manifest can't be fetched or its signature doesn't check out.
 */
async function check() {
  const key = platformKey();
  if (!key) return { status: 'none' };
  const [manifest, signature] = await Promise.all([
    fetch(manifestUrl, { timeout: 8000 }),
    fetch(`${manifestUrl}.sig`, { timeout: 8000 }),
  ]);
  const sig = Buffer.from(signature.body.toString('utf8').trim(), 'base64');
  const valid = crypto.verify('sha256', manifest.body, { key: MANIFEST_PUBLIC_KEY, dsaEncoding: 'der' }, sig);
  if (!valid) throw new Error('The release manifest signature is not valid');

  const data = JSON.parse(manifest.body.toString('utf8'));
  const entry = data.platforms && data.platforms[key];
  const current = app.getVersion();
  if (!entry || !entry.version || !entry.file || !entry.sha256 || compareVersions(entry.version, current) <= 0) {
    latest = null;
    return { status: 'none', current };
  }
  latest = { entry, url: new URL(entry.file, manifestUrl).href };
  const required = !!entry.minimum_version && compareVersions(current, entry.minimum_version) < 0;
  return {
    status: required ? 'required' : 'optional',
    current,
    version: entry.version,
    minimum: entry.minimum_version || null,
    notes: Array.isArray(data.notes) ? data.notes : [],
    size: entry.size || 0,
    platform: key,
    // Windows installs and restarts by itself; Linux hands the .deb to the system installer.
    install: key === 'windows' ? 'auto' : 'open',
    dismissed: !required && isDismissed(entry.version),
  };
}

/** Download the update checked last and verify it. Resolves to the file path. */
async function download(onProgress) {
  if (!latest) throw new Error('No update to download');
  const { entry, url } = latest;
  const dir = path.join(app.getPath('temp'), 'blendy-play-update');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, path.basename(new URL(url).pathname));
  const part = `${dest}.part`;
  const result = await fetch(url, { timeout: 30000, toFile: part, onProgress });
  if (result.sha256 !== String(entry.sha256).toLowerCase() || (entry.size && result.size !== entry.size)) {
    fs.rmSync(part, { force: true });
    throw new Error('The download is damaged or has been changed. Try again.');
  }
  fs.renameSync(part, dest);
  if (process.platform !== 'win32') fs.chmodSync(dest, 0o644);
  return dest;
}

/** Install a downloaded update. Windows quits the app so the installer can replace it. */
async function install(file) {
  if (process.platform === 'win32') {
    // The flags electron-builder's NSIS installer understands: a silent
    // update install, then start the app again.
    spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 300);
    return { mode: 'auto' };
  }
  const error = await shell.openPath(file);
  if (error) shell.showItemInFolder(file);
  return { mode: 'open', file, opened: !error };
}

/** The product page's downloads section, for when the app can't update itself. */
function downloadsPage() {
  try {
    return new URL('/#download', manifestUrl).href;
  } catch (e) {
    return 'https://blendy.mainakimani.com/#download';
  }
}

module.exports = { configure, check, download, install, dismiss, downloadsPage, compareVersions, platformKey };
