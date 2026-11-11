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
const { ipcRenderer, webFrame } = require('electron');

const host = location.hostname;
if (host === 'cinejoy.pk' || host.endsWith('.cinejoy.pk')) {
  const css = ipcRenderer.sendSync('mkflix:logo-css');
  if (css) webFrame.insertCSS(css);
}
