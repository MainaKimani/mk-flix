// Builds the extension into dist/extension/ (load it unpacked) and
// dist/blendy-play-extension-<version>.zip (for the stores).
//
//   node build.mjs
//
// The shared files (the gate and the scripts injected into cinejoy.pk) are not
// kept here: they are copied from mk-flix-desktop/, and the build stops if
// the Android app's copy differs, so the three clients can't drift apart.
//
// Two files are made rather than copied:
// - gate.html + gate.js from mkflix-account.html. Extension pages may not run
//   inline scripts, so the gate's one <script> block moves into gate.js.
// - adblock-rules.json from adblock-hosts.txt: one declarativeNetRequest rule
//   blocking those hosts for requests cinejoy.pk makes (background.js adds
//   the rest of a cinejoy.pk tab).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.join(here, '..', 'mk-flix-desktop');
const android = path.join(here, '..', 'mk-flix-app', 'app', 'src', 'main', 'assets');
const dist = path.join(here, 'dist');
const out = path.join(dist, 'extension');

const SHARED = [
  'mkflix-account.html',
  'mkflix-logo.css',
  'mkflix-footer.js',
  'mkflix-enforcer.js',
  'mkflix-menu.js',
  'mkflix-lock.js',
  'mkflix-notice.js',
  'mkflix-player.js',
  'mkflix-pip.js',
  'mkflix-cinejoy.js',
  'adblock-hosts.txt',
  'icon.png',
];
const OWN = ['manifest.json', 'background.js', 'bridge-page.js', 'bridge-relay.js', 'icons'];
// Hosts the ad list must never cover, or the site itself stops working.
const NEEDED_HOSTS = ['cinejoy.pk', 'wing.st', 'server2.wing.st', 'lightspeed.st'];
const RESOURCE_TYPES = [
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
  'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other',
];

function fail(message) {
  console.error(`build: ${message}`);
  process.exit(1);
}

// ---- Shared files: same on desktop and Android ----
for (const file of SHARED) {
  const a = path.join(desktop, file);
  const b = path.join(android, file);
  if (!fs.existsSync(a)) fail(`missing ${a}`);
  // icon.png is the one exception: each app has its own size of it.
  if (file !== 'icon.png' && fs.existsSync(b) && !fs.readFileSync(a).equals(fs.readFileSync(b))) {
    fail(`${file} differs between mk-flix-desktop/ and the Android assets; sync them first`);
  }
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const file of OWN) fs.cpSync(path.join(here, file), path.join(out, file), { recursive: true });
for (const file of SHARED) {
  if (file === 'mkflix-account.html' || file === 'adblock-hosts.txt') continue;
  fs.copyFileSync(path.join(desktop, file), path.join(out, file));
}

// ---- gate.html + gate.js ----
const gate = fs.readFileSync(path.join(desktop, 'mkflix-account.html'), 'utf8');
const scripts = [...gate.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (scripts.length !== 1 || /<script\b(?!>)/.test(gate)) {
  fail('mkflix-account.html should have exactly one plain <script> block; update build.mjs');
}
if (/\son[a-z]+\s*=\s*["']/i.test(gate) || /href\s*=\s*["']javascript:/i.test(gate)) {
  fail('mkflix-account.html has an inline event handler, which extension pages block');
}
// The gate's own Content-Security-Policy allows inline scripts only; the
// script now comes from gate.js, so it must allow 'self' instead.
const INLINE_CSP = "script-src 'unsafe-inline'";
if (gate.split(INLINE_CSP).length !== 2) {
  fail(`mkflix-account.html's Content-Security-Policy no longer has "${INLINE_CSP}"; update build.mjs`);
}
fs.writeFileSync(path.join(out, 'gate.js'), scripts[0][1].replace(/^\n/, ''));
fs.writeFileSync(path.join(out, 'gate.html'), gate
  .replace(INLINE_CSP, "script-src 'self'")
  .replace(scripts[0][0], '<script src="gate.js"></script>'));

// ---- tab-brand.js: the tab icon, inlined ----
const brand = fs.readFileSync(path.join(here, 'tab-brand.js'), 'utf8');
if (brand.split('"__ICON_DATA_URL__"').length !== 2) fail('tab-brand.js has no "__ICON_DATA_URL__" to fill in');
const icon = fs.readFileSync(path.join(here, 'icons', 'icon-32.png')).toString('base64');
fs.writeFileSync(path.join(out, 'tab-brand.js'),
  brand.replace('"__ICON_DATA_URL__"', JSON.stringify(`data:image/png;base64,${icon}`)));

// ---- adblock-rules.json ----
const hosts = fs.readFileSync(path.join(desktop, 'adblock-hosts.txt'), 'utf8')
  .split('\n').map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#'));
for (const needed of NEEDED_HOSTS) {
  const hit = hosts.find((h) => needed === h || needed.endsWith('.' + h));
  if (hit) fail(`adblock-hosts.txt entry "${hit}" would block ${needed}`);
}
const rules = [{
  id: 1,
  priority: 1,
  action: { type: 'block' },
  condition: {
    requestDomains: [...new Set(hosts)],
    initiatorDomains: ['cinejoy.pk'],
    resourceTypes: RESOURCE_TYPES,
  },
}];
fs.writeFileSync(path.join(out, 'adblock-rules.json'), JSON.stringify(rules, null, 2) + '\n');

// ---- zip ----
const { version } = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));
const zipName = `blendy-play-extension-${version}.zip`;
execFileSync('zip', ['-qr', path.join(dist, zipName), '.'], { cwd: out });
console.log(`build: dist/extension/ and dist/${zipName}`);
