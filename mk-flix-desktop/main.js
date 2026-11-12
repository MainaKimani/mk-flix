const { app, BrowserWindow, WebContentsView, ipcMain, session, shell } = require('electron');
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
  if (host && isCineJoy(host)) return;
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
ipcMain.on('mkflix:logo-css', (event) => {
  event.returnValue = logoCss;
});

// Apply the popup and navigation rules to every window, including popup
// windows cinejoy.pk itself opens. Setting them on the main window alone
// would leave those popups free to open anything.
app.on('web-contents-created', (_event, contents) => {
  contents.on('dom-ready', () => {
    const host = hostOf(contents.getURL());
    if (host && isCineJoy(host) && footerJs) contents.executeJavaScript(footerJs).catch(() => {});
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

// Startup splash (splash.html), the same as the Android app's: shown over
// the main window from the moment it opens while cinejoy.pk loads
// underneath, then faded out. It stays up at least SPLASH_MIN_MS, so it reads
// as an intro rather than a flicker, and at most SPLASH_MAX_MS, so a slow
// network shows the site's own progress instead of a stuck splash.
const SPLASH_MIN_MS = 3000;
const SPLASH_MAX_MS = 15000;
const SPLASH_FADE_MS = 450; // matches the transition in splash.html

function showSplash(win) {
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

  // Open the window once the splash can paint, so it starts on the splash
  // rather than an empty black frame. The timer covers a splash that never
  // loads, so the window still appears.
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
    clearTimeout(maxTimer);
    const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - shownAt));
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
  const maxTimer = setTimeout(dismiss, SPLASH_MAX_MS);
  // The first page in, whether cinejoy.pk or the error screen (a failed
  // load fires did-fail-load instead, then error.html finishes loading).
  win.webContents.once('did-finish-load', dismiss);
  win.once('closed', () => {
    clearTimeout(maxTimer);
    clearTimeout(showFallback);
    closeSplash();
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

  showSplash(win);
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
