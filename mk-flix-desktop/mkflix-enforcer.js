// Playback gate, injected into cinejoy.pk pages by both apps (shared, kept
// identical). Browsing is free; only playback is gated. The player lives at
// /watch/..., so this blocks any attempt to reach a /watch/ page while there is
// no active subscription and sends the user to the paywall instead.
//
// Whether the user is subscribed is decided by the native app (window.MKFlixNative),
// which checks the MK-Flix backend itself — a page script here can't fake it.
// If the bridge is absent (e.g. opened in a plain browser) this does nothing.
(function () {
  "use strict";
  if (window.__mkflixEnforcer) return;
  window.__mkflixEnforcer = true;

  var B = window.MKFlixNative;

  function subscribed() {
    try { return !B || B.isSubscribed(); } catch (e) { return true; } // fail open
  }
  function isWatch(path) { return /^\/watch\//.test(path || ""); }
  function pathOf(url) {
    try { return new URL(url, location.href).pathname; } catch (e) { return ""; }
  }
  function paywall() {
    try { if (B && B.openPaywall) B.openPaywall(); } catch (e) {}
  }

  // Already on a watch page (deep link or full reload).
  if (isWatch(location.pathname) && !subscribed()) { paywall(); return; }

  // cinejoy.pk is a single-page app: it changes page with history.pushState,
  // which fires no navigation event. Wrap it (and replaceState) so a move to a
  // /watch/ page is caught before it happens.
  ["pushState", "replaceState"].forEach(function (name) {
    var orig = history[name];
    history[name] = function (state, title, url) {
      if (url && isWatch(pathOf(url)) && !subscribed()) { paywall(); return; }
      return orig.apply(this, arguments);
    };
  });
  window.addEventListener("popstate", function () {
    if (isWatch(location.pathname) && !subscribed()) paywall();
  });

  // A tapped poster or Play link is an <a href="/watch/...">; stop it in the
  // capture phase, before the site's own handler runs.
  document.addEventListener("click", function (e) {
    if (subscribed()) return;
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (a && isWatch(pathOf(a.getAttribute("href")))) {
      e.preventDefault();
      e.stopPropagation();
      paywall();
    }
  }, true);
})();
