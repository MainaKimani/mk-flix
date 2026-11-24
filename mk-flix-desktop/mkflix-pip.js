// Picture-in-picture on cinejoy.pk's player, for the Android phone app and
// the desktop app (not Android TV, which doesn't load this file). Injected
// into every cinejoy.pk page; safe to run more than once.
//
// The site's player bar already has a "Picture in Picture" button that calls
// the browser's picture-in-picture API (video.requestPictureInPicture()).
// - Desktop: Electron supports that API, so the site's button works as it is.
//   main.js calls auto() when the window is minimized and restored() when it
//   comes back (see "Picture-in-picture" there).
// - Android: the WebView doesn't have that API, so this file provides it,
//   handing the request to the app (MKFlixNative.enterPip), which shrinks the
//   whole app into Android's floating window. The app then calls mode(true)
//   and mode(false) as the window opens and closes, and control() for the
//   play/pause and skip buttons Android shows on it. This file also tells the
//   app whether a video is playing (MKFlixNative.pipState), so leaving the app
//   mid-film opens the window by itself.
//
// While the Android window is open, everything on the player except the video
// is hidden: the window is just the app made small, so the site's bars,
// paused-screen text and subtitles stay full size and would cover the
// picture. Subtitles come back with the full-size player. (On desktop the
// floating window shows the video alone anyway.)
//
// If the site's button is missing (it may hide it when the API is absent), a
// button that looks like the site's own is added before "Settings".
//
// How the site's player is built (checked on cinejoy.pk, November 2026): one
// div.player-root fills the window at /watch/...; its children are the
// <video>, a subtitle layer (.lp-subtitle), a paused-screen info layer, a
// gradient, and the top and bottom bars. Buttons carry aria-labels
// ("Picture in Picture", "Settings", "Fullscreen").
//
// This file is shared: the desktop app loads it from mk-flix-desktop/, the
// Android app from app/src/main/assets/. Keep the two copies identical.
(function () {
  "use strict";
  if (window.__mkflixPip) return;

  var N = window.MKFlixNative || {};
  var android = typeof N.enterPip === "function";
  if (android && !N.pipAvailable()) {
    // The phone can't (Android 7, picture-in-picture turned off for the
    // app, or a TV): leave the site as it is.
    window.__mkflixPip = { mode: function () {}, control: function () {}, failed: function () {} };
    return;
  }

  function onWatch() { return /^\/watch\/(movie|tv)\//.test(location.pathname); }
  function video() { return document.querySelector("video"); }

  // --- Android: the picture-in-picture API, backed by the app -----------------
  var pipVideo = null;
  var waiting = [];

  function settle(ok) {
    var list = waiting;
    waiting = [];
    list.forEach(function (w) {
      if (ok) {
        w.resolve({ width: innerWidth, height: innerHeight, onresize: null });
      } else {
        w.reject(new DOMException("Picture-in-picture is not available now.", "NotAllowedError"));
      }
    });
  }

  if (android) {
    try {
      Object.defineProperty(Document.prototype, "pictureInPictureEnabled", {
        configurable: true, get: function () { return true; }
      });
      Object.defineProperty(Document.prototype, "pictureInPictureElement", {
        configurable: true, get: function () { return pipVideo; }
      });
    } catch (e) {}
    HTMLVideoElement.prototype.requestPictureInPicture = function () {
      return new Promise(function (resolve, reject) {
        waiting.push({ resolve: resolve, reject: reject });
        N.enterPip();
        // The app answers with mode(true) or failed(); don't hang if it doesn't.
        setTimeout(function () { settle(!!pipVideo); }, 3000);
      });
    };
    // Android has no way back from the floating window but the user's own
    // tap on it, so there is nothing to do here.
    Document.prototype.exitPictureInPicture = function () { return Promise.resolve(); };

    var style = document.createElement("style");
    style.id = "mkflix-pip-style";
    style.textContent =
      "html.mkflix-pip .player-root>:not(video){visibility:hidden!important;}";
    (document.head || document.documentElement).appendChild(style);
  }

  function setInPip(on) {
    window.__mkflixInPip = on;
  }

  // Desktop: Electron's own window. Remember it for mkflix-player.js.
  document.addEventListener("enterpictureinpicture", function () { setInPip(true); }, true);
  document.addEventListener("leavepictureinpicture", function () { setInPip(false); }, true);

  // --- The button --------------------------------------------------------------
  var ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-full h-full">' +
    '<path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4"/>' +
    '<rect width="10" height="7" x="12" y="13" rx="2"/></svg>';

  function toggle() {
    var v = video();
    if (!v) return;
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(function () {});
      return;
    }
    v.disablePictureInPicture = false;
    v.requestPictureInPicture().catch(function () {});
  }

  function ensureButton() {
    if (!onWatch() || !document.pictureInPictureEnabled) return;
    var root = document.querySelector(".player-root");
    if (!root || root.querySelector('button[aria-label="Picture in Picture"]')) return;
    var next = root.querySelector('button[aria-label="Settings"]') ||
      root.querySelector('button[aria-label="Fullscreen"]');
    if (!next || !next.parentNode) return;
    var b = document.createElement("button");
    b.type = "button";
    b.className = next.className;
    b.title = "Picture in Picture";
    b.setAttribute("aria-label", "Picture in Picture");
    b.innerHTML = '<div style="width:24px;height:24px">' + ICON + "</div>";
    b.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    });
    next.parentNode.insertBefore(b, next);
  }

  // --- Android: tell the app what's playing --------------------------------------
  // Where the picture itself is, in CSS pixels: the <video> fills the player
  // and letterboxes the film inside it (object-fit: contain). The app hands
  // this to Android, which then zooms the film into the floating window
  // instead of covering the app with its icon on a plain card.
  function pictureRect(v) {
    var r = v.getBoundingClientRect();
    if (!r.width || !r.height) return [0, 0, 0, 0];
    var s = v.videoWidth && v.videoHeight ? Math.min(r.width / v.videoWidth, r.height / v.videoHeight) : 0;
    var w = s ? v.videoWidth * s : r.width;
    var h = s ? v.videoHeight * s : r.height;
    return [r.left + (r.width - w) / 2, r.top + (r.height - h) / 2, w, h].map(Math.round);
  }

  var lastState = "";
  function report() {
    if (!android) return;
    var v = video();
    var playing = !!(onWatch() && v && !v.paused && !v.ended && !window.__mkflixHold);
    var w = (v && v.videoWidth) || 16;
    var h = (v && v.videoHeight) || 9;
    var rect = v ? pictureRect(v) : [0, 0, 0, 0];
    var state = [playing, w, h].concat(rect).join(" ");
    if (state === lastState) return;
    lastState = state;
    N.pipState(playing, w, h, rect[0], rect[1], rect[2], rect[3]);
  }
  // Rotating the phone moves the picture.
  window.addEventListener("resize", report);
  ["play", "playing", "pause", "ended", "emptied", "loadedmetadata"].forEach(function (name) {
    window.addEventListener(name, function (e) {
      if (e.target && e.target.tagName === "VIDEO") report();
    }, true);
  });

  // The site changes page with history.pushState, which fires no event.
  setInterval(function () {
    ensureButton();
    report();
  }, 1000);
  ensureButton();
  report();

  // --- Called by the apps ----------------------------------------------------------
  var autoEntered = false;
  window.__mkflixPip = {
    // Android: the floating window opened (true) or closed (false).
    mode: function (on) {
      var v = video();
      if (on) {
        pipVideo = v;
        document.documentElement.classList.add("mkflix-pip");
        setInPip(true);
        if (v) v.dispatchEvent(new Event("enterpictureinpicture", { bubbles: true }));
        settle(true);
      } else {
        var was = pipVideo;
        pipVideo = null;
        document.documentElement.classList.remove("mkflix-pip");
        setInPip(false);
        if (was) was.dispatchEvent(new Event("leavepictureinpicture", { bubbles: true }));
      }
    },
    // Android: the app couldn't open the window.
    failed: function () { settle(false); },
    // Android: a button on the floating window.
    control: function (cmd) {
      var v = video();
      if (!v) return;
      if (cmd === "toggle") {
        if (v.paused || v.ended) {
          var p = v.play();
          if (p && p.catch) p.catch(function () {});
        } else {
          v.pause();
        }
      } else if (cmd === "back") {
        v.currentTime = Math.max(0, v.currentTime - 10);
      } else if (cmd === "forward") {
        v.currentTime = Math.min(v.duration || Infinity, v.currentTime + 10);
      }
    },
    // Desktop: the window was minimized. Run with a user gesture by main.js,
    // which the browser requires before it opens the window.
    auto: function () {
      var v = video();
      if (!onWatch() || !v || v.paused || v.ended || window.__mkflixHold ||
          document.pictureInPictureElement || !document.pictureInPictureEnabled) return;
      v.disablePictureInPicture = false;
      v.requestPictureInPicture().then(function () { autoEntered = true; }, function () {});
    },
    // Desktop: the window is back. Close the floating window only if
    // minimizing opened it; one the user opened with the button stays.
    restored: function () {
      if (!autoEntered) return;
      autoEntered = false;
      if (document.pictureInPictureElement) document.exitPictureInPicture().catch(function () {});
    }
  };
})();
