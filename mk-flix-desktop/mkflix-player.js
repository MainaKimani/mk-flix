// Blendy Play's player prompts on cinejoy.pk, for every app (Android phone,
// Android TV, desktop). Injected into every cinejoy.pk page; safe to run more
// than once.
//
// 1. "Still watching?" Once the site has moved on to another video by itself
//    (the next episode, or whatever it plays next), a counter runs: when
//    nobody has pressed a key, touched, clicked or moved the mouse for 90
//    minutes, playback pauses and the user is asked. It doesn't matter
//    whether it's a series or a film: what counts is that a video followed
//    another with nobody choosing it. This saves people who fell asleep from
//    burning through episodes and mobile data. A single film that nobody
//    touches is never interrupted, because nothing played on by itself.
// 2. Finished. At the end of a film or of a series' last episode, a card
//    counts down 10 seconds, then goes to the home page; "Go home now" goes
//    at once.
//
// Every exit goes to the home page, not back through history or to the
// title's page: the site adds a history entry each time it moves to the next
// episode, so "back" from episode 2 lands on episode 1. The move replaces the
// player in history, so Back on the home page doesn't reopen it.
//
// How the site behaves (checked on cinejoy.pk, November 2026): the player
// is a plain <video> in the page, at /watch/movie/<id> or
// /watch/tv/<id>/<season>/<episode>. Moving to the next episode changes the
// address a few seconds before the end, with a new <video> and no "ended"
// event. A film or a last episode fires "ended" and stays on its address.
// So "finished" is an "ended" event with the address unchanged shortly after,
// and "played on by itself" is a new address or a new <video> with no input
// in the seconds before it.
//
// The card goes inside the fullscreen element when there is one, so it shows
// over a fullscreen player too. It handles the remote's arrows and OK itself,
// before mkflix-tv.js sees them. While a held episode is waiting,
// window.__mkflixHold is true and mkflix-tv.js doesn't start it.
//
// This file is shared: the desktop app loads it from mk-flix-desktop/, the
// Android app from app/src/main/assets/. Keep the two copies identical.
(function () {
  "use strict";
  if (window.__mkflixPlayer) return;
  window.__mkflixPlayer = true;

  var ASK_AFTER_MS = 90 * 60 * 1000;
  // A change of video this soon after a key press, touch or click was the
  // user's choice, not autoplay.
  var CHOSEN_WITHIN_MS = 10 * 1000;
  var END_CHECK_MS = 3000;
  var COUNTDOWN_S = 10;

  // --- Activity --------------------------------------------------------------
  var lastInput = Date.now();
  function touched() { lastInput = Date.now(); }
  ["keydown", "pointerdown", "mousedown", "mousemove", "touchstart", "wheel"].forEach(function (name) {
    window.addEventListener(name, touched, { capture: true, passive: true });
  });

  // --- Where we are ----------------------------------------------------------
  function watchInfo(path) {
    var m = /^\/watch\/(movie|tv)\/(\d+)/.exec(path || "");
    return m ? { kind: m[1], id: m[2] } : null;
  }
  function video() { return document.querySelector("video"); }
  function goHome() { location.replace("/"); }

  // --- The card --------------------------------------------------------------
  var style = document.createElement("style");
  style.id = "mkflix-player-style";
  style.textContent =
    "#mkflix-player-card{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;" +
    "justify-content:center;background:rgba(0,0,0,.72);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;}" +
    "#mkflix-player-card .mkp-box{width:min(440px,calc(100vw - 32px));box-sizing:border-box;padding:28px 24px;" +
    "border-radius:16px;background:#111118;border:2px solid #e040fb;box-shadow:0 0 40px rgba(224,64,251,.35);" +
    "color:#fff;text-align:center;}" +
    "#mkflix-player-card h2{margin:0 0 8px;font-size:22px;font-weight:700;color:#fff;}" +
    "#mkflix-player-card p{margin:0 0 22px;font-size:15px;line-height:1.5;color:rgba(255,255,255,.75);}" +
    "#mkflix-player-card .mkp-actions{display:flex;gap:12px;}" +
    "#mkflix-player-card button{flex:1;min-height:48px;border-radius:12px;font-family:inherit;font-size:16px;font-weight:600;line-height:1.2;cursor:pointer;" +
    "border:2px solid rgba(255,255,255,.25);background:transparent;color:#fff;padding:10px 14px;}" +
    "#mkflix-player-card button.mkp-main{border:0;background:linear-gradient(90deg,#e040fb,#ff4060);}" +
    "#mkflix-player-card button:focus{outline:3px solid #00e5ff;outline-offset:3px;}";
  (document.head || document.documentElement).appendChild(style);

  var card = null;
  var cardKind = "";
  var countdown = null;

  // actions: [{ label, main, run }]. The first is selected.
  function showCard(kind, heading, text, actions) {
    removeCard();
    cardKind = kind;
    card = document.createElement("div");
    card.id = "mkflix-player-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-label", heading);
    var box = document.createElement("div");
    box.className = "mkp-box";
    var h = document.createElement("h2");
    h.textContent = heading;
    var p = document.createElement("p");
    p.textContent = text;
    var row = document.createElement("div");
    row.className = "mkp-actions";
    actions.forEach(function (a) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = a.label;
      if (a.main) b.className = "mkp-main";
      b.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        a.run();
      });
      row.appendChild(b);
    });
    box.appendChild(h);
    box.appendChild(p);
    box.appendChild(row);
    card.appendChild(box);
    (document.fullscreenElement || document.webkitFullscreenElement || document.body).appendChild(card);
    var first = row.querySelector("button");
    try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); }
    return p;
  }

  function removeCard() {
    clearInterval(countdown);
    countdown = null;
    if (card && card.parentNode) card.parentNode.removeChild(card);
    card = null;
    cardKind = "";
  }

  // The remote (and a keyboard): arrows move between the buttons, OK presses
  // one. Taken before the page or mkflix-tv.js sees them, so OK doesn't
  // also play or pause the video underneath.
  window.addEventListener("keydown", function (e) {
    if (!card) return;
    var buttons = Array.prototype.slice.call(card.querySelectorAll("button"));
    var at = buttons.indexOf(document.activeElement);
    var key = e.key;
    if (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown") {
      var step = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
      var next = buttons[Math.max(0, Math.min(buttons.length - 1, (at < 0 ? 0 : at + step)))];
      try { next.focus({ preventScroll: true }); } catch (err) { next.focus(); }
    } else if (key === "Enter" || key === " " || key === "NumpadEnter") {
      (buttons[at] || buttons[0]).click();
    } else {
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  // --- 1. Still watching? -----------------------------------------------------
  window.__mkflixHold = false;
  // A video played on by itself since the user last chose one.
  var autoplayed = false;

  function hold() {
    window.__mkflixHold = true;
    var v = video();
    if (v && !v.paused) v.pause();
    showCard("still", "Still watching?",
      "Playback is paused. Continue when you're ready.", [
        { label: "Continue watching", main: true, run: resume },
        { label: "Back to home", run: function () { release(); goHome(); } }
      ]);
  }

  function release() {
    window.__mkflixHold = false;
    touched();
    removeCard();
  }

  function resume() {
    release();
    var v = video();
    if (v) {
      var p = v.play();
      if (p && p.catch) p.catch(function () {});
    }
  }

  // While held, any video that starts (the site's own autoplay, or a
  // replacement <video>) is paused again. Media events don't bubble, but
  // a capturing listener on the window still sees them.
  window.addEventListener("play", function (e) {
    if (window.__mkflixHold && e.target && e.target.tagName === "VIDEO") e.target.pause();
  }, true);

  // The site changes page with history.pushState, which fires no event, so
  // the address and the <video> are checked every second.
  var lastPath = location.pathname;
  var lastVideo = video();
  setInterval(function () {
    var path = location.pathname;
    var v = video();
    var onWatch = !!watchInfo(path);

    if (path !== lastPath || (v && v !== lastVideo)) {
      var from = lastVideo;
      var wasWatching = !!watchInfo(lastPath);
      if (path !== lastPath && card) removeCard();
      lastPath = path;
      if (v) lastVideo = v;
      if (!onWatch) {
        autoplayed = false;
        window.__mkflixHold = false;
      } else if (wasWatching && from && v && v !== from) {
        // Another video took over. Nobody chose it if there was no input
        // just before: the site played on by itself.
        autoplayed = Date.now() - lastInput >= CHOSEN_WITHIN_MS;
      }
    }

    // Once it has played on by itself, ask at the 90th minute without input.
    if (autoplayed && onWatch && !window.__mkflixHold && !card && v && !v.paused &&
        Date.now() - lastInput >= ASK_AFTER_MS) {
      hold();
    }
  }, 1000);

  // --- 2. Finished ------------------------------------------------------------
  window.addEventListener("ended", function (e) {
    if (!e.target || e.target.tagName !== "VIDEO" || !watchInfo(location.pathname)) return;
    var path = location.pathname;
    var v = e.target;
    setTimeout(function () {
      // Still here and still at the end: a film, or the series' last episode.
      if (location.pathname !== path || !v.ended || card) return;
      finished();
    }, END_CHECK_MS);
  }, true);

  function finished() {
    var left = COUNTDOWN_S;
    var text = showCard("ended", "Finished", "", [
      { label: "Go home now", main: true, run: function () { removeCard(); goHome(); } }
    ]);
    function tick() {
      text.textContent = "Taking you back to browse some more in " + left + "s";
    }
    tick();
    countdown = setInterval(function () {
      left -= 1;
      if (left <= 0) {
        removeCard();
        goHome();
        return;
      }
      tick();
    }, 1000);
  }

  // Playing again after the end (rewinding to rewatch a scene) cancels the
  // countdown.
  ["play", "seeking"].forEach(function (name) {
    window.addEventListener(name, function (e) {
      if (cardKind === "ended" && e.target && e.target.tagName === "VIDEO") removeCard();
    }, true);
  });
})();
