# Blendy Play (MK-Flix) — session handoff

Snapshot for picking the project back up in a fresh Claude Code session (e.g. on
a different Claude subscription or machine). Everything described here is already
committed and pushed; this file is the map.

The product is called **Blendy Play** in everything users see. The code,
repos, package ids and storage keys keep the old name **MK-Flix** on purpose
(see "The rename" below).

## Repos

- **`mk-flix`** (this repo) — https://github.com/MainaKimani/mk-flix
  - `mk-flix-app/` — Android app (phone + Android TV), a WebView wrapper around cinejoy.pk
  - `mk-flix-desktop/` — Electron desktop app (Windows + Linux)
  - `branding/` — `make-icons.py` generates all icons, logos, splash and banner art
  - `docs/terms-and-conditions-draft.md` — the Terms and Conditions source text
- **`mk-flix-be`** — https://github.com/MainaKimani/mk-flix-be (Django backend: auth, billing, M-Pesa, email, dashboard API). Lives at `../mk-flix-be`. **Confirm this repo is private.**
- **`blendy-play`** — https://github.com/MainaKimani/blendy-play (Angular 19 web portal: product page, customer account area, admin dashboard). Lives at `../blendy-play`. Deployed separately as a static site.

## What this product is

Blendy Play is a thin, ad-blocking wrapper around **cinejoy.pk** (a third party
that owns the streaming accounts and content). It adds its own account layer +
**M-Pesa subscription billing**, and gates *playback* (not browsing) behind an
active subscription. Enforcement is inherently soft — a determined user can open
cinejoy.pk in a browser — so we bill for the app experience, not the content.

A **CineJoy account is optional**: users can watch without one; signing in to
CineJoy (inside the app: the listing, then Settings, then Login) only carries
their experience across devices. User-facing text must never say a CineJoy
account is required, and must never point users at cinejoy.pk.

## Latest sessions — 2026-11-13 (afternoon) and 2026-11-14

- **Email works for real.** The cPanel mailbox `blendyplay@mainakimani.com`
  sends through `mail.mainakimani.com` (port 465, SSL); test emails to Gmail
  pass SPF, DKIM and DMARC (`_dmarc` record added 2026-11-14). Message-IDs use
  the sender's domain (`mk-flix-be` `168431c`).
- **Email verification with a 4-digit code** (`mk-flix-be` `b98b2c0`, gate
  `e07df8d`, portal `da7c94a`): see "Email verification" below.
- **Forgot password** (`mk-flix-be` `fb33082`, gate `bc9ccd4`, portal
  `5a80018`): see "Forgot password" below. Tested end to end, gate → email →
  portal → sign-in with the new password.
- **Passwords: 6 characters minimum** (`mk-flix-be` `8639a1b`) and a show/hide
  eye on every password field (gate `90f5da5`, portal `4b79415`).
- **Web portal built** (`blendy-play`) and **admin dashboard API** added
  (`mk-flix-be` `e44f359`). See "Web portal" and "Admin dashboard" below.
- **Customer self-service API** (`mk-flix-be` `10f93cc`): edit name/phone,
  change password, delete account, list own payments.
- **Renamed to Blendy Play** (`mk-flix` `3a6b2dc`): see "The rename".
- **Terms and Conditions** before paying: the gate's paywall has an unticked
  checkbox and a terms view (`mk-flix` `297ba70`); the backend refuses an STK
  push without `terms_version` and stores it on the payment (`mk-flix-be`
  `a007382`). Current wording is `TERMS_VERSION = "2026-11-13.3"` (refunds only
  if we shut Blendy Play down, `67bc01d`; CineJoy account optional, `e8ebd78`).
  The draft still needs review by a lawyer qualified in Kenya.
- **M-Pesa fixes:** the Daraja token is cached in a **database cache shared by
  all processes** (`367c8e7`, `aae22c4`), which stops Daraja's spike-arrest
  errors on status queries; a status query answering "The transaction does not
  Exist" now fails the payment at once instead of retrying for hours
  (`716e894`). The stuck sandbox payment from 2026-11-13 08:01 UTC was closed
  this way. Prompts are labelled "Blendy" (`1af9685`; Daraja's description
  limit is 13 characters).
- **Transactional email** (`mk-flix-be` `0f41d6b`, `899d0d9`): a
  `notifications` app sending the verification code and the welcome email.

## Session — 2026-11-13 (morning)

- **M-Pesa sandbox works end to end**: STK payments from a real Safaricom phone
  were settled by Safaricom's callback (ResultCode 0) via an ngrok tunnel.
- **Production CORS fixed** (`mk-flix-be` `93af3b3`): the desktop gate calls the
  API from `file://`, i.e. `Origin: null`.
- **Callback path without "mpesa"** (`mk-flix-be` `6869b0b`).
- **Stale subscription after paying fixed** (`mk-flix` `0fab36c`) and
  **subscribers go straight to the site** (`mk-flix` `326f978`).
- The injected menu and padlock scripts were **tested on the real logged-in
  cinejoy.pk and work**.

## Commits (newest first)

blendy-play commits:
- `5a80018` `/forgot-password` and `/reset-password` pages; no-referrer
- `4b79415` show/hide eye on password fields; "at least 6 characters" hint
- `da7c94a` `/verify` page for unverified accounts; account cache refreshed after changes
- `c842cdd` landing hero is a full-width screenshot of the app; story points as panels
- `74de4d8` the portal: product page, sign-in, account area, admin dashboard

mk-flix commits:
- `bc9ccd4` "Forgot your password?" on the gate's sign-in
- `90f5da5` show/hide eye on the password field; "at least 6 characters" hint when registering
- `e07df8d` "Check your email" code screen after registering
- `e8ebd78` gate + terms: CineJoy account is optional
- `67bc01d` terms 9.2: refunds only if we shut Blendy Play down
- `f05fd08` terms and conditions draft
- `297ba70` terms checkbox + terms view on the paywall, `terms_version` sent with payments
- `3a6b2dc` user-visible rename to Blendy Play
- `f5085b6` handoff: M-Pesa sandbox run and gate fixes
- `326f978` subscribers go straight to the site; paywall explains why (expired / none)
- `0fab36c` gate re-sends the session on every check (stale padlock/Play fix)
- `3be0ccb` back arrow on the paywall + subscription pages
- `dbdc4ee` golden padlock on posters while unsubscribed
- `d6e5d09` "My Subscription" menu entry + status page
- `d3fd5a4` playback gating (browse free, `/watch/` needs a subscription) + API base from config
- `7aada6f` the account gate (onboarding + M-Pesa paywall) wired into both apps

mk-flix-be commits:
- `fb33082` forgot password: emailed single-use link to the portal (105 tests)
- `8639a1b` passwords need 6 characters, not 8 (93 tests)
- `b98b2c0` email verification with a 4-digit code
- `168431c` Message-ID on the sender's domain
- `e44f359` admin dashboard API (78 tests)
- `10f93cc` customer self-service: profile, password, delete, own payments
- `899d0d9` / `0f41d6b` email: SMTP settings documented; welcome email on registration
- `1af9685` M-Pesa labels "Blendy"
- `aae22c4` Daraja token in a shared database cache
- `a007382` `terms_version` required and stored on each payment
- `1535414` M-Pesa labels renamed (later shortened by `1af9685`)
- `716e894` "transaction does not exist" fails the payment at once
- `367c8e7` Daraja token reused instead of fetched per call
- `6869b0b` callback path `/api/payments/stk/callback/<token>`
- `93af3b3` CORS: the gate's `Origin: null` is always allowed outside DEBUG
- `cccf15c` reconciliation job, retries
- `97e075c` backend scaffold (accounts, billing, payments)

## How it fits together

**Startup → gate → site.** Both apps open on a local page `mkflix-account.html`
(the "gate"), not cinejoy.pk. The gate checks the backend for a subscription and
handles onboarding, the terms, M-Pesa payment, the "My Subscription" page, and
saving the CineJoy number. A signed-in user can **Browse without subscribing**;
the gate then sends the WebView/window to cinejoy.pk.

**Gate entry modes** (`checkAccess(mode)` in `mkflix-account.html`):
- **launch** — app start, sign-in, or a blocked Play (`openPaywall()`): an active
  subscriber goes straight to cinejoy.pk; otherwise the paywall shows a note
  (expired on <date> / cancelled / no subscription on this account).
- **subscription** — the "My Subscription" menu (`openSubscription()`, which loads
  `mkflix-account.html#subscription`) and right after a successful payment: the
  subscription page.
- Before opening the site as a subscriber, the gate re-sends the session to the
  app and waits until `MKFlixNative.isSubscribed()` is true (max 5 s).

**Terms in the gate.** Pay is disabled until a plan is chosen and the terms box
is ticked. The terms text is a **copy** of `docs/terms-and-conditions-draft.md`
inside `mkflix-account.html`: when the wording changes, update both and bump
`TERMS_VERSION`, which every STK request sends and the backend stores.

**Shared, injected scripts** (identical copies in `mk-flix-app/app/src/main/assets/`
and `mk-flix-desktop/` — keep them byte-identical):
- `mkflix-account.html` — the gate (views: welcome, auth, plans/paywall, terms, paying, My Subscription, save CineJoy number, retry). API base from `MKFlixNative.getApiBase()`; JWT in `localStorage`; refresh-on-401.
- `mkflix-enforcer.js` — blocks navigation to a `/watch/` page when unsubscribed and opens the paywall.
- `mkflix-menu.js` — adds "My Subscription" to cinejoy's **Settings submenu** and the **floating bottom bar** — never the main nav.
- `mkflix-lock.js` — golden padlock on each poster while unsubscribed.
- `mkflix-footer.js`, `mkflix-logo.css` — branding (footer replacement, logo).

**Native bridge `window.MKFlixNative`** — the authoritative subscription check, so
a cinejoy page/ad can't fake a subscription:
- Android: `MkFlixBridge` in `MainActivity.java` (HTTP to `/me/subscription` on a bg thread, cached in `SharedPreferences`).
- Desktop: `preload.js` exposes it; `main.js` holds the session (memory only) and does the HTTP check.
- Methods: `getApiBase()`, `saveSession(apiBase, access, refresh)`, `clearSession()`, `refreshSubscription()`, `isSubscribed()`, `openPaywall()`, `openSubscription()`.

**Backend `mk-flix-be`** (Django 5.2 + DRF + simplejwt):
- `accounts` — email-login `CustomUser` (`email_verified_at`); `EmailVerificationCode` + `accounts/verification.py` for the 4-digit code; `PasswordResetToken` + `accounts/password_reset.py` for forgot password; passwords need 6+ characters, not all numbers, not common, not like the email; CineJoy number **encrypted at rest** (Fernet, `FIELD_ENCRYPTION_KEY`); self-service profile/password/delete (`accounts/services.py` erases the person but keeps payments as anonymous records).
- `billing` — `Plan` (seeded **Weekly**/**Monthly**), per-user `Subscription` (renewals extend it).
- `payments` — `Payment` (with `terms_version`) + `MpesaTransaction`, STK Push, token-authenticated callback, idempotent settle, `reconcile_payments` command.
- `notifications` — `send_email(name, to, context)`: templates in `notifications/templates/emails/<name>/` (subject, text, HTML on a shared layout), sent after commit in a background thread; failures are logged, not retried.
- `dashboard` — read-only admin API (see below).
- `CACHES` is the **database cache** (table created by a payments migration), shared by all processes; it holds the Daraja token.
- Endpoints:
  - Auth: `POST /api/auth/{register,login,refresh}`; `POST /api/auth/password-reset` (`{email}`), `/password-reset/check` (`{token}`), `/password-reset/confirm` (`{token, new_password}`), all without sign-in; `POST /api/auth/verify-email` (`{code}`) and `/api/auth/verify-email/resend`; `GET/PATCH/DELETE /api/auth/me` (PATCH: name, phone; DELETE needs `{password}`; response has `is_admin`); `POST /api/auth/me/password`; `GET/PUT/DELETE /api/auth/me/cinejoy-account`.
  - Billing: `GET /api/plans`, `GET /api/me/subscription` (403 `email_not_verified` until the email is verified).
  - Payments: `POST /api/payments/mpesa/stk` (`plan_code`, `phone_number`, `terms_version`; verified accounts only), `GET /api/payments/<id>`, `GET /api/payments/mine`, `POST /api/payments/stk/callback/<token>` (also `/api/payments/mpesa/callback/<token>`).
  - Dashboard (super-admin only): `GET /api/dashboard/{overview,users,users/<id>,payments,subscriptions}`.
- Config in `mk-flix-be/.env` (gitignored; `.env.example` documents it). Access tokens 60 min, refresh 30 days. simplejwt is stateless: a password change doesn't sign out other devices until their tokens expire; deleted (inactive) accounts are rejected at once.

## Web portal (`blendy-play`)

Angular 19, standalone components and signals, no UI library. Same neon look as
the gate (pure black, the mark's cyan/magenta/red, Ubuntu font).

| Path | Who | What |
|---|---|---|
| `/` | Everyone | Product page: full-width hero with a screenshot of the app, the story, "at a glance" facts, screenshots on phone/TV/desktop, downloads |
| `/signin`, `/admin` | Everyone | One sign-in. The admin lands on `/dashboard`; anyone else on `/account` |
| `/forgot-password`, `/reset-password` | Everyone | Ask for a reset link; the emailed link lands on `/reset-password?token=…` to set a new password |
| `/verify` | Signed in, email not verified | Enter the 4-digit code; `/account` redirects here until it's done |
| `/account` | Any signed-in user | Own subscription, editable details, own payments, change password, delete account |
| `/dashboard` | Super-admin only | Overview, Users, Payments, Subscriptions |

- **Config at load time:** `public/config.json` (`apiBase`, `supportEmail`), so
  one build deploys against any backend.
- **Downloads:** `public/downloads/releases.json` lists the files; the binaries
  are git-ignored and copied in at deploy. A listed file that's missing on the
  server shows "Coming soon".
- **Screenshots:** `public/screenshots/screenshots.json` drives the gallery. The
  current phone/TV/desktop set is the gate's own screens (welcome, plans, My
  Subscription), captured at each size.
- **Auth:** the same JWT login as the apps, tokens in `localStorage`
  (`blendy.access`, `blendy.refresh`), an interceptor that refreshes once on
  401, and route guards (`signedInGuard`, `adminGuard`).
- **Deploy:** `npx ng build` → upload `dist/blendy-studio/browser` to a static
  host; replace `config.json`; send unknown paths to `index.html`; HTTPS. The
  README has nginx/Netlify/Vercel snippets.

## Email verification

- **Flow:** registering creates the account and emails "1234 is your Blendy Play
  code". The apps' gate shows "Check your email" (code field that submits on the
  4th digit, "Send a new code" with a countdown, "Use a different email" to sign
  out); the portal has the same at `/verify`. The right code verifies the
  account and sends the welcome email; the gate then opens the paywall.
- **Until verified:** sign-in works, but `/api/me/subscription` and the STK push
  answer 403 `{"code": "email_not_verified"}`, which is what sends the gate to
  the code screen.
- **Rules** (settings, overridable in `.env`): code valid 10 minutes
  (`EMAIL_CODE_TTL_MINUTES`), 5 wrong tries (`EMAIL_CODE_MAX_ATTEMPTS`), a new
  code once a minute (`EMAIL_CODE_RESEND_SECONDS`), 5 an hour
  (`EMAIL_CODE_MAX_PER_HOUR`). A new code cancels the old one.
- **Storage:** only an HMAC of the code; each row keeps sent-to, attempts,
  created, expires, used and superseded times.
- **Exempt:** accounts that existed before the feature (marked verified by the
  migration) and superusers.
- **Not built yet:** changing the account email (would need the same code flow
  to the new address).

## Forgot password

- **Asking:** "Forgot your password?" on the gate's sign-in screen and the
  portal's `/signin` (both prefill the typed email) → `POST
  /api/auth/password-reset`. The answer is always "If an account exists for
  that email…", so it can't be used to find out who has an account. Only
  active accounts get the email.
- **The link:** `<PORTAL_URL>/reset-password?token=…`. **`PORTAL_URL` is an env
  var in `mk-flix-be/.env`** (default `http://localhost:4200`); set it to the
  deployed portal's address. The token is 256 random bits; only its SHA-256 is
  stored (`PasswordResetToken`, with sent-to, created, expires, used and
  superseded times).
- **Rules** (env-overridable): valid 60 minutes (`PASSWORD_RESET_TTL_MINUTES`),
  single use, a newer link cancels older ones, one request a minute and 5 an
  hour per account (`PASSWORD_RESET_RESEND_SECONDS`,
  `PASSWORD_RESET_MAX_PER_HOUR`; extras are dropped quietly).
- **The page:** checks the link first (`/check` returns the masked email, e.g.
  `wa*****@example.com`) and explains invalid / expired / used / replaced links
  with a "Send a new link" button; then new password + confirmation (eye
  buttons, 6-character hint, mismatch caught in the browser). The token is
  stripped from the address bar once read, and the portal sends no referrer.
- **After a reset:** the link is used up, the email counts as verified, and a
  "Your password was changed" email goes out. Other signed-in sessions are not
  ended (stateless JWTs) until their tokens expire.

## Admin dashboard

- **Who:** only accounts with `is_superuser` (`python manage.py
  createsuperuser`). The backend returns 403 to everyone else, and the portal
  sends non-admins to `/account`. Staff accounts are excluded from all figures.
- **Overview:** a 7/30/90-day window with revenue (vs the previous window, plus
  all time), active subscriptions, new users, the share of finished payments
  that went through; daily revenue and new-user bar charts (each with a table
  view); active subscribers and revenue per plan; subscriptions ending in the
  next 3 days; latest payments.
- **Users / Payments / Subscriptions:** searchable, filterable, paginated lists;
  a page per user with their payments (receipt, phone, terms version, failure
  reason).
- **Subscription state** is what the customer experiences: a record still
  marked ACTIVE whose period has ended is shown as expired.
- **Privacy:** CineJoy numbers are never returned, only whether one is saved.
  Read-only for now: no refunds, manual extensions or account actions yet.

## The rename

User-visible text says **Blendy Play**: Android app name, desktop window title,
splash and wordmarks (`branding/make-icons.py` `NAME`), gate, error page, site
footer, Linux menu entry, Windows zip/folder/exe (`Blendy-Play-Windows-x64.zip`,
`Blendy Play.exe`), `.deb` file name. Kept on purpose:
- Android package id and the deb package name `mk-flix`, so updates install over
  existing installs.
- Electron `userData` is pinned to the old `MK-Flix` folder in `main.js`, so the
  rename doesn't sign desktop users out.
- The `MKFlixNative` bridge, `mkflix_*` storage keys, file names and repo names.
- The main `README.md` still describes the v1.4.0 release as MK-Flix; it changes
  with the release that ships the rename.

## Running it locally (important gotchas)

**Backend:**
```
cd mk-flix-be && . .venv/bin/activate && python manage.py runserver   # 127.0.0.1:8000
```
Run `python manage.py migrate` after pulling (cache table, `terms_version`).
**Restart `runserver` after editing `.env`.** Grant yourself a subscription:
```
python manage.py shell -c "from django.contrib.auth import get_user_model as U; from billing.models import Plan,Subscription as S; u=U().objects.get(email='you@example.com'); s,_=S.objects.get_or_create(user=u); s.extend(Plan.objects.get(code='monthly'))"
```
With `EMAIL_BACKEND` unset, emails print to the runserver console.

**Portal:** `cd blendy-play && npm install && npx ng serve` → http://localhost:4200
(uses `http://localhost:8000/api` from `public/config.json`; CORS is open in DEBUG).

**Pointing the apps at the backend** (the gate reads the URL from the app, not the HTML):
- Desktop: `MKFLIX_API_BASE` env var or `mk-flix-desktop/mkflix-config.json` (`apiBase`).
- Android: `mk-flix-app/app/src/main/assets/mkflix-config.json` (`apiBase`). Emulator: `http://10.0.2.2:8000/api`, or `http://localhost:8000/api` **with `adb reverse tcp:8000 tcp:8000`**.
- **Both `mkflix-config.json` files ship empty and must stay empty in commits.** A local testing value may be on disk uncommitted.

**Building the Android APK** — on this machine build-tools 34's `d8` crashes on the installed JDK's class files:
```
cd mk-flix-app && sed 's#build-tools/34.0.0#build-tools/36.0.0#' build-apk.sh > .b.sh \
  && ANDROID_HOME=~/Android/Sdk JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 bash .b.sh && rm .b.sh
```
Output: `app/build/outputs/apk/debug/app-debug.apk`. Android Studio/Gradle builds are unaffected.

**Desktop:** `cd mk-flix-desktop && npm start` (or `npm run dist-win` / `dist-linux`).
For local testing: `MKFLIX_API_BASE=http://localhost:8000/api npm start`.

## M-Pesa sandbox testing

1. Daraja portal → a sandbox app with **M-Pesa Express**. In `mk-flix-be/.env`:
   `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE=174379`,
   `MPESA_PASSKEY`.
2. `ngrok http 8000`, then
   `MPESA_CALLBACK_URL=https://<id>.ngrok-free.app/api/payments/stk/callback/<MPESA_WEBHOOK_TOKEN>`
   (no trailing slash; the ngrok URL changes on every restart).
   `MPESA_WEBHOOK_ENFORCE_IP=False` locally.
3. Restart `runserver`, then pay from an app with a real Safaricom number.
   Local plans are currently **KES 1**; restore with
   `python manage.py shell -c "from billing.models import Plan as P; P.objects.filter(code='weekly').update(price=99); P.objects.filter(code='monthly').update(price=299)"`.

## Not done yet / next steps

- **Email:** sending works (SPF, DKIM, DMARC pass). Next emails worth adding: a
  payment receipt, and "password changed" after a change from `/account`
  (it's only sent after a reset today).
- **Deploy the portal:** production `config.json`, the portal's origin in the
  backend's `CORS_ALLOWED_ORIGINS` and its address in `PORTAL_URL`, SPA fallback, HTTPS, and the release
  binaries in `public/downloads/` (names in `releases.json`).
- **Production backend:** HTTPS, Postgres, `migrate`, a superuser, scheduled
  `reconcile_payments` (cron/systemd).
- **Go live with M-Pesa:** Safaricom approval, live keys/shortcode/passkey,
  `MPESA_BASE_URL=https://api.safaricom.co.ke`, the deployed callback, the IP
  allowlist with `MPESA_WEBHOOK_ENFORCE_IP=True`, prices restored. **Open
  question — Paybill or Till?** STK is hard-coded as `CustomerPayBillOnline`
  with `PartyB` = shortcode; a Till needs `CustomerBuyGoodsOnline` and separate
  settings in `payments/services/providers/mpesa.py`.
- **Release:** bump versions from 1.4.0 (`mk-flix-app/app/build.gradle.kts`,
  `mk-flix-desktop/package.json`), rename the main README, build the APK, zip
  and deb, publish them through the portal's downloads.
- **Confirm in the running apps:** the gate routing (`326f978`) and the terms
  checkbox.
- **Sandbox cancel test:** decline the STK prompt → payment FAILED, no subscription.
- **Terms:** lawyer review before relying on them.
- **Customer email change** isn't possible yet (needs the code flow sent to the new address).
- **Confirm on Android:** registering → code screen → paywall, and "Forgot your password?" (both confirmed on desktop).
- **Confirm `mk-flix-be` is private.**

## Caveats worth re-reading

- The injected menu/lock scripts depend on **cinejoy.pk's real logged-in DOM**. They work today and stay defensive (they do nothing if they can't find their target); likely tuning points if cinejoy changes: the settings-submenu detection, the bottom-bar detection (`position: fixed` at the viewport bottom), and poster detection (`<img>`, not CSS backgrounds).
- Terms, emails and the portal describe Blendy Play as not hosting content. Imagery of the third-party site's films (posters, titles) belongs to its owners; check the rights before using it in marketing.
- Charging for ad-free access to a third-party site may conflict with that site's own terms; have a lawyer look at this together with the Terms and Conditions.

## Where the raw session lives

- Local transcripts (this machine), in `~/.claude/projects/-home-mk-dev-mk-flix/`: `01f7c073-67e5-47d5-8b14-f5a1d2d22235.jsonl` (the build-out) and `e7756eab-d8b0-46a7-bc93-1720d74eb355.jsonl` (2026-11-13 → 14: CORS, M-Pesa sandbox, gate fixes, rename, terms, email, portal and dashboard, email verification, forgot password). On the same machine, `claude --resume` lists past sessions and `claude -c` continues the most recent.
- On a different machine, this file + the three GitHub repos are the handoff.
