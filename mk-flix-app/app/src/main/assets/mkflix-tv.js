// MK-Flix TV mode for cinejoy.pk (Android TV / Google TV). MainActivity
// injects this only on TVs, as soon as each cinejoy.pk page is about to show
// and again when it finishes loading; it's safe to run more than once.
//
// cinejoy.pk is built for touch and mouse. On a TV the remote only has
// arrows, OK and Back, so this adds:
//  1. Layout: a 1280px-wide page (the site's desktop layout, with its top
//     menu) scaled to fill the screen. At the TV's native 960px the site
//     shows its tablet layout with a floating bottom menu.
//  2. Spatial navigation: arrows move a highlight to the nearest item in
//     that direction; rows of posters scroll sideways to follow it. With
//     nothing further up or down, the page scrolls instead.
//  3. OK opens the highlighted item.
//  4. On video pages: OK plays/pauses and left/right skip 10 s while the
//     video itself is highlighted (or nothing is); the remote's media keys
//     (play/pause, fast-forward, rewind) work anywhere.
// Pointer mode (an on-screen cursor, toggled with a long press on OK) is
// handled natively in MainActivity; it takes the arrow keys before they
// reach the page.
(function () {
  if (window.__mkflixTv) return;
  window.__mkflixTv = true;

  var LAYOUT_WIDTH = 1280;
  var SKIP_SECONDS = 10;

  // --- 1. Layout -----------------------------------------------------------
  function setViewport() {
    var meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport';
      (document.head || document.documentElement).appendChild(meta);
    }
    var want = 'width=' + LAYOUT_WIDTH;
    if (meta.getAttribute('content') !== want) meta.setAttribute('content', want);
  }
  setViewport();

  // --- Highlight ring --------------------------------------------------------
  var style = document.createElement('style');
  style.id = 'mkflix-tv-style';
  style.textContent =
    '.mkf-focus{outline:3px solid #e040fb!important;outline-offset:3px!important;' +
    'box-shadow:0 0 0 6px rgba(224,64,251,.35),0 0 28px rgba(0,229,255,.6)!important;' +
    'border-radius:12px;transition:box-shadow .12s ease-out;}' +
    // The site's own focus outline would double up with ours.
    '.mkf-focus:focus-visible{outline-color:#e040fb!important;}';
  (document.head || document.documentElement).appendChild(style);

  // --- 2. Spatial navigation -----------------------------------------------
  var FOCUSABLE = 'a[href],button,[role="button"],[role="link"],[role="tab"],[role="menuitem"],' +
    'input:not([type="hidden"]),select,textarea,summary,[tabindex]:not([tabindex="-1"]),video';
  var NATIVE_ACTIVATE = /^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/;
  var current = null;

  function usable(el) {
    if (el.disabled || el.closest('#mkflix-footer,[aria-hidden="true"],[inert]')) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.05;
  }

  // What the highlight can land on:
  // - inside a link (e.g. a poster card), the link itself, once;
  // - a plain container that's clickable but holds buttons or links (e.g.
  //   the hero banner with Play / + / info) gives way to what's inside it.
  // - a poster and its title often link to the same page as two separate
  //   links, one under the other; they count as one stop.
  function candidates() {
    var all = Array.prototype.filter.call(document.querySelectorAll(FOCUSABLE), usable);
    var usableSet = new Set(all);
    var kept = [];
    return all.filter(function (el) {
      var link = el.parentElement && el.parentElement.closest('a[href]');
      if (link && usableSet.has(link)) return false;
      if (el.tagName !== 'A' && el.tagName !== 'VIDEO') {
        var inner = el.querySelectorAll(FOCUSABLE);
        for (var i = 0; i < inner.length; i++) if (usableSet.has(inner[i])) return false;
      }
      if (el.tagName === 'A') {
        var href = el.getAttribute('href'), r = el.getBoundingClientRect();
        for (var k = 0; k < kept.length; k++) {
          var o = kept[k];
          if (o.href === href && gap(o.r.left, o.r.right, r.left, r.right) === 0
              && gap(o.r.top, o.r.bottom, r.top, r.bottom) < 40) return false;
        }
        kept.push({ href: href, r: r });
      }
      return true;
    });
  }

  function onScreen(r) {
    return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  }

  // Distance between two 1-D ranges (0 when they overlap).
  function gap(a1, a2, b1, b2) {
    return b2 < a1 ? a1 - b2 : (b1 > a2 ? b1 - a2 : 0);
  }

  function nearest(dir) {
    var list = candidates();
    if (!current || !document.contains(current)) {
      // First press: a visible Play button if there is one (like a TV app's
      // hero), otherwise the item closest to the top-left of the screen.
      var play = list.filter(function (el) {
        return /^\s*play\b/i.test(el.textContent || '') && onScreen(el.getBoundingClientRect());
      })[0];
      if (play) return play;
      var first = null, firstScore = Infinity;
      list.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (!onScreen(r)) return;
        var s = r.top * 2 + r.left;
        if (s < firstScore) { firstScore = s; first = el; }
      });
      return first;
    }
    var c = current.getBoundingClientRect();
    // An element whose box encloses the current one (a full-screen video
    // behind the player's controls) is only a fallback, when nothing else
    // lies in that direction.
    return pick(list, c, dir, false) || pick(list, c, dir, true);
  }

  function encloses(r, c) {
    return r.left <= c.left && r.right >= c.right && r.top <= c.top && r.bottom >= c.bottom;
  }

  function pick(list, c, dir, allowEnclosing) {
    var cx = c.left + c.width / 2, cy = c.top + c.height / 2;
    var best = null, bestScore = Infinity;
    list.forEach(function (el) {
      if (el === current || el.contains(current) || current.contains(el)) return;
      var r = el.getBoundingClientRect();
      if (!allowEnclosing && encloses(r, c)) return;
      var x = r.left + r.width / 2, y = r.top + r.height / 2;
      // Direction is judged by centres, so items lying inside a large
      // highlighted element (the player's controls over a full-screen
      // video) are still reachable.
      var main, cross;
      if (dir === 'right') {
        if (x <= cx + 1) return;
        main = Math.max(0, r.left - c.right); cross = gap(c.top, c.bottom, r.top, r.bottom);
      } else if (dir === 'left') {
        if (x >= cx - 1) return;
        main = Math.max(0, c.left - r.right); cross = gap(c.top, c.bottom, r.top, r.bottom);
      } else if (dir === 'down') {
        if (y <= cy + 1) return;
        main = Math.max(0, r.top - c.bottom); cross = gap(c.left, c.right, r.left, r.right);
      } else {
        if (y >= cy - 1) return;
        main = Math.max(0, c.top - r.bottom); cross = gap(c.left, c.right, r.left, r.right);
      }
      // Left/right stay within the row: at the end of a row nothing
      // happens, rather than jumping to another row.
      if ((dir === 'left' || dir === 'right') && cross > 0) return;
      // Prefer the nearest item, then the closest-aligned centre.
      var align = (dir === 'left' || dir === 'right') ? Math.abs(y - cy) : Math.abs(x - cx);
      var score = main + cross * 4 + align * 0.1;
      if (score < bestScore) { bestScore = score; best = el; }
    });
    return best;
  }

  function highlight(el, dir) {
    if (current) current.classList.remove('mkf-focus');
    current = el;
    el.classList.add('mkf-focus');
    if (!NATIVE_ACTIVATE.test(el.tagName) && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    try { el.focus({ preventScroll: true }); } catch (e) { /* not focusable; the ring still shows */ }
    el.scrollIntoView({
      block: (dir === 'left' || dir === 'right') ? 'nearest' : 'center',
      inline: 'center',
      behavior: 'smooth'
    });
    setTimeout(rememberPlace, 400);   // after the smooth scroll settles
  }

  function scrollableParent(el) {
    for (var p = el && el.parentElement; p; p = p.parentElement) {
      var cs = getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 4) return p;
    }
    return document.scrollingElement || document.documentElement;
  }

  // --- 4. Video ------------------------------------------------------------
  function video() { return document.querySelector('video'); }
  function onWatchPage() { return /^\/watch\//.test(location.pathname); }
  function togglePlay(v) { if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } else { v.pause(); } }
  function skip(v, s) { if (isFinite(v.duration)) v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + s)); }

  var ARROWS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

  document.addEventListener('keydown', function (e) {
    var key = e.key;
    var active = document.activeElement;
    var typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
    var v = video();

    // Remote media keys, anywhere a video exists.
    if (v && (key === 'MediaPlayPause' || key === 'MediaPlay' || key === 'MediaPause')) {
      if (key === 'MediaPlay') v.play(); else if (key === 'MediaPause') v.pause(); else togglePlay(v);
      e.preventDefault(); e.stopImmediatePropagation(); return;
    }
    if (v && (key === 'MediaFastForward' || key === 'MediaTrackNext')) { skip(v, SKIP_SECONDS); e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (v && (key === 'MediaRewind' || key === 'MediaTrackPrevious')) { skip(v, -SKIP_SECONDS); e.preventDefault(); e.stopImmediatePropagation(); return; }

    // On a video page, with the video (or nothing) highlighted, OK and
    // left/right control playback; up/down still move to the controls.
    var onVideo = v && onWatchPage() && (!current || current === v || !document.contains(current));
    if (onVideo && (key === 'Enter' || key === ' ')) { togglePlay(v); e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (onVideo && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      skip(v, key === 'ArrowLeft' ? -SKIP_SECONDS : SKIP_SECONDS);
      e.preventDefault(); e.stopImmediatePropagation(); return;
    }

    var dir = ARROWS[key];
    if (dir) {
      if (typing && (dir === 'left' || dir === 'right')) return;   // move the text cursor
      var next = nearest(dir);
      if (next) {
        highlight(next, dir);
      } else if (dir === 'up' || dir === 'down') {
        scrollableParent(current).scrollBy({ top: (dir === 'down' ? 1 : -1) * innerHeight * 0.6, behavior: 'smooth' });
      }
      e.preventDefault(); e.stopImmediatePropagation();
      return;
    }

    // 3. OK opens the highlighted item. Links, buttons and form fields
    // already react to Enter themselves; anything else gets a click.
    if (key === 'Enter' && current && document.contains(current) && !NATIVE_ACTIVATE.test(current.tagName)) {
      current.click();
      e.preventDefault(); e.stopImmediatePropagation();
    }
  }, true);

  // The site can re-render the element we highlighted (e.g. the hero banner
  // rotating to its next slide redraws its Play button). Move the highlight
  // to whatever is now in the same place, rather than losing it.
  var lastCentre = null;
  function rememberPlace() {
    if (current && document.contains(current)) {
      var r = current.getBoundingClientRect();
      lastCentre = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
  }
  setInterval(rememberPlace, 500);
  new MutationObserver(function () {
    setViewport();
    if (current && !document.contains(current)) {
      current = null;
      if (!lastCentre) return;
      var hit = document.elementFromPoint(lastCentre.x, lastCentre.y);
      var list = hit ? candidates() : [];
      for (var el = hit; el; el = el.parentElement) {
        if (list.indexOf(el) >= 0) {
          current = el;
          el.classList.add('mkf-focus');
          try { el.focus({ preventScroll: true }); } catch (e) { /* ring still shows */ }
          break;
        }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
