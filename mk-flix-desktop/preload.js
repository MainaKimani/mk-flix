// Runs in each page before the page's own content, so styles added here are
// in place before the first paint.
//
// On cinejoy.pk it applies mkflix-logo.css, which draws the MK-Flix icon in
// place of the site's header logo. Doing this any later (e.g. on dom-ready)
// lets the old logo show for a moment on startup.
//
// Preloads run sandboxed and can't read files, so the CSS comes from the
// main process over a synchronous IPC call. It's a single small message per
// page load.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

const host = location.hostname;
if (host === 'cinejoy.pk' || host.endsWith('.cinejoy.pk')) {
  const css = ipcRenderer.sendSync('mkflix:logo-css');
  if (css) webFrame.insertCSS(css);
}

// Bridge exposed to the account gate and the playback enforcer (window.MKFlixNative).
// The main process checks the backend and decides whether playback is allowed,
// so a cinejoy.pk page can't grant itself a subscription through this.
contextBridge.exposeInMainWorld('MKFlixNative', {
  getApiBase: () => ipcRenderer.sendSync('mkflix:api-base'),
  saveSession: (apiBase, access, refresh) =>
    ipcRenderer.send('mkflix:save-session', { apiBase, access, refresh }),
  clearSession: () => ipcRenderer.send('mkflix:clear-session'),
  refreshSubscription: () => ipcRenderer.send('mkflix:refresh-subscription'),
  setSubscribed: (active) => ipcRenderer.send('mkflix:set-subscribed', active === true),
  showSplash: () => ipcRenderer.send('mkflix:splash', true),
  hideSplash: () => ipcRenderer.send('mkflix:splash', false),
  isSubscribed: () => ipcRenderer.sendSync('mkflix:is-subscribed'),
  openPaywall: () => ipcRenderer.send('mkflix:open-paywall'),
  openSubscription: () => ipcRenderer.send('mkflix:open-subscription'),
  // Version and platform, sent to the backend as X-App-Version / X-App-Platform.
  getAppVersion: () => appInfo().version,
  getPlatform: () => appInfo().platform,
  // This install's id and name, sent when signing in (the devices list).
  getDeviceId: () => appInfo().deviceId,
  getDeviceName: () => appInfo().deviceName,
  // In-app updates (see updater.js). Only the account gate gets real answers.
  checkUpdate: () => ipcRenderer.invoke('mkflix:update-check'),
  startUpdate: () => ipcRenderer.invoke('mkflix:update-start'),
  onUpdateProgress: (callback) => {
    ipcRenderer.removeAllListeners('mkflix:update-progress');
    ipcRenderer.on('mkflix:update-progress', (_event, p) => callback(p.received, p.total));
  },
  dismissUpdate: (version) => ipcRenderer.send('mkflix:update-later', version),
  openDownloads: () => ipcRenderer.send('mkflix:open-downloads'),
  // One sign-in for Blendy Play and CineJoy (main.js, "CineJoy account").
  // The gate's calls:
  setCinejoyNumber: (n) => ipcRenderer.send('mkflix:cj-set-number', String(n || '')),
  getCinejoyPending: () => ipcRenderer.sendSync('mkflix:cj-pending'),
  cinejoyPendingSaved: (n) => ipcRenderer.send('mkflix:cj-pending-saved', String(n || '')),
  createCinejoyCode: () => ipcRenderer.send('mkflix:cj-create'),
  // mkflix-cinejoy.js's calls, on cinejoy.pk:
  getCinejoyNumber: () => ipcRenderer.sendSync('mkflix:cj-number'),
  takeCinejoyCreate: () => ipcRenderer.sendSync('mkflix:cj-take-create'),
  takeCinejoySignOut: () => ipcRenderer.sendSync('mkflix:cj-take-sign-out'),
  cinejoySignedIn: (n) => ipcRenderer.send('mkflix:cj-signed-in', String(n || '')),
  cinejoyCreated: () => ipcRenderer.send('mkflix:cj-created'),
  cinejoyBusy: () => ipcRenderer.send('mkflix:cj-busy'),
});

let info = null;
function appInfo() {
  if (!info) info = ipcRenderer.sendSync('mkflix:app-info');
  return info;
}
