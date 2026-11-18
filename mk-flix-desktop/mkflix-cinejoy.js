// One sign-in for Blendy Play and CineJoy. Runs on cinejoy.pk pages.
//
// CineJoy keeps progress and lists under a 16-digit number, its only
// credential, and Blendy Play saves that number on the user's account. This:
//   - signs the device in to CineJoy with the saved number, when it isn't
//     signed in already (or is signed in to a different number);
//   - tells the app when CineJoy signs in to a number the app didn't know
//     (created or keyed in on CineJoy), so the gate saves it;
//   - after the email is confirmed, opens CineJoy's own create panel, where
//     the user passes CineJoy's captcha and makes the code themselves;
//   - signs CineJoy out after Blendy Play signs out;
//   - renames the panel: "Create Code", and tabs "Key in" / "Create".
// The CineJoy account stays optional: with no saved number nothing happens.
// It learned CineJoy's storage keys and login call from the site itself; if
// those change, signing in quietly stops and nothing else breaks.
(function () {
  if (window.__mkflixCinejoy) return;
  window.__mkflixCinejoy = true;

  var bridge = window.MKFlixNative;
  if (!bridge || !bridge.getCinejoyNumber) return;

  var TOKEN = "cinejoy_token";
  var ACCOUNT = "cinejoy_account_id";
  // Cached copies of the account's data; dropped with the session so the
  // next person on the device doesn't see them.
  var ACCOUNT_DATA = ["cinejoy_lists", "cinejoy_follows", "Cinejoy::Progress"];
  var LOGIN_URL = "https://server2.wing.st/api/auth/login";
  // Per tab: one sign-in attempt per number, so a failing one can't loop.
  var TRIED = "mkflix_cj_tried";

  function get(key) { try { return localStorage.getItem(key) || ""; } catch (e) { return ""; } }
  function set(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }
  function remove(key) { try { localStorage.removeItem(key); } catch (e) {} }

  function signOut() {
    remove(TOKEN);
    remove(ACCOUNT);
    ACCOUNT_DATA.forEach(remove);
  }

  // --- Sign out after Blendy Play did ------------------------------------
  var signOutNow = false;
  try { signOutNow = bridge.takeCinejoySignOut(); } catch (e) {}
  if (signOutNow && get(TOKEN)) {
    signOut();
    location.reload();
    return;
  }

  // --- Sign in with the saved number --------------------------------------
  var saved = "";
  try { saved = bridge.getCinejoyNumber() || ""; } catch (e) {}
  var current = get(ACCOUNT);

  function tried() { try { return sessionStorage.getItem(TRIED) || ""; } catch (e) { return ""; } }
  function markTried(n) { try { sessionStorage.setItem(TRIED, n); } catch (e) {} }

  // While this runs, the session on the device isn't reported as new: it is
  // the one being replaced.
  var signingIn = false;
  if (saved && (!get(TOKEN) || current !== saved) && tried() !== saved) {
    markTried(saved);
    signingIn = true;
    fetch(LOGIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: saved, device: "web" })
    }).then(function (res) {
      return res.ok ? res.json() : null;
    }).then(function (data) {
      if (!data || typeof data.token !== "string" || !data.token) { signingIn = false; return; }
      signOut(); // a different account's cached data, if any
      set(TOKEN, data.token);
      set(ACCOUNT, String(data.accountId || saved));
      // CineJoy reads its session when the page loads.
      location.reload();
    }).catch(function () { signingIn = false; });
  }

  // --- Learn a number CineJoy signed in with ------------------------------
  // Includes a session from before Blendy Play saved numbers, and one made
  // or keyed in on CineJoy's panel.
  var known = current;
  var creating = false;
  try { creating = bridge.takeCinejoyCreate(); } catch (e) {}

  setInterval(function () {
    var id = get(ACCOUNT).replace(/\s+/g, "");
    if (!signingIn && /^\d{16}$/.test(id) && get(TOKEN)) {
      if (id !== saved) {
        saved = id;
        try { bridge.cinejoySignedIn(id); } catch (e) {}
      }
      // The code is made and handed to the app, which keeps it: straight
      // back to Blendy Play's subscription page, where the gate saves it.
      if (creating && id !== known) {
        creating = false;
        try { bridge.cinejoyCreated(); } catch (e) {}
      }
      known = id;
    }
  }, 1000);

  // --- The panel: names, and opening it on "Create" -------------------------
  var TABS = { "Sign In": "Key in", "Register": "Create" };
  var HEADINGS = { "Create your account": "Create Code" };

  function text(el) { return (el.textContent || "").trim(); }

  // The two tabs share a parent: [Sign In][Register].
  function tabs() {
    var buttons = document.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i], t = text(b);
      if (t !== "Sign In" && t !== "Key in") continue;
      var next = b.nextElementSibling;
      if (next && next.tagName === "BUTTON" && (text(next) === "Register" || text(next) === "Create")) {
        return { signIn: b, register: next };
      }
    }
    return null;
  }

  function panel() {
    var t = tabs();
    if (!t) return null;
    var el = t.signIn.parentElement;
    while (el && el.parentElement && !el.querySelector("h2")) el = el.parentElement;
    return el;
  }

  // Change only the text nodes, so the site's own rendering keeps working.
  function rename(el, names) {
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) {
        var t = n.nodeValue.trim();
        if (names[t]) n.nodeValue = n.nodeValue.replace(t, names[t]);
      }
    }
  }

  function relabel() {
    var t = tabs();
    if (!t) return;
    rename(t.signIn, TABS);
    rename(t.register, TABS);
    var p = panel();
    if (p) {
      var heads = p.querySelectorAll("h2");
      for (var i = 0; i < heads.length; i++) rename(heads[i], HEADINGS);
    }
  }

  var queued = false;
  new MutationObserver(function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; relabel(); });
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  // Opened from the gate: Settings, then the account's Sign In button, then
  // the Create tab. Tries for a while as the page renders.
  if (creating) {
    var attempts = 0;
    var opener = setInterval(function () {
      attempts++;
      var t = tabs();
      if (t) {
        t.register.click();
        clearInterval(opener);
        return;
      }
      var buttons = document.querySelectorAll("button");
      for (var i = 0; i < buttons.length; i++) {
        if (text(buttons[i]) === "Sign In") { buttons[i].click(); break; }
      }
      if (attempts > 30) clearInterval(opener);
    }, 500);
  }
})();
