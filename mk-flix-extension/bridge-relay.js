// Content script on cinejoy.pk (isolated world). Passes the calls that
// bridge-page.js posts from the page's world on to the service worker, which
// is the only part that can open the gate or check the subscription.
//
// Only the calls named here go through; the worker checks them again.
(function () {
  "use strict";
  var CALLS = { openPaywall: 1, openSubscription: 1, refreshSubscription: 1 };

  window.addEventListener("message", function (e) {
    if (e.source !== window || !e.data || e.data.__blendy !== "page") return;
    if (!CALLS[e.data.call]) return;
    try {
      chrome.runtime.sendMessage({ from: "page", call: e.data.call });
    } catch (err) {
      // The extension was reloaded or updated under this tab: its old
      // content script can't reach the new worker. A page reload fixes it.
    }
  });
})();
