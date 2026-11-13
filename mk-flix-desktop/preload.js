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
  isSubscribed: () => ipcRenderer.sendSync('mkflix:is-subscribed'),
  openPaywall: () => ipcRenderer.send('mkflix:open-paywall'),
  openSubscription: () => ipcRenderer.send('mkflix:open-subscription'),
});
