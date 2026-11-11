const { app, BrowserWindow, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const HOME_URL = 'https://cinejoy.pk/';
const APP_TITLE = 'MK-Flix: Powered by CineJoy';

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

// Popup policy: the app is a dedicated CineJoy client, so popups are locked
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
  if (host && isCineJoy(host)) return;
  event.preventDefault();
  if (host && !isAdHost(url) && isTrustedExternal(url, host)) shell.openExternal(url);
}

// Replaces cinejoy.pk's footer with the MK-Flix lines and support details.
// See mkflix-footer.js (shared with the Android app) for how and why.
let footerJs = '';
try {
  footerJs = fs.readFileSync(path.join(__dirname, 'mkflix-footer.js'), 'utf8');
} catch (e) { /* footer stays as the site made it */ }

// Apply the popup and navigation rules to every window, including popup
// windows cinejoy.pk itself opens. Setting them on the main window alone
// would leave those popups free to open anything.
app.on('web-contents-created', (_event, contents) => {
  contents.on('dom-ready', () => {
    const host = hostOf(contents.getURL());
    if (host && isCineJoy(host) && footerJs) contents.executeJavaScript(footerJs).catch(() => {});
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

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    title: APP_TITLE,
    icon: path.join(__dirname, 'icon.ico'),
    backgroundColor: '#000000',
  });

  win.loadURL(HOME_URL);
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
