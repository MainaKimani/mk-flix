// Content script on cinejoy.pk: the tab shows "Blendy Play" and the Blendy
// Play icon instead of the site's own, like the desktop app's window title.
// (The address bar still shows cinejoy.pk; no extension can change that.)
//
// cinejoy.pk is a single-page app that sets document.title on every page
// change, so this watches <head> and puts both back whenever the site
// changes them.
//
// The icon is a data: URL that build.mjs puts in place of __ICON_DATA_URL__.
// A chrome-extension:// URL would need the icon listed as web-accessible,
// which lets any site detect that the extension is installed.
(function () {
  "use strict";
  var TITLE = "Blendy Play";
  var ICON = "__ICON_DATA_URL__";

  function apply() {
    if (document.title !== TITLE) document.title = TITLE;
    var head = document.head;
    if (!head) return;
    var ours = null;
    head.querySelectorAll('link[rel~="icon"]').forEach(function (link) {
      if (link.hasAttribute("data-blendy")) ours = link;
      else link.remove();
    });
    if (!ours) {
      ours = document.createElement("link");
      ours.rel = "icon";
      ours.type = "image/png";
      ours.href = ICON;
      ours.setAttribute("data-blendy", "");
      head.appendChild(ours);
    }
  }

  // At document_start there is no <head> yet: wait for it, then watch only
  // it (the title and icon links live there), not the whole page.
  function watchHead() {
    if (!document.head) return false;
    new MutationObserver(apply).observe(document.head, { childList: true, subtree: true, characterData: true });
    apply();
    return true;
  }
  if (!watchHead()) {
    var waiting = new MutationObserver(function () {
      if (watchHead()) waiting.disconnect();
    });
    waiting.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
