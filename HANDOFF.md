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

## What was built this session (newest first)

mk-flix commits:
- `3be0ccb` back arrow on the paywall + subscription pages
- `dbdc4ee` golden padlock on posters while unsubscribed
- `d6e5d09` "My Subscription" menu entry + status page
- `d3fd5a4` playback gating (browse free, `/watch/` needs a subscription) + API base from config
- `7aada6f` the account gate (onboarding + M-Pesa paywall) wired into both apps
- `626bf14` / `f4dbb0b` startup splash (desktop + Android) and white-flash fix

mk-flix-be commits:
- `cccf15c` reconciliation job, retries, 31 tests
- `97e075c` backend scaffold (accounts, billing, payments)

## How it fits together

**Startup → gate → site.** Both apps open on a local page `mkflix-account.html`
(the "gate"), not cinejoy.pk. The gate checks the backend for a subscription and
handles onboarding, M-Pesa payment, the "My Subscription" page, and saving the
CineJoy number. A signed-in user can **Browse without subscribing**; the gate
then sends the WebView/window to cinejoy.pk.

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
- Methods: `getApiBase()`, `saveSession(apiBase, access, refresh)`, `clearSession()`, `refreshSubscription()`, `isSubscribed()`, `openPaywall()`.

**Backend `mk-flix-be`** (Django 5.2 + DRF + simplejwt, M-Pesa borrowed from `../blendy-backend`, de-tenanted):
- `accounts` — email-login `CustomUser`; 16-digit CineJoy number **encrypted at rest** (Fernet, `FIELD_ENCRYPTION_KEY`).
- `billing` — `Plan` (seeded **Weekly**/**Monthly**, placeholder prices), per-user `Subscription` (renewals extend it).
- `payments` — `Payment` + `MpesaTransaction`, STK Push, token-authenticated callback, idempotent settle, `reconcile_payments` command (backoff retries).
- Endpoints: `POST /api/auth/{register,login,refresh}`, `GET/PUT/DELETE /api/auth/me/cinejoy-account`, `GET /api/plans`, `GET /api/me/subscription`, `POST /api/payments/mpesa/stk`, `GET /api/payments/<id>`, `POST /api/payments/mpesa/callback/<token>`.
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

## Not done yet / next steps

- **No release cut.** App versions still 1.4.0; no new APK/installers published. When ready: bump versions (`mk-flix-app/app/build.gradle.kts`, `mk-flix-desktop/package.json`), update READMEs, build artifacts.
- **M-Pesa needs live Daraja credentials** in `.env` + the callback URL (with its secret token) registered with Safaricom. Until then STK "Pay" fails; use the shell grant above to test the subscribed path. The `MANUAL` payment provider settles locally for tests.
- **Production backend:** deploy over HTTPS, Postgres, scheduled `reconcile_payments` (cron/systemd), and a CORS/origin policy that lets the apps' `fetch()` through (they call from a `file://`/`null` origin).
- **Confirm `mk-flix-be` repo is private** (it's a billing backend; no secrets committed, but still).

## Caveats worth re-reading

- The injected menu/lock scripts depend on **cinejoy.pk's real logged-in DOM**, which was never directly inspected this session (the Chrome extension wasn't connected; the settings submenu/bottom bar need the user's CineJoy login). They were verified against synthetic markup and are written defensively (do nothing if they can't find the target). **Validate on the real logged-in site**; likely tuning points: the settings-submenu detection (assumes one list holds Watch History/Shorts), the bottom-bar detection (assumes `position: fixed` at viewport bottom), and poster detection (assumes `<img>`, not CSS `background-image`).
- Repeated layout breakage earlier came from matching too broadly; `mkflix-menu.js` is now deliberately narrow (settings submenu + bottom bar only).

## Where the raw session lives

- Local transcript (this machine): `~/.claude/projects/-home-mk-dev-mk-flix/01f7c073-67e5-47d5-8b14-f5a1d2d22235.jsonl`. On the same machine, `claude --resume` lists past sessions (filesystem-based, not tied to the account) and `claude -c` continues the most recent.
- On a different machine, this file + the two GitHub repos are the handoff.
