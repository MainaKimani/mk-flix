// Adds a "My Subscription" item to cinejoy.pk's navigation, so someone who chose
// to browse without subscribing (or wants to manage their plan) can get back to
// the paywall. Shared, identical, by both apps; injected into cinejoy pages.
//
// We don't control cinejoy.pk's markup, so rather than hardcode its class names
// this clones a real menu item and relabels it, inheriting the site's styling.
// It is deliberately narrow about WHERE it adds the item, so it never disturbs
// the main nav: only the Settings submenu (the list that holds Watch History /
// Shorts) on wide screens, and the floating bottom bar (a fixed strip anchored
// to the bottom of the viewport) on narrow screens. Items are matched by text,
// aria-label, title or href, so icon-only bars work too. It re-applies itself if
// the SPA redraws the menu, and gives its item a card icon rather than the
// cloned one so it reads as "subscription".
//
// Clicking it opens the MK-Flix gate (the paywall, or the account screen if
// already subscribed) through the native bridge, so it only appears in the apps.
(function () {
  "use strict";
  if (window.__mkflixMenu) return;
  var B = window.MKFlixNative;
  if (!B || !B.openPaywall) return; // only inside the MK-Flix apps
  window.__mkflixMenu = true;

  var MARK = "mkflix-sub-item"; // a class, since there may be more than one menu
  var ITEM_SEL = 'a,button,[role="menuitem"],[role="tab"],[role="link"],li';
  var KNOWN = ["home", "movies", "shows", "my list", "search", "settings", "watch history", "shorts"];
  // Labels found in the Settings submenu but not the main nav — used to tell the
  // two apart so we never touch the main nav.
  var SETTINGS_ONLY = ["watch history", "shorts"];
  var HREF_LABELS = [
    ["watch-history", "watch history"], ["/history", "watch history"],
    ["/shorts", "shorts"], ["/settings", "settings"], ["/account", "settings"],
    ["/profile", "settings"], ["/my-list", "my list"], ["/mylist", "my list"],
    ["/watchlist", "my list"], ["/movies", "movies"], ["/shows", "shows"],
    ["/series", "shows"], ["/search", "search"],
  ];

  // A card icon (currentColor, so it takes the menu's own colour).
  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="2" y="5" width="20" height="14" rx="2"></rect>' +
    '<line x1="2" y1="10" x2="22" y2="10"></line></svg>';

  function norm(s) { return (s || "").replace(/\s+/g, " ").trim().toLowerCase(); }

  function labelOf(el) {
    var t = norm(el.textContent);
    if (t) return t;
    if (el.getAttribute) {
      var a = norm(el.getAttribute("aria-label")) || norm(el.getAttribute("title"));
      if (a) return a;
    }
    var href = el.getAttribute && el.getAttribute("href");
    if (!href && el.querySelector) {
      var inner = el.querySelector("a[href]");
      if (inner) href = inner.getAttribute("href");
    }
    href = (href || "").toLowerCase();
    for (var i = 0; i < HREF_LABELS.length; i++) {
      if (href.indexOf(HREF_LABELS[i][0]) >= 0) return HREF_LABELS[i][1];
    }
    return "";
  }

  // The repeating item unit: climb while the parent wraps only this one child,
  // so we clone the whole <li> (or equivalent), not just the inner <a>.
  function unitOf(node) {
    var u = node;
    while (u.parentElement && u.parentElement.childElementCount === 1) u = u.parentElement;
    return u;
  }

  // True when `list` (or a near ancestor) is a strip fixed to the bottom of the
  // screen — cinejoy.pk's floating bottom bar on narrow layouts.
  function isBottomBar(list) {
    var el = list;
    for (var hops = 0; el && hops < 6; hops++, el = el.parentElement) {
      var cs;
      try { cs = getComputedStyle(el); } catch (e) { continue; }
      if (cs && (cs.position === "fixed" || cs.position === "sticky")) {
        var r = el.getBoundingClientRect();
        if (r.height > 0 && r.top > window.innerHeight * 0.5 && r.bottom >= window.innerHeight - 4) return true;
      }
    }
    return false;
  }

  function relabel(root, to) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var first = true, node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue && node.nodeValue.trim()) {
        node.nodeValue = first ? to : "";
        first = false;
      }
    }
    // When the item had no text (an icon-only bar) we leave it icon-only.
  }

  // Swap the cloned item's icon for our card icon, keeping the original's
  // classes and size so it lines up with its neighbours.
  function setIcon(pay) {
    var existing = pay.querySelector('svg,img,i,[class*="icon"],[class*="Icon"]');
    var holder = document.createElement("span");
    holder.innerHTML = ICON;
    var svg = holder.firstChild;
    if (existing) {
      var cls = existing.getAttribute && existing.getAttribute("class");
      if (cls) svg.setAttribute("class", cls);
      if (existing.getAttribute) {
        if (existing.getAttribute("width")) svg.setAttribute("width", existing.getAttribute("width"));
        if (existing.getAttribute("height")) svg.setAttribute("height", existing.getAttribute("height"));
      }
      if (existing.style && existing.style.cssText) svg.style.cssText = existing.style.cssText;
      existing.replaceWith(svg);
    } else {
      svg.setAttribute("width", "22");
      svg.setAttribute("height", "22");
      pay.insertBefore(svg, pay.firstChild);
    }
  }

  function buildFrom(unit) {
    var pay = unit.cloneNode(true);
    if (pay.removeAttribute) pay.removeAttribute("id");
    pay.classList.add(MARK);
    setIcon(pay);
    relabel(pay, "My Subscription");
    if (pay.setAttribute) {
      pay.setAttribute("aria-label", "My Subscription");
      pay.setAttribute("title", "My Subscription");
    }
    if (pay.removeAttribute) pay.removeAttribute("href");
    var links = pay.querySelectorAll ? pay.querySelectorAll("a[href]") : [];
    for (var i = 0; i < links.length; i++) links[i].removeAttribute("href");
    pay.style.cursor = "pointer";
    pay.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      // openSubscription opens the gate on the subscription page; openPaywall
      // would send a subscriber straight back to the site.
      try {
        if (B.openSubscription) B.openSubscription();
        else B.openPaywall();
      } catch (_) {}
    }, true);
    return pay;
  }

  function addTo(list, items) {
    if (list.querySelector("." + MARK)) return;
    var settingsUnit = items["settings"];
    var template = settingsUnit || items[Object.keys(items)[0]];
    var pay = buildFrom(template);
    if (settingsUnit && settingsUnit.parentElement === list) {
      list.insertBefore(pay, settingsUnit.nextSibling); // Settings, My Subscription, ...
    } else {
      var last = null;
      for (var key in items) if (items[key].parentElement === list) last = items[key];
      if (last) list.insertBefore(pay, last.nextSibling);
      else list.appendChild(pay);
    }
  }

  function inject() {
    // Group every known nav item by the list that holds it.
    var nodes = document.querySelectorAll(ITEM_SEL);
    var lists = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.classList && n.classList.contains(MARK)) continue;
      if (n.closest && n.closest("." + MARK)) continue;
      var label = labelOf(n);
      if (KNOWN.indexOf(label) < 0) continue;
      var list = unitOf(n).parentElement;
      if (!list) continue;
      var entry = null;
      for (var j = 0; j < lists.length; j++) { if (lists[j].list === list) { entry = lists[j]; break; } }
      if (!entry) { entry = { list: list, items: {} }; lists.push(entry); }
      if (!entry.items[label]) entry.items[label] = unitOf(n);
    }

    for (var k = 0; k < lists.length; k++) {
      var e = lists[k];
      if (Object.keys(e.items).length < 2) continue; // be sure it's a menu
      // Only the Settings submenu (holds Watch History/Shorts) or the floating
      // bottom bar — never the main nav, whose layout we must not disturb.
      var isSettingsMenu = SETTINGS_ONLY.some(function (l) { return e.items[l]; });
      if (!isSettingsMenu && !isBottomBar(e.list)) continue;
      addTo(e.list, e.items);
    }
  }

  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    (window.requestAnimationFrame || window.setTimeout)(function () {
      scheduled = false;
      inject();
    }, 0);
  }

  inject();
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
})();
