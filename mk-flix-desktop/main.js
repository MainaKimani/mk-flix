const { app, BrowserWindow, WebContentsView, ipcMain, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const HOME_URL = 'https://cinejoy.pk/';
const APP_TITLE = 'Blendy Play: Powered by CineJoy';

// ---- Built-in ad/tracker blocker (same host list as the Android app) ----
const adHosts = new Set();
try {
  const lines = fs.readFileSync(path.join(__dirname, 'adblock-hosts.txt'), 'utf8').split('\n');
  for (const line of lines) {
    const h = line.trim().toLowerCase();
    if (h && !h.startsWith('#')) adHosts.add(h);
  }
} catch (e) { /* blocker stays empty */ }

function isAdHost(url) {
  try {
    let domain = new URL(url).hostname.toLowerCase();
    while (true) {
      if (adHosts.has(domain)) return true;
      const dot = domain.indexOf('.');
      if (dot < 0) return false;
      domain = domain.slice(dot + 1);
    }
  } catch (e) {
    return false;
  }
}

// Sites that may open in the user's default browser (e.g. a trailer).
const EXTERNAL_ALLOW = ['youtube.com', 'youtu.be', 'vimeo.com'];

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (e) {
    return null;
  }
}

function isCineJoy(host) {
  return host === 'cinejoy.pk' || host.endsWith('.cinejoy.pk');
}

function isTrustedExternal(url, host) {
  const protocol = new URL(url).protocol;
  return (protocol === 'https:' || protocol === 'http:')
    && EXTERNAL_ALLOW.some((d) => host === d || host.endsWith('.' + d));
}

// Popup policy: MK-Flix is a dedicated cinejoy.pk client, so popups are locked
// down hard. cinejoy.pk opens in-app. Blocklisted ad hosts die silently.
// Background popunders (the classic click-triggered ad trick) die silently.
// Only a genuine foreground link to a known-good site (e.g. a trailer on
// YouTube) may open in the default browser. Everything else is swallowed —
// no more ad tabs escaping to the browser.
function popupPolicy({ url, disposition }) {
  const host = hostOf(url);
  if (!host) return { action: 'deny' };
  if (isCineJoy(host)) return { action: 'allow' };
  if (isAdHost(url) || disposition === 'background-tab') return { action: 'deny' };
  if (isTrustedExternal(url, host)) shell.openExternal(url);
  return { action: 'deny' };
}

// Same rule for the page itself: an ad script redirecting the whole window
// (window.location = ...) must not be able to take over the app. Only
// cinejoy.pk loads in the window; trusted sites go to the default browser.
// Embedded players in iframes are not affected — this only checks top-level
// page loads.
function guardNavigation(event) {
  const { url } = event;
  const host = hostOf(url);
  if (host && isCineJoy(host)) {
    // Playback gate: a /watch/ page reached without an active subscription is
    // sent to the paywall. The enforcer catches in-page (SPA) navigation; this
    // backs it up for full page loads and redirects.
    if (!subscribed && isWatchUrl(url)) {
      event.preventDefault();
      const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getAllWindows()[0];
      if (win) win.loadFile(path.join(__dirname, 'mkflix-account.html'));
    }
    return;
  }
  event.preventDefault();
  if (host && !isAdHost(url) && isTrustedExternal(url, host)) shell.openExternal(url);
}

// MK-Flix branding on cinejoy.pk, shared with the Android app:
// - mkflix-logo.css draws the MK-Flix icon in place of the site's header
//   logo. preload.js applies it before the page's first paint, fetching it
//   from here over IPC because preloads can't read files.
// - mkflix-footer.js replaces the site's footer, once the page's DOM is ready.
function readOptional(file) {
  try {
    return fs.readFileSync(path.join(__dirname, file), 'utf8');
  } catch (e) {
    return ''; // the site's own branding stays
  }
}
const logoCss = readOptional('mkflix-logo.css');
const footerJs = readOptional('mkflix-footer.js');
// Injected into cinejoy.pk pages: blocks /watch/ playback without a subscription.
const enforcerJs = readOptional('mkflix-enforcer.js');
// Adds a "My Subscription" item to cinejoy.pk's settings menu.
const menuJs = readOptional('mkflix-menu.js');
// Golden padlock on each poster while there's no active subscription.
const lockJs = readOptional('mkflix-lock.js');
// Closes CineJoy's "all issues fixed, no ads, 4K" announcement popup.
const noticeJs = readOptional('mkflix-notice.js');
// "Still watching?" after 90 idle minutes of autoplay, and the end-of-film card.
const playerJs = readOptional('mkflix-player.js');
// One sign-in for Blendy Play and CineJoy (see "CineJoy account" below).
const cinejoyJs = readOptional('mkflix-cinejoy.js');
// Picture-in-picture: makes sure the player has its button, and opens the
// floating video when the window is minimized mid-film (see createWindow).
const pipJs = readOptional('mkflix-pip.js');
ipcMain.on('mkflix:logo-css', (event) => {
  event.returnValue = logoCss;
});

// Backend URL the account gate should use. The operator sets it without editing
// the gate: the MKFLIX_API_BASE env var, or the `apiBase` field of
// mkflix-config.json next to this file. The gate reads it via MKFlixNative.getApiBase().
function configuredApiBase() {
  if (process.env.MKFLIX_API_BASE) return process.env.MKFLIX_API_BASE.trim();
  try {
    return String(JSON.parse(readOptional('mkflix-config.json') || '{}').apiBase || '').trim();
  } catch (e) {
    return '';
  }
}
const API_BASE = configuredApiBase();
ipcMain.on('mkflix:api-base', (event) => {
  event.returnValue = API_BASE;
});

// ---- In-app updates (see updater.js) ----
// The manifest URL can be pointed at a test server with MKFLIX_UPDATE_URL or
// `updateUrl` in mkflix-config.json; otherwise it's the release server.
const updater = require('./updater');
function configuredUpdateUrl() {
  if (process.env.MKFLIX_UPDATE_URL) return process.env.MKFLIX_UPDATE_URL.trim();
  try {
    return String(JSON.parse(readOptional('mkflix-config.json') || '{}').updateUrl || '').trim();
  } catch (e) {
    return '';
  }
}
updater.configure(configuredUpdateUrl());
const APP_PLATFORM = updater.platformKey() || process.platform;

// Only the account gate (a local file) may drive updates, not a cinejoy.pk page.
function fromGate(event) {
  const url = (event.senderFrame && event.senderFrame.url) || '';
  return url.startsWith('file://');
}
// This install's id and a name for it, sent when signing in so the account's
// devices list can show it and signing in again here reuses its place. The id
// is random, made once and kept in the app's data folder.
let deviceIdCache = null;
function deviceId() {
  if (deviceIdCache) return deviceIdCache;
  const file = path.join(app.getPath('userData'), 'device-id');
  try {
    deviceIdCache = fs.readFileSync(file, 'utf8').trim();
  } catch (e) { /* not made yet */ }
  if (!deviceIdCache) {
    deviceIdCache = crypto.randomUUID();
    try { fs.writeFileSync(file, deviceIdCache); } catch (e) { /* use it for this run */ }
  }
  return deviceIdCache;
}
function deviceName() {
  const system = { win32: 'Windows', linux: 'Linux', darwin: 'Mac' }[process.platform] || process.platform;
  const host = (os.hostname() || '').trim();
  return (host ? `${host} (${system})` : `${system} computer`).slice(0, 100);
}
ipcMain.on('mkflix:app-info', (event) => {
  event.returnValue = {
    version: app.getVersion(),
    platform: APP_PLATFORM,
    deviceId: deviceId(),
    deviceName: deviceName(),
  };
});
ipcMain.handle('mkflix:update-check', async (event) => {
  if (!fromGate(event)) return { status: 'none' };
  try {
    return await updater.check();
  } catch (e) {
    return { status: 'error', message: String(e.message || e) };
  }
});
ipcMain.handle('mkflix:update-start', async (event) => {
  if (!fromGate(event)) return { ok: false, message: 'Not allowed' };
  const sender = event.sender;
  let last = 0;
  try {
    const file = await updater.download((received, total) => {
      const now = Date.now();
      if (now - last < 150 && received !== total) return;
      last = now;
      if (!sender.isDestroyed()) sender.send('mkflix:update-progress', { received, total });
    });
    return { ok: true, ...(await updater.install(file)) };
  } catch (e) {
    return { ok: false, message: String(e.message || e) };
  }
});
ipcMain.on('mkflix:update-later', (event, version) => {
  if (fromGate(event) && version) updater.dismiss(String(version));
});
ipcMain.on('mkflix:open-downloads', (event) => {
  if (fromGate(event)) shell.openExternal(updater.downloadsPage());
});

// ---- Subscription (playback gate) ----
// The account gate hands us the session and the answer of its own
// /me/subscription check (mkflix:set-subscribed, accepted from the gate only),
// so we don't ask the backend a second time and the site can open at once. A
// page on cinejoy.pk can't fake a subscription. After a payment the gate
// checks again and hands over the new answer. The enforcer injected into
// cinejoy pages reads `subscribed` synchronously and blocks /watch/ when false.
const http = require('http');
const https = require('https');
let mkSession = { apiBase: '', access: '', refresh: '' };
let subscribed = false;

// Resolves to { status, data } (data null if the body isn't JSON), or null
// if the backend couldn't be reached. With a body, it's a JSON POST.
function getJson(url, token, body) {
  return new Promise((resolve) => {
    let lib;
    try {
      lib = new URL(url).protocol === 'http:' ? http : https;
    } catch (e) {
      return resolve(null);
    }
    const headers = {
      // Lets the backend refuse versions older than its minimum (426).
      'X-App-Version': app.getVersion(),
      'X-App-Platform': APP_PLATFORM,
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const payload = body === undefined ? null : JSON.stringify(body);
    if (payload !== null) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = lib.request(url, { method: payload === null ? 'GET' : 'POST', headers, timeout: 15000 }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        let data = null;
        try { data = JSON.parse(body); } catch (e) { /* not JSON */ }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end(payload === null ? undefined : payload);
  });
}

// The access token lasts an hour, and the gate only hands over a fresh one
// when it runs. So the check refreshes it itself, once, on a plain 401;
// without this every check after the first hour was a wasted 401 and a
// subscription that ran out, or a device signed out from the portal, went
// unnoticed until the next launch.
async function checkWithRefresh() {
  const url = `${mkSession.apiBase}/me/subscription`;
  const res = await getJson(url, mkSession.access);
  if (!res || res.status !== 401 || (res.data && res.data.code === 'session_revoked') || !mkSession.refresh) {
    return res;
  }
  const session = mkSession;
  const r = await getJson(`${session.apiBase}/auth/refresh`, null, { refresh: session.refresh });
  if (r && r.status === 401 && r.data && r.data.code === 'session_revoked') return r;
  if (!r || r.status !== 200 || !r.data || typeof r.data.access !== 'string') return res;
  // The gate may have handed over a new session meanwhile; that one wins.
  if (mkSession !== session) return null;
  mkSession = { ...session, access: r.data.access };
  return getJson(url, mkSession.access);
}

let checking = false;
async function refreshSubscription() {
  if (!mkSession.apiBase || !mkSession.access) { subscribed = false; return; }
  if (checking) return; // one check at a time
  checking = true;
  try {
    const res = await checkWithRefresh();
    const data = res && res.data;
    if (res && res.status === 200 && data && typeof data.active === 'boolean') {
      subscribed = data.active;
    } else if (res && res.status === 401 && data && data.code === 'session_revoked') {
      // Signed out from the devices list (or by a password change): stop
      // playback and send every window to the gate, which shows sign-in.
      mkSession = { apiBase: '', access: '', refresh: '' };
      subscribed = false;
      cinejoySignOut();
      for (const win of BrowserWindow.getAllWindows()) {
        win.loadFile(path.join(__dirname, 'mkflix-account.html'));
      }
    }
    // Anything else (offline, an expired access token): keep the last known
    // answer rather than locking out a real subscriber; the gate re-sends the
    // session and re-checks each time it runs.
  } finally {
    checking = false;
  }
}
// Re-check now and then while the app is open, so a device signed out from
// the portal, or a subscription that ran out, stops playback without a
// restart.
setInterval(refreshSubscription, 10 * 60 * 1000).unref();

ipcMain.on('mkflix:save-session', (_event, s) => {
  mkSession = {
    apiBase: (s && s.apiBase) || '',
    access: (s && s.access) || '',
    refresh: (s && s.refresh) || '',
  };
});
ipcMain.on('mkflix:set-subscribed', (event, active) => {
  if (fromGate(event)) subscribed = active === true;
});
// The gate shows the splash while it hands over to the site, and takes it
// down when it shows a screen.
ipcMain.on('mkflix:splash', (event, on) => {
  if (!fromGate(event)) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (on) showSplash(win, 0);
  else dismissSplash(win);
});
ipcMain.on('mkflix:clear-session', () => {
  mkSession = { apiBase: '', access: '', refresh: '' };
  subscribed = false;
  cinejoySignOut();
});

// ---- CineJoy account ----
// One sign-in for both. CineJoy keeps progress and lists under a 16-digit
// number (its only credential), and Blendy Play saves that number on the
// user's account. mkflix-cinejoy.js, on cinejoy.pk:
//   - signs the app in to CineJoy with the saved number;
//   - reports a number CineJoy signed in with that we didn't know (created
//     or keyed in there), which the gate then saves (pending);
//   - after the email is confirmed, opens CineJoy's own "create" panel
//     (create), where the user passes CineJoy's captcha themselves;
//   - signs CineJoy out when Blendy Play signs out (signOut).
// The CineJoy account stays optional: with no number nothing happens. Kept in
// the app's data folder, which only this user can read.
const CINEJOY_CREATE_URL = 'https://cinejoy.pk/settings';
const cinejoyFile = () => path.join(app.getPath('userData'), 'cinejoy.json');
let cinejoyCache = null;
function cinejoyState() {
  if (!cinejoyCache) {
    try { cinejoyCache = JSON.parse(fs.readFileSync(cinejoyFile(), 'utf8')) || {}; } catch (e) { cinejoyCache = {}; }
  }
  return cinejoyCache;
}
function cinejoyUpdate(changes) {
  cinejoyCache = { ...cinejoyState(), ...changes };
  try { fs.writeFileSync(cinejoyFile(), JSON.stringify(cinejoyCache), { mode: 0o600 }); } catch (e) { /* kept for this run */ }
}
function validCinejoyNumber(n) {
  const s = String(n == null ? '' : n).replace(/\s+/g, '');
  return /^\d{16}$/.test(s) ? s : '';
}
function cinejoySignOut() {
  cinejoyUpdate({ number: '', pending: '', create: false, signOut: true });
}
function fromCinejoy(event) {
  const url = (event.senderFrame && event.senderFrame.url) || '';
  const host = hostOf(url);
  return !!host && isCineJoy(host);
}
// The gate: the number saved on the Blendy Play account ("" for none).
ipcMain.on('mkflix:cj-set-number', (event, n) => {
  if (fromGate(event)) cinejoyUpdate({ number: validCinejoyNumber(n) });
});
// The gate: a number CineJoy gave this app that Blendy Play hasn't saved yet.
ipcMain.on('mkflix:cj-pending', (event) => {
  event.returnValue = fromGate(event) ? (cinejoyState().pending || '') : '';
});
// The gate saved it; kept if a newer one arrived meanwhile.
ipcMain.on('mkflix:cj-pending-saved', (event, n) => {
  if (fromGate(event) && cinejoyState().pending === n) cinejoyUpdate({ pending: '' });
});
// The gate: open CineJoy on its "create a code" panel.
ipcMain.on('mkflix:cj-create', (event) => {
  if (!fromGate(event)) return;
  cinejoyUpdate({ create: true });
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.loadURL(CINEJOY_CREATE_URL);
});
// mkflix-cinejoy.js: the saved number, to sign the app in to CineJoy.
ipcMain.on('mkflix:cj-number', (event) => {
  event.returnValue = fromCinejoy(event) ? (cinejoyState().number || '') : '';
});
// mkflix-cinejoy.js: whether to open the create panel, or to sign CineJoy
// out (each true once).
ipcMain.on('mkflix:cj-take-create', (event) => {
  const yes = fromCinejoy(event) && cinejoyState().create === true;
  if (yes) cinejoyUpdate({ create: false });
  event.returnValue = yes;
});
ipcMain.on('mkflix:cj-take-sign-out', (event) => {
  const yes = fromCinejoy(event) && cinejoyState().signOut === true;
  if (yes) cinejoyUpdate({ signOut: false });
  event.returnValue = yes;
});
// mkflix-cinejoy.js: CineJoy signed in to a number we didn't know. Kept until
// the gate saves it to the Blendy Play account.
ipcMain.on('mkflix:cj-signed-in', (event, n) => {
  const num = validCinejoyNumber(n);
  if (fromCinejoy(event) && num) cinejoyUpdate({ number: num, pending: num });
});
// mkflix-cinejoy.js: CineJoy refused to create a code for now (too many from
// this network); back to the subscription page, which says so.
ipcMain.on('mkflix:cj-busy', (event) => {
  if (!fromCinejoy(event)) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.loadFile(path.join(__dirname, 'mkflix-account.html'), { hash: 'subscription-busy' });
});
// mkflix-cinejoy.js: the code was created; back to the subscription page.
ipcMain.on('mkflix:cj-created', (event) => {
  if (!fromCinejoy(event)) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.loadFile(path.join(__dirname, 'mkflix-account.html'), { hash: 'subscription' });
});
ipcMain.on('mkflix:refresh-subscription', () => { refreshSubscription(); });
ipcMain.on('mkflix:is-subscribed', (event) => { event.returnValue = subscribed; });
ipcMain.on('mkflix:open-paywall', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.loadFile(path.join(__dirname, 'mkflix-account.html'));
});
// The "My Subscription" menu entry: the gate opened on its subscription page
// (a subscriber would otherwise be sent straight back to the site).
ipcMain.on('mkflix:open-subscription', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.loadFile(path.join(__dirname, 'mkflix-account.html'), { hash: 'subscription' });
});

function isWatchUrl(url) {
  try {
    return isCineJoy(hostOf(url)) && new URL(url).pathname.startsWith('/watch/');
  } catch (e) {
    return false;
  }
}

// Apply the popup and navigation rules to every window, including popup
// windows cinejoy.pk itself opens. Setting them on the main window alone
// would leave those popups free to open anything.
app.on('web-contents-created', (_event, contents) => {
  contents.on('dom-ready', () => {
    const host = hostOf(contents.getURL());
    if (host && isCineJoy(host)) {
      if (footerJs) contents.executeJavaScript(footerJs).catch(() => {});
      if (enforcerJs) contents.executeJavaScript(enforcerJs).catch(() => {});
      if (menuJs) contents.executeJavaScript(menuJs).catch(() => {});
      if (lockJs) contents.executeJavaScript(lockJs).catch(() => {});
      if (noticeJs) contents.executeJavaScript(noticeJs).catch(() => {});
      if (playerJs) contents.executeJavaScript(playerJs).catch(() => {});
      if (pipJs) contents.executeJavaScript(pipJs).catch(() => {});
      if (cinejoyJs) contents.executeJavaScript(cinejoyJs).catch(() => {});
    }
  });
  // A page that fails to load would leave a blank black window, so show
  // error.html instead, with the reason and a Retry button. ERR_ABORTED (-3)
  // is skipped: it fires on redirects and when the user navigates away
  // mid-load, which aren't failures. Failures of error.html itself (file:)
  // are skipped too, so this can't loop.
  contents.on('did-fail-load', (_event, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || url.startsWith('file:')) return;
    contents.loadFile(path.join(__dirname, 'error.html'), {
      query: { url, code: String(code), desc },
    });
  });
  contents.setWindowOpenHandler(popupPolicy);
  contents.on('will-navigate', guardNavigation);
  contents.on('will-redirect', (event) => {
    if (event.isMainFrame) guardNavigation(event);
  });
});

// Every window, popups included, keeps the app's name in the title bar
// instead of switching to whatever <title> the current page sets.
app.on('browser-window-created', (_event, win) => {
  win.setTitle(APP_TITLE);
  win.on('page-title-updated', (event) => event.preventDefault());
});

// Only fullscreen is granted to web content. Electron approves every
// permission request by default, which would let any page (or ad script
// that slips through) use notifications, location, camera or microphone
// without asking.
const ALLOWED_PERMISSIONS = new Set(['fullscreen']);

function setUpSession() {
  const ses = session.defaultSession;

  // Block ad/tracker requests before they load.
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: isAdHost(details.url) });
  });

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
}

// Splash (splash.html), the same as the Android app's: shown over the main
// window from the moment it opens, and again whenever the gate hands over to
// the site. It stays up through the account check and the site's loading,
// until the site has drawn its content: the gate takes it down when it shows
// a screen (mkflix:splash), the site when its content is in (see
// watchSplashHandOff). At startup it stays up at least SPLASH_MIN_MS, so it
// reads as an intro rather than a flicker; the hand-off has no minimum. At
// most SPLASH_MAX_MS, so a slow network shows the site's own progress
// instead of a stuck splash.
const SPLASH_MIN_MS = 3000;
const SPLASH_MAX_MS = 15000;
const SPLASH_FADE_MS = 450; // matches the transition in splash.html
// The splash showing over each window, as { dismiss }.
const splashes = new WeakMap();
// True once the site has drawn its content: a section heading or a video,
// and an image loaded on screen. Until then it shows only its dark green
// background. Also true for any page that isn't the site.
const CONTENT_READY_JS = `(() => {
  if (!/(^|\\.)cinejoy\\.pk$/.test(location.hostname)) return true;
  const vis = (e) => { const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const text = [...document.querySelectorAll('h1, h2, video')].some(vis);
  const img = [...document.images].some((i) => i.complete && i.naturalWidth > 0 && vis(i));
  return text && img;
})()`;

function showSplash(win, minMs) {
  if (win.isDestroyed() || splashes.has(win)) return; // already up: it carries on
  const splash = new WebContentsView();
  splash.setBackgroundColor('#000000');
  const fit = () => {
    const [width, height] = win.getContentSize();
    splash.setBounds({ x: 0, y: 0, width, height });
  };
  fit();
  win.on('resize', fit);
  win.contentView.addChildView(splash);
  splash.webContents.loadFile(path.join(__dirname, 'splash.html'));
  // Once its page is closed, Electron sets splash.webContents to undefined,
  // so check before touching it again.
  const closeSplash = () => {
    const contents = splash.webContents;
    if (contents && !contents.isDestroyed()) contents.close();
  };

  // At startup, open the window once the splash can paint, so it starts on
  // the splash rather than an empty black frame. The timer covers a splash
  // that never loads, so the window still appears.
  const show = () => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  };
  splash.webContents.once('did-finish-load', show);
  const showFallback = setTimeout(show, 1500);

  const shownAt = Date.now();
  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    // Free the slot now, so a new hand-off can start while this one fades.
    if (splashes.get(win) === entry) splashes.delete(win);
    clearTimeout(maxTimer);
    const wait = Math.max(0, minMs - (Date.now() - shownAt));
    setTimeout(() => {
      if (win.isDestroyed()) return;
      splash.webContents.executeJavaScript("document.body.classList.add('leaving')").catch(() => {});
      setTimeout(() => {
        if (win.isDestroyed()) return;
        win.removeListener('resize', fit);
        win.contentView.removeChildView(splash);
        closeSplash();
        // Give the page keyboard focus, which the splash may have held.
        win.webContents.focus();
      }, SPLASH_FADE_MS);
    }, wait);
  };
  const entry = { dismiss };
  splashes.set(win, entry);
  const maxTimer = setTimeout(dismiss, SPLASH_MAX_MS);
  win.once('closed', () => {
    clearTimeout(maxTimer);
    clearTimeout(showFallback);
    closeSplash();
  });
}

function dismissSplash(win) {
  const entry = win && splashes.get(win);
  if (entry) entry.dismiss();
}

// Takes the splash down when a page is in: the site once its content is
// drawn (checked every 250 ms), the error screen at once. The gate decides
// for itself.
function watchSplashHandOff(win) {
  let watching = false;
  win.webContents.on('did-finish-load', () => {
    const url = win.webContents.getURL();
    if (url.startsWith('file:') && url.includes('mkflix-account.html')) return;
    if (!isCineJoy(hostOf(url))) { dismissSplash(win); return; }
    if (watching) return;
    watching = true;
    const check = async () => {
      if (win.isDestroyed() || !splashes.has(win)) { watching = false; return; }
      const ready = await win.webContents.executeJavaScript(CONTENT_READY_JS).catch(() => false);
      if (ready) { watching = false; dismissSplash(win); } else setTimeout(check, 250);
    };
    check();
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    title: APP_TITLE,
    // Windows uses the multi-size .ico; Linux can't load .ico for window icons.
    icon: path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    backgroundColor: '#000000',
    // Shown by showSplash() once the splash can paint.
    show: false,
    // Popups the site opens inherit these, preload included.
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });

  showSplash(win, SPLASH_MIN_MS);
  watchSplashHandOff(win);

  // Picture-in-picture: minimizing the window mid-film opens the video in
  // Chromium's floating window, and bringing the window back closes it
  // again (only when minimizing opened it). The page can open that window
  // only with a user gesture, hence `true`: minimizing is the user's act.
  // mkflix-pip.js checks that this is a playing /watch/ page.
  const pip = (call) => {
    if (!isCineJoy(hostOf(win.webContents.getURL()))) return;
    win.webContents.executeJavaScript(`window.__mkflixPip && window.__mkflixPip.${call}()`, true)
      .catch(() => {});
  };
  win.on('minimize', () => pip('auto'));
  win.on('restore', () => pip('restored'));
  // Start on the account gate, not the site. It checks for an active MK-Flix
  // subscription against the backend and sends the window to cinejoy.pk itself
  // (guardNavigation allows that) once the user is signed in and subscribed.
  win.loadFile(path.join(__dirname, 'mkflix-account.html'));
}

app.whenReady().then(() => {
  setUpSession();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
