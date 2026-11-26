# Browser extension: plan

Blendy Play as a browser extension, for people who want to watch in a browser instead of
installing the app. It does what the desktop app does: it blocks ads on cinejoy.pk, runs our
scripts on cinejoy.pk's pages, and gates playback behind a Blendy Play subscription. All of
this happens inside the user's own browser.

Why an extension and not a website that proxies cinejoy.pk: the video host (lightspeed.st)
only serves cinejoy.pk. A real cinejoy.pk tab in the user's browser gets the videos normally,
and none of the video traffic goes through our server.

Status: phase 1 built in `mk-flix-extension/` (2026-11-26) and checked in headless Chrome against the
live site. Phases 2 to 5 to do.

## Decisions (agreed 2026-11-26)

| Question | Decision |
|---|---|
| Does an extension count toward the 4-device limit? | **Yes**, as one device per browser. A normal browser sign-in (the portal) still doesn't count, since the portal can't play anything (see "Backend") |
| Which browsers first | Chrome and Edge (one build), then Firefox. Both use Manifest V3 |
| Distribution | Chrome Web Store + Edge Add-ons + Firefox Add-ons. Chrome won't install extensions from outside its store for normal users, so the store is the only way in. See "Risks" |
| Same subscription as the apps? | Yes. Same account, plans, M-Pesa flow and gate |
| Name in the store | "Blendy Play", using the app's icon |
| Release | After 1.7.3 ships. The extension has its own version number, starting at 1.0.0 |

## Where it runs

| Platform | Works? |
|---|---|
| Windows, Linux, **macOS**: Chrome, Edge, Brave, Firefox | Yes. macOS is new reach: there's no Mac desktop build today |
| Android: Firefox | Yes, once it's on Firefox Add-ons |
| Android: Chrome | No. Chrome on Android has no extensions; those users keep the app |
| iPhone / iPad | No. A Safari extension needs a Mac, Xcode and the App Store. Out of scope |

## How it maps onto the desktop app

The desktop app is already "cinejoy.pk plus injected scripts plus a native bridge", which
is what an extension is. Each Electron part has a counterpart in the extension:

| Desktop (`mk-flix-desktop`) | Extension |
|---|---|
| `main.js` holds the session, checks `/me/subscription`, re-checks every 10 min | **Service worker** (`background.js`): same logic. Session kept in `chrome.storage.local`, re-checks on `chrome.alarms` |
| `preload.js` exposes `window.MKFlixNative` | A **page-world shim** (`bridge-page.js`) plus a **relay** content script (`bridge-relay.js`). See below |
| `executeJavaScript(...)` of each shared script on `dom-ready` | On `webNavigation.onDOMContentLoaded` for cinejoy.pk, the service worker calls `chrome.scripting.executeScript({ world: "MAIN" })`: first the state, then the shared scripts in the same order as `main.js` |
| `mkflix-logo.css` via preload before the first paint | Static content script: `css: ["mkflix-logo.css"]`, `run_at: document_start` |
| `adblock-hosts.txt` checked on every request | `declarativeNetRequest` rules generated from the same file at build time (102 distinct hosts). **For cinejoy.pk only**: the list includes general services (facebook.net, hubspot.com, intercom.io) that other sites need. A static rule covers requests cinejoy.pk makes; a session rule, kept in step with the tabs showing cinejoy.pk, covers everything else in those tabs (embedded players) |
| Popup and navigation guard | Ad hosts are also blocked as `main_frame`/`sub_frame`, so popunders land on a blocked page. A tab that cinejoy.pk opens and that isn't cinejoy.pk or a trusted site (YouTube, Vimeo) is closed (`tabs.onCreated` + `webNavigation.onCreatedNavigationTarget`) |
| Gate `mkflix-account.html` as a local file | The same file as an extension page (`gate.html`). The build moves its single inline `<script>` into `gate.js`, because Manifest V3 forbids inline scripts, and changes the gate's own CSP from `script-src 'unsafe-inline'` to `'self'`. It has no inline `on…=` handlers, so nothing else changes |
| Window title fixed to the app's name | `tab-brand.js` (content script): the tab reads "Blendy Play" with the Blendy icon, put back whenever the site changes them. The icon is inlined as a data URL at build time, so the extension's files don't have to be web-accessible, which would let sites detect it. The address bar still shows cinejoy.pk; no extension can change that |
| Splash | Dropped. A browser tab doesn't need one; the shim's `showSplash`/`hideSplash` do nothing |
| In-app updates (`updater.js`) | Dropped. The stores update extensions. The shim has no `checkUpdate`, which the gate already handles (`if (!N \|\| !N.checkUpdate)`) |
| Picture-in-picture | `mkflix-pip.js`'s desktop path: the browser's own PiP. No auto-enter on minimize (browsers don't allow that) |

### The bridge (`window.MKFlixNative`)

The shared scripts must run in the **page's world**: the enforcer wraps cinejoy.pk's own
`history.pushState`, and the PiP script patches `HTMLVideoElement.prototype`. A content script
in its default isolated world can't touch either. But the page's world can't use the
extension APIs. Hence two parts:

- **`bridge-page.js`** (MAIN world, injected first). It defines `window.MKFlixNative`. The
  synchronous getters (`isSubscribed`, `getApiBase`, `getCinejoyNumber`,
  `takeCinejoyCreate`, `takeCinejoySignOut`) read a snapshot that the service worker
  passes in as `args` of the same `executeScript` call. So the answers are there before any
  shared script runs, just as `sendSync` guaranteed in Electron. Calls that change something
  (`openPaywall`, `openSubscription`, `refreshSubscription`, `cinejoySignedIn`,
  `cinejoyCreated`, `cinejoyBusy`) post a message to the relay.
- **`bridge-relay.js`** (isolated content script on cinejoy.pk). It forwards those messages to
  the service worker with `chrome.runtime.sendMessage`. When the service worker's state
  changes (for example a subscription is found), it pushes the new snapshot into the page.

**Trust rule, the same as `main.js`'s `fromGate`/`fromCinejoy`.** The service worker only
accepts `saveSession`, `setSubscribed` and `cj-set-number` from the gate (its sender URL is
the extension's own `gate.html`). From cinejoy.pk tabs it accepts only the calls listed
above. So a cinejoy.pk page or ad script can't grant itself a subscription. Enforcement stays
as soft as in the apps, since anyone can uninstall the extension.

### Flow differences from the apps

The apps open on the gate. An extension user just goes to cinejoy.pk. So:

- **On install** the extension opens `gate.html` in a new tab (welcome → sign up/in).
- **Toolbar button** opens the gate on its subscription page.
- **Not signed in, or not subscribed** on cinejoy.pk: browsing works, posters get padlocks,
  and Play opens the gate's paywall in that same tab (`chrome.tabs.update`). This is the
  current `openPaywall()` behaviour.
- After sign-in or payment, the gate goes on to `https://cinejoy.pk/` in the same tab, as it
  does today (`window.location.href = CINEJOY_URL`).
- **CineJoy account step**: `mkflix-cinejoy.js` already does the sign-in through cinejoy.pk's
  `localStorage` and `fetch`, which work unchanged in the page's world. "Create your server
  key" opens `https://cinejoy.pk/settings` in the tab, as the desktop app does.

## Code layout

```
mk-flix-extension/
  manifest.json
  background.js        service worker: session, subscription check, alarms, tab rules
  bridge-page.js       MKFlixNative in the page's world
  bridge-relay.js      isolated content script: page <-> service worker
  gate-shim.js         MKFlixNative for gate.html (talks to the service worker)
  build.mjs            copies the shared files, splits the gate's script, makes DNR rules, zips
  icons/
  dist/                build output (gitignored)
```

**No third copy of the shared scripts.** They already live, byte-identical, in two places.
`build.mjs` copies them from `mk-flix-desktop/` into `dist/` and fails if the Android copy
differs. These files: `mkflix-account.html`, `mkflix-enforcer.js`, `mkflix-menu.js`,
`mkflix-lock.js`, `mkflix-notice.js`, `mkflix-player.js`, `mkflix-pip.js`,
`mkflix-cinejoy.js`, `mkflix-footer.js`, `mkflix-logo.css`, `adblock-hosts.txt`.

Permissions: `storage`, `alarms`, `scripting`, `webNavigation`, `tabs`,
`declarativeNetRequest`. Host permissions: `*://*.cinejoy.pk/*` and
`https://blendyplay.mainakimani.com/*`. The second one means the gate's API calls aren't
subject to CORS, so the backend's CORS settings don't change.

## Changes to the shared scripts

Kept small, so all three clients behave the same:

- **The gate's platform values.** The gate sends `X-App-Platform` from `getPlatform()`; the
  extension returns `"browser"`. Its device name is "Chrome on Windows", "Firefox on macOS",
  and so on, built from `navigator.userAgentData` or the user agent.
- **Gate copy.** Text that says "the app" gets checked: most of it still reads fine. Keep the
  copy rule: a CineJoy account is optional, and never point users at cinejoy.pk.
- Probably nothing else. Each script already no-ops when a bridge method is missing. That needs
  checking script by script during the build (phase 1).

## Backend (`mk-flix-be`)

- **`accounts/devices.py`: add `"browser"` to `APP_PLATFORMS`.** Today any sign-in without
  an app platform counts as the portal, and **portal sessions don't count toward the
  limit**. Without this change every extension sign-in would be free of the 4-device limit.
- **Portal tokens must not pass for an app.** Unlike the apps, an extension's pages can be
  opened in devtools, so someone could sign in on the portal and copy that session's tokens
  into the extension: playback without using up a device place. Fix: when a request carries
  an app platform, refuse it if its token's session is a portal one (the same 401
  `session_revoked` the apps already handle). Confirm first that nothing calls the API that way
  legitimately.
- `MIN_APP_VERSIONS`: add `"browser": config("MIN_APP_VERSION_BROWSER", default="")`, so an old
  extension can be told to update. The stores update extensions within a day or so anyway.
- Portal and dashboard device lists show the platform; check that "browser" reads well there.
- Request log: nothing to change, it already logs the platform header.
- Tests: a browser sign-in counts toward the limit, and a fifth one gets `device_limit`.

## Phases

1. **Skeleton (Chrome, unpacked). Done.** Manifest, build script, ad-blocking rules, logo CSS,
   the bridge pair and the shared scripts on cinejoy.pk, with "not subscribed" until phase 2.
   Checked in headless Chrome 157 on the live site: the gate opens on install and shows its
   welcome screen; every shared script loads; posters get padlocks; a move to `/watch/` opens
   the gate; an ad host is blocked on cinejoy.pk and still loads on other sites.
   Not checked: a person clicking through it, and the logo CSS by eye.
2. **Gate and session.** `gate.html` + `gate-shim.js`, service worker session and
   subscription checks, install/toolbar behaviour, paywall hand-off. Backend `"browser"`
   platform. Check: sign up, verify email, pay KES 1 on the live till, watch; sign the device
   out from the portal and confirm playback stops within the alarm period.
3. **CineJoy account + PiP + popups.** Server-key creation and sign-in on cinejoy.pk, PiP
   button, closing ad tabs.
4. **Firefox.** Same code. `background.scripts` next to `service_worker` in the manifest.
   `world: "MAIN"` needs Firefox 128 or later. Test on Firefox for Android too.
5. **Stores.** Listings, screenshots, a privacy policy page on the portal (the stores require
   one: what we store, which is the account token and device id), and a short "why each
   permission" note for review. Then add a download/install link on the product page.

## Risks

- **Store review.** This is the biggest unknown. An extension that only works on one
  third-party streaming site, and changes its look, may be questioned or rejected, especially
  on copyright grounds. Chrome has no practical way around its store. Firefox can sign an
  "unlisted" add-on for self-hosting, so it's the fallback. Submit an early phase-2 build to
  find out before spending time on phases 3–5.
- **cinejoy.pk changes its pages.** Same risk as in the apps, and the same scripts. A fix
  ships through the stores, usually within a day or two, rather than through our own update
  manifest.
- **It's easy to get around.** Uninstall the extension and cinejoy.pk still plays, as the
  terms already accept for the apps: we bill for the experience, not the content.
- **Office/VPN networks** that intercept cinejoy's video servers behave the same as in the apps.

## Not in this plan

- A website version that proxies cinejoy.pk (ruled out above).
- Safari/iOS.
- Chromecast. The extension doesn't change the hotlink problem.
