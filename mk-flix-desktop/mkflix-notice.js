// Hides CineJoy's announcement popup. Injected into cinejoy.pk pages by both
// apps; safe to run more than once.
//
// On a device that hasn't seen it yet, the site opens a modal claiming that
// all issues are fixed, there are no ads and streams are in 4K. Those claims
// aren't Blendy Play's to make, so the popup is hidden whenever it appears.
//
// The site's markup is minified and can change, so the popup is recognised by
// what it says, not by a class name: a dialog or fixed overlay that says
// issues are fixed and also claims no ads or 4K. The page itself never
// matches (titles like "No Ads Allowed" next to a "4K" badge are on the page,
// not in an overlay, and don't claim anything was fixed), and neither do the
// site's other dialogs (sign-in, settings). The site isn't told the popup was
// dismissed, so it may try again on the next launch; it is hidden again then.
//
// This file is shared: the desktop app loads it from mk-flix-desktop/, the
// Android app from app/src/main/assets/. Keep the two copies identical.
(function () {
  "use strict";
  if (window.__mkflixNotice) return;
  window.__mkflixNotice = true;

  var CANDIDATES = [
    "dialog", "[role=dialog]", "[role=alertdialog]", "[aria-modal=true]",
    "[class*=modal i]", "[class*=popup i]", "[class*=dialog i]",
    "[class*=overlay i]", "[class*=announce i]", "[class*=notice i]",
    "body > div"
  ].join(",");

  function isAnnouncement(text) {
    if (!text || text.length > 2000) return false;
    var fixed = /(issues?|bugs?|problems?)[^.]{0,40}\b(fixed|resolved|sorted)|(fixed|resolved)[^.]{0,40}\b(issues?|bugs?|problems?)/i.test(text);
    var noAds = /no\s+(more\s+)?ads|ad[\s-]?free|without\s+ads/i.test(text);
    var fourK = /\b4k\b|ultra\s*hd|\buhd\b/i.test(text);
    return fixed && (noAds || fourK);
  }

  // The popup's outermost fixed layer, so its dimmed backdrop goes too. The
  // climb stops at any ancestor holding more than the popup's own text, so it
  // can never reach a wrapper around the page itself.
  function overlayOf(el) {
    var top = el;
    var size = (el.innerText || "").length;
    for (var n = el; n && n !== document.body; n = n.parentElement) {
      if ((n.innerText || "").length > size + 200) break;
      var pos = getComputedStyle(n).position;
      if (pos === "fixed" || pos === "absolute" || n.tagName === "DIALOG") top = n;
    }
    return top;
  }

  // Shown, and drawn over the page: a dialog, or inside a fixed layer.
  function floats(el) {
    if (el.tagName === "DIALOG") return el.open;
    var role = el.getAttribute("role");
    var dialogish = role === "dialog" || role === "alertdialog" || el.getAttribute("aria-modal") === "true";
    for (var n = el; n && n !== document.body; n = n.parentElement) {
      var cs = getComputedStyle(n);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      if (cs.position === "fixed") return true;
    }
    return dialogish && !!el.offsetParent;
  }

  function hide(el) {
    if (el.tagName === "DIALOG" && el.open && el.close) {
      try { el.close(); } catch (e) {}
    }
    el.setAttribute("data-mkflix-hidden", "");
    el.style.setProperty("display", "none", "important");
    // A modal usually locks page scrolling; release it.
    [document.documentElement, document.body].forEach(function (n) {
      if (n && n.style.overflow === "hidden") n.style.overflow = "";
    });
  }

  function scan() {
    if (!document.body) return;
    var nodes = document.querySelectorAll(CANDIDATES);
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.closest("[data-mkflix-hidden]") || (el.id && el.id.indexOf("mkflix") === 0)) continue;
      if (!floats(el)) continue;
      if (isAnnouncement(el.innerText)) hide(overlayOf(el));
    }
  }

  var queued = false;
  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; scan(); });
  }

  scan();
  new MutationObserver(queue).observe(document.documentElement, { childList: true, subtree: true });
})();
