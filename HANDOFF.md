# MK-Flix — session handoff

Snapshot for picking the project back up in a fresh Claude Code session (e.g. on
a different Claude subscription or machine). Everything described here is already
committed and pushed; this file is the map.

## Repos

- **`mk-flix`** (this repo) — https://github.com/MainaKimani/mk-flix
  - `mk-flix-app/` — Android app (phone + Android TV), a WebView wrapper around cinejoy.pk
  - `mk-flix-desktop/` — Electron desktop app (Windows + Linux)
  - `branding/` — `make-icons.py` generates all icons, logos, splash and banner art
- **`mk-flix-be`** — https://github.com/MainaKimani/mk-flix-be (Django backend: auth, billing, M-Pesa). Lives at `../mk-flix-be` on the dev machine. **Confirm this repo is private.**

## What this product is

MK-Flix is a thin, ad-blocking wrapper around **cinejoy.pk** (a third party that
owns the streaming accounts and content). CineJoy identifies users by a 16-digit
account number (no emails). MK-Flix adds its own account layer + **M-Pesa
subscription billing** on top, and gates *playback* (not browsing) behind an
active subscription. Enforcement is inherently soft — a determined user can open
cinejoy.pk in a browser — so we bill for the app experience, not the content.

## Latest session — 2026-11-13

- **M-Pesa sandbox works end to end.** With Daraja sandbox keys in `.env` and an
  ngrok tunnel for the callback, three STK payments from a real Safaricom phone
  were settled by Safaricom's callback (ResultCode 0) and activated the
  subscription. One payment (08:01 UTC) is still **PENDING** because its
  callback never arrived; use it to test `reconcile_payments` (see below).
- **Production CORS fixed** (`mk-flix-be` `93af3b3`): the desktop gate calls the
  API from `file://`, i.e. `Origin: null`, which production would have blocked.
- **Callback path without "mpesa"** (`mk-flix-be` `6869b0b`): register
  `/api/payments/stk/callback/<token>` with Safaricom (Daraja is known to drop
  URLs containing "mpesa"/"safaricom"). No trailing slash. The old
  `/api/payments/mpesa/callback/<token>` still works.
- **Stale subscription after paying fixed** (`mk-flix` `0fab36c`): the gate only
  handed the app its session at sign-in, so after an app restart the native check
  ran with no session: padlocks stayed and Play opened the paywall until a
  sign-out/sign-in. The gate now re-sends the session on every check and waits
  (≤5 s) for the app to agree before opening the site.
- **Subscribers go straight to the site** (`mk-flix` `326f978`): see "Gate entry
  modes" below.
- The injected menu and padlock scripts were **tested on the real logged-in
  cinejoy.pk and work**.
- Tested by the user in the app: the payment flow and the stale-state bug. The
  gate's new routing was checked against the real page with a fake backend and
  bridge (7 cases) and the Android APK builds, but the routing has **not yet
  been confirmed in the running apps**.
- Local-only state on the dev machine: both plans are priced **KES 1** in
  `db.sqlite3` for sandbox testing (real placeholders: 99 / 299, restore with the
  command under "M-Pesa sandbox testing"), and `.claude/settings.local.json` in
  both repos allows Claude to run `git commit` (excluded from git via
  `.git/info/exclude`).

## Earlier work (newest first)

mk-flix commits:
- `326f978` subscribers go straight to the site; paywall explains why (expired / none)
- `0fab36c` gate re-sends the session on every check (stale padlock/Play fix)
- `94d79b6` handoff: CORS + injected scripts marked done
- `3be0ccb` back arrow on the paywall + subscription pages
- `dbdc4ee` golden padlock on posters while unsubscribed
- `d6e5d09` "My Subscription" menu entry + status page
- `d3fd5a4` playback gating (browse free, `/watch/` needs a subscription) + API base from config
- `7aada6f` the account gate (onboarding + M-Pesa paywall) wired into both apps
- `626bf14` / `f4dbb0b` startup splash (desktop + Android) and white-flash fix

mk-flix-be commits:
- `6869b0b` callback path `/api/payments/stk/callback/<token>` (40 tests)
- `93af3b3` CORS: the gate's `Origin: null` is always allowed outside DEBUG (35 tests)
- `cccf15c` reconciliation job, retries, 31 tests
- `97e075c` backend scaffold (accounts, billing, payments)

## How it fits together

**Startup → gate → site.** Both apps open on a local page `mkflix-account.html`
(the "gate"), not cinejoy.pk. The gate checks the backend for a subscription and
handles onboarding, M-Pesa payment, the "My Subscription" page, and saving the
CineJoy number. A signed-in user can **Browse without subscribing**; the gate
then sends the WebView/window to cinejoy.pk.

**Gate entry modes** (`checkAccess(mode)` in `mkflix-account.html`):
- **launch** — app start, sign-in, or a blocked Play (`openPaywall()`): an active
  subscriber goes straight to cinejoy.pk; otherwise the paywall shows a note
  (expired on <date> / cancelled / no subscription on this account).
- **subscription** — the "My Subscription" menu (`openSubscription()`, which loads
  `mkflix-account.html#subscription`) and right after a successful payment: the
  subscription page.
- Before opening the site as a subscriber, the gate re-sends the session to the
  app and waits until `MKFlixNative.isSubscribed()` is true (max 5 s), so the
  padlocks and the Play block never run on a stale native answer.

**Shared, injected scripts** (identical copies in `mk-flix-app/app/src/main/assets/`
and `mk-flix-desktop/` — keep them byte-identical):
- `mkflix-account.html` — the gate (views: welcome, auth, plans/paywall, paying, My Subscription, save CineJoy number, retry). API base from `MKFlixNative.getApiBase()`; JWT in `localStorage`; refresh-on-401.
- `mkflix-enforcer.js` — blocks navigation to a `/watch/` page when unsubscribed and opens the paywall (the player lives at `/watch/...`).
- `mkflix-menu.js` — adds a "My Subscription" item to cinejoy's **Settings submenu** (list holding Watch History/Shorts) and the **floating bottom bar** (fixed-to-bottom strip) — never the main nav. Clones a real item, swaps in a card icon.
- `mkflix-lock.js` — golden padlock on each poster (portrait `<img>`) while unsubscribed.
- `mkflix-footer.js`, `mkflix-logo.css` — branding (footer replacement, logo).

**Native bridge `window.MKFlixNative`** — the authoritative subscription check, so
a cinejoy page/ad can't fake a subscription:
- Android: `MkFlixBridge` in `MainActivity.java` (HTTP to `/me/subscription` on a bg thread, cached in `SharedPreferences`).
- Desktop: `preload.js` exposes it; `main.js` holds the session and does the HTTP check.
- Methods: `getApiBase()`, `saveSession(apiBase, access, refresh)`, `clearSession()`, `refreshSubscription()`, `isSubscribed()`, `openPaywall()`, `openSubscription()`.
- The desktop main process keeps the session in memory only; it relies on the gate re-sending it on every launch (it does, since `0fab36c`). Android persists it in `SharedPreferences`.

**Backend `mk-flix-be`** (Django 5.2 + DRF + simplejwt, M-Pesa borrowed from `../blendy-backend`, de-tenanted):
- `accounts` — email-login `CustomUser`; 16-digit CineJoy number **encrypted at rest** (Fernet, `FIELD_ENCRYPTION_KEY`).
- `billing` — `Plan` (seeded **Weekly**/**Monthly**, placeholder prices), per-user `Subscription` (renewals extend it).
- `payments` — `Payment` + `MpesaTransaction`, STK Push, token-authenticated callback, idempotent settle, `reconcile_payments` command (backoff retries).
- Endpoints: `POST /api/auth/{register,login,refresh}`, `GET/PUT/DELETE /api/auth/me/cinejoy-account`, `GET /api/plans`, `GET /api/me/subscription`, `POST /api/payments/mpesa/stk`, `GET /api/payments/<id>`, `POST /api/payments/stk/callback/<token>` (also accepted at `/api/payments/mpesa/callback/<token>`).
- Config in `mk-flix-be/.env` (gitignored; `.env.example` documents it). `ACCESS_TOKEN_LIFETIME` 60 min, `REFRESH_TOKEN_LIFETIME` 30 days. simplejwt is stateless → no server-side revocation.

## Running it locally (important gotchas)

**Backend:**
```
cd mk-flix-be && . .venv/bin/activate && python manage.py runserver   # 127.0.0.1:8000
```
Plans are seeded by migration. Grant yourself a subscription to test playback:
```
python manage.py shell -c "from django.contrib.auth import get_user_model as U; from billing.models import Plan,Subscription as S; u=U().objects.get(email='you@example.com'); s,_=S.objects.get_or_create(user=u); s.extend(Plan.objects.get(code='monthly'))"
```

**Pointing the apps at the backend** (the gate reads the URL from the app, not the HTML):
- Desktop: `MKFLIX_API_BASE` env var or `mk-flix-desktop/mkflix-config.json` (`apiBase`).
- Android: `mk-flix-app/app/src/main/assets/mkflix-config.json` (`apiBase`). For the emulator use `http://10.0.2.2:8000/api`, or `http://localhost:8000/api` **with `adb reverse tcp:8000 tcp:8000`**. Cleartext to loopback is allowed by `res/xml/network_security_config.xml`; production backend must be HTTPS.
- **Both `mkflix-config.json` files ship empty and must stay empty in commits.** A local testing value may be on disk uncommitted.

**Building the Android APK** — the normal path is `mk-flix-app/build-apk.sh`, BUT on this machine the Android **build-tools 34 `d8` crashes** on class files from the installed JDK. Workarounds used all session:
```
cd mk-flix-app && sed 's#build-tools/34.0.0#build-tools/36.0.0#' build-apk.sh > .b.sh \
  && ANDROID_HOME=~/Android/Sdk JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 bash .b.sh && rm .b.sh
```
(i.e. force build-tools **36** and **JDK 21**.) Android Studio/Gradle builds are unaffected. Output: `app/build/outputs/apk/debug/app-debug.apk`.

**Desktop:** `cd mk-flix-desktop && npm start` (or `npm run dist-win` / `dist-linux`).
For local testing: `MKFLIX_API_BASE=http://localhost:8000/api npm start`. Restart
the app fully after changing `main.js` or `preload.js`.

## M-Pesa sandbox testing

1. Daraja portal → My Apps → a sandbox app with **M-Pesa Express**. In
   `mk-flix-be/.env`: `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`,
   `MPESA_SHORTCODE=174379` (shared sandbox till) and `MPESA_PASSKEY` (the
   M-Pesa Express test passkey from the portal's simulator page).
2. `ngrok http 8000`, then
   `MPESA_CALLBACK_URL=https://<id>.ngrok-free.app/api/payments/stk/callback/<MPESA_WEBHOOK_TOKEN>`
   (no trailing slash; the ngrok URL changes on every restart).
   `MPESA_WEBHOOK_ENFORCE_IP=False` locally.
3. **Restart `runserver` after editing `.env`** — Django reads it only at
   startup; a server started earlier fails "Pay" with a missing callback URL.
4. Pay from an app with a real Safaricom number. Use KES 1 plans while testing:
   `Plan.objects.update(price=1)`; restore with
   `python manage.py shell -c "from billing.models import Plan as P; P.objects.filter(code='weekly').update(price=99); P.objects.filter(code='monthly').update(price=299)"`.

Quick checks without paying: request a Daraja OAuth token
(`get_provider('MPESA')._get_access_token()` in the Django shell), and POST a
made-up callback through the tunnel (expect `200`; a wrong token gives `401`).

## Not done yet / next steps

- **No release cut.** App versions still 1.4.0; no new APK/installers published. When ready: bump versions (`mk-flix-app/app/build.gradle.kts`, `mk-flix-desktop/package.json`), update READMEs, build artifacts.
- **Confirm the new gate routing in the running apps** (`326f978`): reopen while subscribed → listing, no padlocks; "My Subscription" → subscription page; an expired account → paywall with the expired note.
- **Finish the sandbox tests:** (a) decline the STK prompt → payment FAILED, no subscription; (b) lost callback → `python manage.py reconcile_payments` should settle the PENDING payment from 2026-11-13 08:01 UTC via Safaricom's status query (or stop ngrok, pay, then reconcile).
- **Then go live with M-Pesa:** Safaricom "Go Live" approval, live consumer key/secret, shortcode and passkey, `MPESA_BASE_URL=https://api.safaricom.co.ke`, the callback on the deployed HTTPS backend, `MPESA_WEBHOOK_IP_ALLOWLIST` set to Safaricom's IPs with `MPESA_WEBHOOK_ENFORCE_IP=True`, and the plan prices restored. **Open question — Paybill or Till?** The STK request is hard-coded as `CustomerPayBillOnline` with `PartyB` = the shortcode (Paybill). A Till (Buy Goods) number needs `CustomerBuyGoodsOnline` and separate store-number/till settings in `payments/services/providers/mpesa.py`.
- **Production backend:** deploy over HTTPS, Postgres, scheduled `reconcile_payments` (cron/systemd). CORS is handled: outside DEBUG, `null` (the desktop gate loaded from `file://`) is always allowed alongside any `CORS_ALLOWED_ORIGINS`, with credentials off — safe because auth is bearer tokens, not cookies. Android's WebView bypasses CORS for the gate via `setAllowUniversalAccessFromFileURLs`.
- **Confirm `mk-flix-be` repo is private** (it's a billing backend; no secrets committed, but still).

## Caveats worth re-reading

- The injected menu/lock scripts depend on **cinejoy.pk's real logged-in DOM**. They have since been **tested on the real logged-in site and work** (menu entry and padlocks). They stay written defensively (do nothing if they can't find the target), so if cinejoy changes its markup they go quiet rather than break the page; the likely tuning points then are: the settings-submenu detection (assumes one list holds Watch History/Shorts), the bottom-bar detection (assumes `position: fixed` at viewport bottom), and poster detection (assumes `<img>`, not CSS `background-image`).
- Repeated layout breakage earlier came from matching too broadly; `mkflix-menu.js` is now deliberately narrow (settings submenu + bottom bar only).

## Where the raw session lives

- Local transcripts (this machine), in `~/.claude/projects/-home-mk-dev-mk-flix/`: `01f7c073-67e5-47d5-8b14-f5a1d2d22235.jsonl` (the build-out) and `e7756eab-d8b0-46a7-bc93-1720d74eb355.jsonl` (2026-11-13: CORS, M-Pesa sandbox, gate fixes). On the same machine, `claude --resume` lists past sessions (filesystem-based, not tied to the account) and `claude -c` continues the most recent.
- On a different machine, this file + the two GitHub repos are the handoff.
