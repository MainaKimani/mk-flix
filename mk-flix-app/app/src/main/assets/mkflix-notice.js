// Closes CineJoy's announcement popup. Injected into cinejoy.pk pages by both
// apps; safe to run more than once.
//
// On a device that hasn't seen it yet, the site opens a sheet claiming that
// all issues are fixed, 4K is back and ads are disabled. Those claims aren't
// Blendy Play's to make, so the popup is closed as soon as it appears, with
// its own "Got it!" button, as a user would. The site then marks it seen and
// doesn't show it again on this device.
//
// It is closed, not hidden: a hidden popup is still open as far as the site
// knows, and an open sheet shrinks the page into a card and pushes the phone
// layout's bottom menu off-screen.
//
// The site's markup is minified and can change, so the popup is recognised by
// what it says: a "Got it" button inside a box that says all issues are fixed.
//
// This file is shared: the desktop app loads it from mk-flix-desktop/, the
// Android app from app/src/main/assets/. Keep the two copies identical.
(function () {
  "use strict";
  if (window.__mkflixNotice) return;
  window.__mkflixNotice = true;

  function close() {
    var buttons = document.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      if ((b.textContent || "").trim().indexOf("Got it") !== 0) continue;
      var box = b.parentElement;
      for (var k = 0; k < 6 && box; k++, box = box.parentElement) {
        if (/All issues are fixed/i.test(box.textContent || "")) {
          b.click();
          return;
        }
      }
    }
  }

  var queued = false;
  new MutationObserver(function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; close(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  close();
})();
