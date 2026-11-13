// Puts a small golden padlock on the bottom-right of each show/movie poster on
// cinejoy.pk while the user has no active subscription, as a hint that the
// content won't play (the playback gate, mkflix-enforcer.js, actually blocks it).
// Shared, identical, by both apps; injected into cinejoy pages.
//
// Subscription is read from the native bridge (window.MKFlixNative). When the
// user is subscribed — or the bridge is absent (a plain browser) — no padlocks
// are shown, and any already placed are removed. It re-scans as the SPA loads
// more tiles. Posters are found by shape (a portrait image of reasonable size),
// so no cinejoy.pk class names are hardcoded; the lock is pointer-events: none,
// so taps still reach the tile.
(function () {
  "use strict";
  if (window.__mkflixLock) return;
  var B = window.MKFlixNative;
  window.__mkflixLock = true;

  var MARK = "mkflix-lock";
  var STYLE_ID = "mkflix-lock-style";
  var CSS =
    "." + MARK + "{position:absolute;width:26px;height:26px;" +
    "display:flex;align-items:center;justify-content:center;border-radius:50%;" +
    "background:rgba(0,0,0,0.55);color:#FFCA3A;pointer-events:none;z-index:5;" +
    "box-shadow:0 1px 4px rgba(0,0,0,0.55)}" +
    "." + MARK + " svg{width:16px;height:16px;display:block}";
  var LOCK_SVG =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2' +
    'a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0' +
    '-2-2h-1V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 0 1 6 0v3H9zm3 3.5a1.6 1.6 0 0 1 .8 3v1.6' +
    'a.8.8 0 0 1-1.6 0v-1.6a1.6 1.6 0 0 1 .8-3z"/></svg>';

  function subscribed() {
    try { return !B || B.isSubscribed(); } catch (e) { return true; } // no lock on failure
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID) || !document.head) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function isPoster(img) {
    var r = img.getBoundingClientRect();
    // Portrait, and big enough to be a poster rather than an icon or avatar.
    return r.width >= 60 && r.height >= 90 && r.height >= r.width * 1.1;
  }

  // Put the lock on the poster image's own bottom-right corner. The image's
  // parent becomes the positioning context, and the lock is offset to the
  // image's box, so a title below the poster (in the same card) doesn't push it.
  function addLock(img) {
    if (img.getAttribute("data-mkflix-locked")) return;
    var frame = img.parentElement;
    if (!frame) return;
    var cs;
    try { cs = getComputedStyle(frame); } catch (e) { return; }
    if (cs.position === "static") frame.style.position = "relative";
    var lock = document.createElement("span");
    lock.className = MARK;
    lock.innerHTML = LOCK_SVG;
    lock.style.left = (img.offsetLeft + img.offsetWidth - 26 - 6) + "px";
    lock.style.top = (img.offsetTop + img.offsetHeight - 26 - 6) + "px";
    frame.appendChild(lock);
    img.setAttribute("data-mkflix-locked", "1");
  }

  function removeAll() {
    var locks = document.querySelectorAll("." + MARK);
    for (var i = 0; i < locks.length; i++) locks[i].remove();
    var marked = document.querySelectorAll("img[data-mkflix-locked]");
    for (var j = 0; j < marked.length; j++) marked[j].removeAttribute("data-mkflix-locked");
  }

  function run() {
    if (subscribed()) { removeAll(); return; }
    ensureStyle();
    var imgs = document.querySelectorAll("img");
    for (var i = 0; i < imgs.length; i++) {
      if (isPoster(imgs[i])) addLock(imgs[i]);
    }
  }

  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    (window.requestAnimationFrame || window.setTimeout)(function () {
      scheduled = false;
      run();
    }, 0);
  }

  run();
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
})();
