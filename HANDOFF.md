# Blendy Play (MK-Flix) — session handoff

Snapshot for picking the project back up in a fresh Claude Code session (e.g. on
a different Claude subscription or machine). Everything described here is already
committed and pushed; this file is the map.

The product is called **Blendy Play**. Since 2026-11-14 it is also a
**separate app identity** from the old MK-Flix (new Android application id
and signing key, new desktop app id, Linux package and data folder), so it
installs alongside MK-Flix. The code, repo names, the `MKFlixNative` bridge and
`mkflix_*` storage keys keep the old name (see "The rename").

## Repos

- **`mk-flix`** (this repo) — https://github.com/MainaKimani/mk-flix
  - `mk-flix-app/` — Android app (phone + Android TV), a WebView wrapper around cinejoy.pk
  - `mk-flix-desktop/` — Electron desktop app (Windows + Linux)
  - `branding/` — `make-icons.py` generates all icons, logos, splash and banner art
  - `docs/terms-and-conditions-draft.md` — the Terms and Conditions source text
- **`mk-flix-be`** — https://github.com/MainaKimani/mk-flix-be (Django backend: auth, billing, M-Pesa, email, dashboard API). Lives at `../mk-flix-be`. **Private** (keep it so); `mk-flix` and `blendy-play` are public.
- **`blendy-play`** — https://github.com/MainaKimani/blendy-play (Angular 19 web portal: product page, customer account area, admin dashboard). Lives at `../blendy-play`. Deployed separately as a static site.

## What this product is

Blendy Play is a thin, ad-blocking wrapper around **cinejoy.pk** (a third party
that owns the streaming accounts and content). It adds its own account layer +
**M-Pesa subscription billing**, and gates *playback* (not browsing) behind an
active subscription. Enforcement is inherently soft — a determined user can open
cinejoy.pk in a browser — so we bill for the app experience, not the content.

A **CineJoy account is optional**: users can watch without one; it only carries
their progress and lists across devices. User-facing text must never say a
CineJoy account is required, and must never point users at cinejoy.pk.

**One sign-in for both** (`mkflix-cinejoy.js`, the bridge in `MainActivity` /
desktop `main.js` + `preload.js`). CineJoy's only credential is its 16-digit
number, which the backend keeps encrypted on the user's account. After the
email is confirmed, the gate offers "Create your server key": the app opens
CineJoy's own create panel (renamed "Create Key", tabs "Key in"/"Create"),
the user passes CineJoy's captcha and taps Generate, and the app saves the
number and returns to the subscription page. The plans and My Subscription
pages offer "Generate Server Key" while no number is saved. On cinejoy.pk the
script signs the app in with the saved number (`POST
server2.wing.st/api/auth/login {accountId, device:"web"}`, then
`cinejoy_token` / `cinejoy_account_id` in localStorage), reports a number made
or keyed in on CineJoy so the gate saves it, and clears CineJoy's session when
Blendy Play signs out. Registering needs CineJoy's Turnstile captcha, so the
app never creates accounts by itself.

## Latest sessions — 2026-11-15 and 2026-11-16

- **Live with real customers.** M-Pesa runs on Safaricom's live Daraja API
  and pays into a **Buy Goods till** (`mk-flix-be` `d335da2`): setting
  `MPESA_TILL_NUMBER` sends `CustomerBuyGoodsOnline` with the till as
  `PartyB`, while `MPESA_SHORTCODE` (the store number the passkey was issued
  for) stays `BusinessShortCode`. Empty, it falls back to Paybill, which keeps
  the sandbox (174379) working locally. **Symptom of a missing till number:**
  result code 2029 "Failed due to an unresolved reason type" and no prompt on
  the phone.
- **Release 1.6.0 is out** (`mk-flix` `ccf6ff6`), with `--min 1.6.0`, and the
  server's `MIN_APP_VERSION_*` are set, so 1.5.x apps get Update required.
  Before it: **1.5.0** (`634a4f0`, the first Blendy Play release) and
  **1.5.1** (`a348287`: the splash covers the hand-off to the site, `e716107`;
  the footer is just the logo and "Blendy Play: Powered by CineJoy",
  `3d67242`). Also since 1.5.0: on a TV films start by themselves with the
  player's overlays hidden until a remote key (`f2d667f`); the gate's card
  scrolls when it's taller than the window (`f652cd4`). Windows is built in
  podman (`635f268`, see "Releases").
- **Four apps per account** (`mk-flix-be` `916e6df`, apps `38d5f9d`, portal
  `4009902`): see "Devices" below.
- **Staff roles** (`mk-flix-be` `4581c4c`, portal `8b23adf`): staff can view
  the dashboard, super-admins change things and manage the team at
  `/dashboard/staff`. See "Admin dashboard".
- **The server went down twice** when apps opened (all of LiteSpeed's 8 web
  processes busy). Causes and fixes:
  - The Android app fired a `/me/subscription` request on every page change
    once its cached answer was stale, and never stopped on failure
    (`mk-flix` `f082a2e`): now one check at a time, backing off 1 → 15 min,
    and no retry after 401/403 until the gate hands over a new session.
  - Emails sent during the request waited up to 15 s for the mail server.
    Now see "Sending email" below (`787d9da`, `4e75a7e`).
  - Daraja calls waited 20 s; now 10 s (token, status) and 15 s (STK push);
    a read timeout is "Could not start the M-Pesa payment" instead of a 500;
    a successful callback matching no payment is logged as an error with
    receipt, amount and phone so it can be credited by hand (`56bc351`).
  - **Request logging** (`fe80159`): every API request logs a start and a
    done line (status, total and database time, query count, user id) to
    `stderr.log`; over `SLOW_REQUEST_MS` (2 s) is a warning; a start with
    no done shows what a stuck process was doing. Only the path is logged.
    `LOG_REQUESTS=False` turns it off.
  - A cron request to `/api/plans` every 2 minutes keeps the app from being
    stopped between requests (`c088786`), so launch checks don't wait for
    Django to start.
- **Portal:** prices KES 119 / 359 on the site (`e4c8552`); "no iPhone, iPad
  or Mac app yet" note (`f193220`); an **Edit** button on each customer row
  in the dashboard (`9d663b7`: the name link didn't look clickable).
- **Open:** a customer who registered and paid on 2026-11-16 said neither the
  code nor the receipt arrived. The server log shows both were accepted by
  the mail server (the code timed out inline and went out from the queue; the
  admin confirmed the email by hand in the dashboard). Next step: cPanel →
  Email → **Track Delivery** for their address (bounced → wrong address;
  delivered → their spam folder). A receipt can be resent from
  `manage.py shell` with `payments.services.settlement._send_receipt(payment,
  payment.subscription)`.

## Devices

- **Every sign-in starts a `DeviceSession`** (`accounts/models.py`), and the
  tokens carry its id as `sid`. A token works only while that session is
  signed in and was used in the last `DEVICE_IDLE_DAYS` (30); otherwise 401
  `{"code": "session_revoked"}` (`accounts/authentication.py`). Tokens from
  before this had no `sid`, so everyone signed in once more after the deploy.
- **The apps** send `X-App-Platform`, a random `device_id` made once per
  install, and a `device_name` (Android: the name set in Settings, else maker
  and model; desktop: computer name and system). Signing in again on a known
  device reuses its session.
- **Limit:** `MAX_APP_DEVICES` (4) signed-in apps. The 5th sign-in gets 403
  `device_limit` with the signed-in devices' names and a pointer to the
  portal's devices page; the gate shows both. Portal (browser) sessions are
  listed but never count. Superusers have no limit.
- **Signing out:** the apps call `POST /api/auth/logout` first. Customers see
  and sign out devices on `/account` (`GET /api/auth/me/devices`, `DELETE
  /api/auth/me/devices/<id>`); the dashboard's customer page lists theirs with
  a Sign out button (`DELETE /api/dashboard/users/<id>/devices/<device id>`).
  On `session_revoked` the gate clears the session and shows sign-in with the
  reason; the Android background check does the same, and the desktop app
  re-checks every 10 minutes, so a signed-out device stops playback without a
  restart.
- **Passwords:** a change signs out the other devices, a reset (and deleting
  the account) signs out all of them. Asking for a reset signs nothing out.
- `last_seen_at` is written at most every 5 minutes per device.
- **Not yet tried on real devices:** the desktop flow at the limit and the
  Android device name set in Settings.

## Sending email

- **Codes and reset links** go out during the request, waiting at most
  `EMAIL_TIMEOUT` (default 5 s). One that fails or times out is stored
  rendered in `QueuedEmail` and retried by `manage.py send_queued_emails`
  (cron, every minute) after 1, 2, 5, 15 and 30 minutes; expired codes and
  links are dropped. Rows are deleted once sent or dropped.
- **Receipts, welcome, "password changed" and staff invites** never wait in a
  request: `send_email(..., queue=True)` queues them and the cron job sends
  them on its next run, waiting up to `EMAIL_QUEUE_TIMEOUT` (60 s) each
  (`4e75a7e`). The job writes timestamped lines to `email.log` only when it
  had something to do (`4f9447f`).
- **The mail server takes 4.5–7 s to accept a message** (connect and login
  take 0.1 s; the rest is likely its outgoing scan), so many codes miss the
  5 s and arrive a minute later from the queue. Suggested on the server:
  `EMAIL_TIMEOUT=20` in `.env`, then Restart (not yet confirmed done).
- **`EMAIL_SEND_IN_BACKGROUND=False` must stay in the server's `.env`.**
  LiteSpeed freezes the app between requests, threads included, so a
  background send only went out on the next request. The setting defaults to
  True when the line is missing.

## Sessions — 2026-11-13 (afternoon) and 2026-11-14

- **Deployed** (2026-11-14): the backend runs on the cPanel host at
  `https://blendyplay.mainakimani.com` (see "Deployment" below); the gate's
  built-in API address points there (`mk-flix` `fdc07c7`). Production uses
  SQLite because the host's PostgreSQL is 13 and Django 5.2 needs 14.
- **In-app updates with a signed release manifest** (`mk-flix` `61481a7`): see
  "Releases and in-app updates" below. Releases will live at
  `https://blendy.mainakimani.com/downloads/` (the portal's subdomain).
- **New app identity** (`mk-flix` `8c25d24`): Android `com.mainakimani.blendyplay` with a new
  release key; desktop app id `com.mainakimani.blendyplay`, Linux package
  `blendy-play`, own data folder; Windows is now an installer, not a zip.
- **Email works for real.** The cPanel mailbox `blendyplay@mainakimani.com`
  sends through `mail.mainakimani.com` (port 465, SSL); test emails to Gmail
  pass SPF, DKIM and DMARC (`_dmarc` record added 2026-11-14). Message-IDs use
  the sender's domain (`mk-flix-be` `168431c`).
- **Email verification with a 4-digit code** (`mk-flix-be` `b98b2c0`, gate
  `e07df8d`, portal `da7c94a`): see "Email verification" below.
- **Payment receipt email** (`mk-flix-be` `56a6096`, portal `afd93c5`): sent from
  `settle_payment`, so once per successful payment whether the callback or
  reconciliation settles it; none for failed payments. Shows plan, amount,
  paid time (EAT), masked phone, M-Pesa receipt (absent when reconciliation
  settled it), a reference (first 8 hex digits of the payment id) and the new
  period end. The dashboard's payment search finds payments by that reference.
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
  `a007382`). The wording now lives in the backend (see "Terms in the gate");
it was seeded as `2026-11-17.1` with KES 149 weekly and 459 monthly. Earlier
wording was `TERMS_VERSION = "2026-11-15.1"` (refunds only
  if we shut Blendy Play down, `67bc01d`; CineJoy account optional, `e8ebd78`;
  prices KES 119 weekly and 359 monthly). The draft still needs review by a
  lawyer qualified in Kenya.
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
- `9d663b7` Edit button on each customer row in the dashboard
- `f193220` "no iPhone, iPad or Mac app yet" on the product page
- `8b23adf` staff roles: view-only dashboard for staff, `/dashboard/staff` for super-admins
- `4009902` signed-in devices on `/account`, with Sign out
- `e4c8552` new weekly and monthly prices on the site
- `1173b59` gallery shows email verification and the listing
- `8334b78` editable customer page (details, subscription) and a Plans page
- `2b6da62` interceptor matches token-free paths exactly (`/dashboard/plans` was sent without a token)
- `afd93c5` payment search hint mentions the receipt reference
- `5a80018` `/forgot-password` and `/reset-password` pages; no-referrer
- `4b79415` show/hide eye on password fields; "at least 6 characters" hint
- `da7c94a` `/verify` page for unverified accounts; account cache refreshed after changes
- `c842cdd` landing hero is a full-width screenshot of the app; story points as panels
- `74de4d8` the portal: product page, sign-in, account area, admin dashboard

mk-flix commits:
- `ccf6ff6` release 1.6.0
- `38d5f9d` apps register the device at sign-in; device limit and remote sign-out handled
- `f082a2e` Android: one subscription check at a time, with back-off
- `a348287` release 1.5.1
- `e716107` splash covers the hand-off from the gate to the site
- `3d67242` footer reduced to the logo and app name
- `635f268` release docs: keep only the latest version, Windows in podman
- `634a4f0` release 1.5.0
- `a725be6` terms: KES 119 weekly, 359 monthly
- `f2d667f` TV: films start by themselves, overlays hidden until a key
- `f652cd4` gate: a tall card scrolls
- `fdc07c7` gate's built-in backend is `https://blendyplay.mainakimani.com/api`
- `61481a7` in-app updates from a signed release manifest; `release/publish.mjs`
- `8c25d24` own app identity (Android id + key, desktop id/package/data folder, Windows installer)
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
- `4f9447f` timestamps on the queued email log
- `4e75a7e` receipts, welcome, "password changed" and invites sent from the queue (190 tests)
- `d335da2` M-Pesa Buy Goods till (`MPESA_TILL_NUMBER`)
- `4581c4c` staff roles and the staff API
- `916e6df` device sessions: 4 signed-in apps per account, remote sign-out
- `fe80159` per-request logging with timings
- `56bc351` shorter Daraja waits; unmatched callbacks logged
- `787d9da` failed emails queued and retried by cron
- `c088786` / `2f8c7f8` deploy guide: keep-awake cron; emails sent during the request
- `3a1fef2` admin editing of customers, subscriptions and plans (132 tests)
- `f91ffae` the bare domain redirects to the portal
- `c53460b` cPanel deploy: `passenger_wsgi.py`, WhiteNoise, production checks, SQLite IMMEDIATE transactions, `DEPLOY.md` (117 tests)
- `56a6096` payment receipt email; dashboard search by receipt reference (111 tests)
- `808c9eb` "password changed" email after a change from the account page too (107 tests)
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
the CineJoy key step. A signed-in user can **Browse without subscribing**;
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
is ticked. The live wording is in the backend database (`legal` app,
`TermsVersion`), edited in the Django admin under "Terms and Conditions": tick
the live version, "Start a new draft from the selected version", edit it
(the page shows a preview), then "Publish the selected draft". Published
versions are locked because payments store their name. `GET /api/terms` serves
the newest published one; the gate loads it on the paywall and the Terms
screen and sends its `version` as `terms_version` with each STK push. The
portal shows the same text at `/terms`. The copy inside `mkflix-account.html`
(with `TERMS_VERSION`) is only the offline fallback, so changing the terms
needs no app build; refresh the fallback at a release if it has drifted.

**Shared, injected scripts** (identical copies in `mk-flix-app/app/src/main/assets/`
and `mk-flix-desktop/` — keep them byte-identical):
- `mkflix-account.html` — the gate (views: welcome, auth, plans/paywall, terms, paying, My Subscription, the CineJoy key step, retry). API base from `MKFlixNative.getApiBase()`; JWT in `localStorage`; refresh-on-401.
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
- `notifications` — `send_email(name, to, context, queue=…)`: templates in `notifications/templates/emails/<name>/` (subject, text, HTML on a shared layout); `QueuedEmail` + `send_queued_emails` for retries and queued sends (see "Sending email"). Emails: `verify_email`, `welcome`, `password_reset`, `password_changed`, `payment_receipt`, `staff_invite`.
- `dashboard` — admin API: staff read, super-admins write (see below).
- `mkflix_be/request_log.py` — the per-request log lines.
- `CACHES` is the **database cache** (table created by a payments migration), shared by all processes; it holds the Daraja token.
- Endpoints:
  - Auth: `POST /api/auth/{register,login,refresh,logout}` (login/register take `device_id`, `device_name`); `GET /api/auth/me/devices`, `DELETE /api/auth/me/devices/<id>`; `POST /api/auth/password-reset` (`{email}`), `/password-reset/check` (`{token}`), `/password-reset/confirm` (`{token, new_password}`), all without sign-in; `POST /api/auth/verify-email` (`{code}`) and `/api/auth/verify-email/resend`; `GET/PATCH/DELETE /api/auth/me` (PATCH: name, phone; DELETE needs `{password}`; response has `is_admin` = can open the dashboard, `is_superadmin`); `POST /api/auth/me/password`; `GET/PUT/DELETE /api/auth/me/cinejoy-account`.
  - Billing: `GET /api/plans`, `GET /api/me/subscription` (403 `email_not_verified` until the email is verified).
  - Payments: `POST /api/payments/mpesa/stk` (`plan_code`, `phone_number`, `terms_version`; verified accounts only), `GET /api/payments/<id>`, `GET /api/payments/mine`, `POST /api/payments/stk/callback/<token>` (also `/api/payments/mpesa/callback/<token>`).
  - Dashboard (staff read, super-admin write): `GET /api/dashboard/{overview,users,users/<id>,payments,subscriptions}`, editing endpoints, `DELETE /api/dashboard/users/<id>/devices/<device id>`, `GET/POST /api/dashboard/staff`, `PATCH/DELETE /api/dashboard/staff/<id>`.
- Config in `mk-flix-be/.env` (gitignored; `.env.example` documents it). Access tokens 60 min, refresh 30 days, both tied to a device session (see "Devices"), so signing a device out takes effect at once; deleted (inactive) accounts are rejected at once.

## Web portal (`blendy-play`)

Angular 19, standalone components and signals, no UI library. Same neon look as
the gate (pure black, the mark's cyan/magenta/red, Ubuntu font).

| Path | Who | What |
|---|---|---|
| `/` | Everyone | Product page: full-width hero with a screenshot of the app, the story, "at a glance" facts, screenshots on phone/TV/desktop, downloads |
| `/signin`, `/admin` | Everyone | One sign-in. The admin lands on `/dashboard`; anyone else on `/account` |
| `/forgot-password`, `/reset-password` | Everyone | Ask for a reset link; the emailed link lands on `/reset-password?token=…` to set a new password |
| `/verify` | Signed in, email not verified | Enter the 4-digit code; `/account` redirects here until it's done |
| `/account` | Any signed-in user | Own subscription, editable details, signed-in devices, own payments, change password, delete account |
| `/dashboard` | Staff (view) and super-admins | Overview, Users, Payments, Subscriptions, Plans; Staff for super-admins |

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

## Deployment

Everything is on one cPanel account (Passenger "Setup Python App" for the
backend). Step-by-step guide: `mk-flix-be/DEPLOY.md`.

| Address | What | On the server |
|---|---|---|
| `https://blendyplay.mainakimani.com/api/` | backend (Python 3.13 app at the subdomain's root) | `~/blendyplay`, virtualenv `blendyplay/3.13` |
| `https://blendyplay.mainakimani.com/admin/` | Django admin | same app |
| `https://blendyplay.mainakimani.com/` | redirects to the portal | same app |
| `https://blendy.mainakimani.com/` | portal (static) | the subdomain's document root |
| `https://blendy.mainakimani.com/downloads/` | installers + signed `releases.json` | `downloads/` there |

- **Server `.env`** (only on the server; a copy belongs in encrypted
  storage): production `SECRET_KEY`, `FIELD_ENCRYPTION_KEY` (never change it),
  `MPESA_WEBHOOK_TOKEN`; `ALLOWED_HOSTS` and `CSRF_TRUSTED_ORIGINS` for
  `blendyplay.mainakimani.com` (with `https://` in the CSRF one);
  `CORS_ALLOWED_ORIGINS=https://blendy.mainakimani.com` (the portal is
  another origin); `PORTAL_URL=https://blendy.mainakimani.com`;
  `POSTGRES_DB` empty (SQLite); live M-Pesa (`MPESA_BASE_URL`, keys,
  `MPESA_SHORTCODE` = store number, `MPESA_TILL_NUMBER`, passkey);
  `EMAIL_SEND_IN_BACKGROUND=False`; `MIN_APP_VERSION_*=1.6.0`.
- **Database:** SQLite, `~/blendyplay/db.sqlite3`. SQLite ignores
  `select_for_update()`, so transactions run in `IMMEDIATE` mode to stop the
  callback and the reconcile job settling a payment twice. To move to
  PostgreSQL/MySQL later: `dumpdata`, set the database in `.env`, `migrate`,
  `loaddata`.
- **Cron:** `reconcile_payments` every 5 minutes (`reconcile.log`);
  `send_queued_emails` every minute (`email.log`); a `curl` of `/api/plans`
  every 2 minutes to keep the app running; a daily SQLite backup (Python
  `sqlite3` backup API) into `~/blendyplay-backups`, keeping 14 days.
  Commands are in `DEPLOY.md` step 7.
- **Static files:** WhiteNoise under `/api/static/`; run `collectstatic`
  after every backend update, then Restart on the Python App page.
- **Logs:** `~/blendyplay/stderr.log` (errors and every API request, with
  times and process ids), `email.log`, `reconcile.log`. A changed management
  command needs only the upload; app code needs Restart.
- **Deploy package** (built locally, not in git): `~/Desktop/blendy-play-deploy/`
  with `blendyplay-api.zip` (repo files + a production `.env`), `portal.zip`
  (build + production `config.json`) and `DEPLOY.md`.

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
  "Your password was changed" email goes out. The same email (worded "from
  your account settings") follows a change from `/account` (`808c9eb`). A
  change signs out the other devices; a reset signs out all of them.

## Admin dashboard

- **Who:** **super-admins** (`is_superuser`) see and change everything;
  **staff** (`is_staff` only) see the whole dashboard but every write
  answers 403. Everyone else gets 403 and the portal sends them to
  `/account`. Staff accounts are excluded from all figures.
- **Staff page** (`/dashboard/staff`, super-admins only;
  `mk-flix-be/dashboard/staff.py`): add by email as staff or super-admin,
  rename, change role, suspend, or remove (back to a customer, account
  kept). An email with no account gets one (email confirmed, no password)
  and a `staff_invite` email whose single-use link (`STAFF_INVITE_TTL_HOURS`,
  72) leads to the portal's choose-a-password page. Nobody can change their
  own role or suspend/remove themselves, and the last active super-admin
  can't be demoted. The first super-admin still comes from `python manage.py
  createsuperuser`.
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
- **Editing a customer** (their page): name, email, phone, "email confirmed"
  and "suspended" (an inactive account's tokens are refused, so it's signed out
  everywhere). Subscription: add days (stacks on the time left, like a
  payment) or set plan, status and end date by hand. Neither records a
  payment, so revenue stays what M-Pesa paid. Accounts deleted by their owner
  are read-only. Code: `mk-flix-be/dashboard/editing.py`.
- **Plans** page: create, edit, hide (off the paywall, subscribers keep their
  time) and delete (only a plan nobody paid for or subscribes to). Prices are
  whole shillings (M-Pesa drops cents); a price change affects new payments
  only; a plan's code is fixed once created (the apps pay by code). The
  interval only picks the app's "Billed weekly/monthly" label; `duration_days`
  sets the length. The gate only knows WEEK and MONTH labels.
- **Privacy:** CineJoy numbers are never returned, only whether one is saved.
  No refunds from the dashboard.

## Releases and in-app updates

- **Where:** `https://blendy.mainakimani.com/downloads/` holds `releases.json`
  (the manifest), `releases.json.sig` (ECDSA P-256 signature) and one folder
  per version with the APK, `Blendy-Play-Setup-<v>.exe` and
  `Blendy-Play_<v>_amd64.deb`. The portal's download section reads the same
  manifest.
- **Trust:** the apps accept a manifest only if its signature verifies
  against the public key built into them (`release/manifest-public-key.pem`,
  `updater.js`, `AppUpdater.java`); downloads must match the manifest's
  SHA-256; Android also checks package name, newer versionCode and the same
  signing certificate. Plain http only for `localhost` testing.
- **Gate:** at launch (at most 6 s, once per app start) it asks the native side
  for the update state: **Update available** (Update now / Later; Later hides
  it for 24 h) or **Update required** (version below the manifest's
  `minimum_version`; no way past). Windows downloads, runs the installer
  silently and restarts; Linux downloads and opens the .deb in the software
  installer; Android downloads and opens Android's installer (first asking to
  allow installs from Blendy Play).
- **Backend safety net:** apps send `X-App-Version` / `X-App-Platform`;
  `MIN_APP_VERSION_ANDROID/_WINDOWS/_LINUX` in `mk-flix-be/.env` make the API
  answer 426 `update_required` below them, and the gate shows Update required.
- **Releasing:** `release/README.md` — bump versions, build, run
  `node release/publish.mjs --notes "…" [--min x.y.z]`, upload the version
  folder first and the manifest last.
- **Keys (back up both, never replace):** manifest signing key
  `~/.config/blendy-release/manifest-signing-key.pem`; Android keystore
  `~/keys/blendy-play-release.jks` (password in `~/.gradle/gradle.properties`,
  `BLENDY_RELEASE_*`). The old MK-Flix keystore `~/keys/mkflix-release.jks`
  stays for reference only.
- **Windows build runs in podman** (`electronuserland/builder:wine`): 32-bit
  Wine can't be installed on this machine (apt offers to remove the desktop;
  don't accept). Steps in `release/README.md`.
- **Only the latest version is offered:** delete the previous version's
  folder on the server once the new manifest is up (1.5.0 and 1.5.1 folders:
  removal not confirmed).
- **In the field:** 1.6.0 apps on Android and Linux have checked in, and 1.5.1
  apps got 426 Update required, so the update path works.

## The rename

User-visible text says **Blendy Play** everywhere: app names, window title,
splash and wordmarks (`branding/make-icons.py` `NAME`), gate, error page, site
footer, Linux menu entry and package files. Since the identity change, the
Android application id (`com.mainakimani.blendyplay`), signing key, desktop
app id, Linux package (`blendy-play`) and desktop data folder are new too.
Kept on purpose: the Java package / `namespace` `com.w2a.um1c`, the
`MKFlixNative` bridge, `mkflix_*` storage keys, file names and repo names.
- The main `README.md` describes the current release (1.6.0) and points downloads at
  the website; the MK-Flix release history (v1.2.7 to v1.4.0) was taken out
  of it with that release.

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
   `python manage.py shell -c "from billing.models import Plan as P; P.objects.filter(code='weekly').update(price=119); P.objects.filter(code='monthly').update(price=359)"`.

## Not done yet / next steps

- **The customer whose emails didn't arrive:** Track Delivery in cPanel, then
  resend the receipt if needed (see "Latest sessions").
- **`EMAIL_TIMEOUT=20`** in the server's `.env` + Restart, so most codes go
  out at once instead of a minute later from the queue.
- **Upload `notifications/management/commands/send_queued_emails.py`**
  (`4f9447f`, log timestamps) if not done; no Restart needed.
- **Delete the 1.5.0 / 1.5.1 folders** from `downloads/` on the server.
- **Try on real devices:** the 5th-device refusal and remote sign-out on the
  desktop app; the Android device name from Settings; Android and Windows
  self-updates (1.6.0 → next).
- **Terms:** lawyer review before relying on them.
- **Customer email change** isn't possible yet (needs the code flow sent to
  the new address).
- **SQLite → PostgreSQL/MySQL** once the host has PostgreSQL 14+ or traffic
  grows (see "Deployment").

## Caveats worth re-reading

- The injected menu/lock scripts depend on **cinejoy.pk's real logged-in DOM**. They work today and stay defensive (they do nothing if they can't find their target); likely tuning points if cinejoy changes: the settings-submenu detection, the bottom-bar detection (`position: fixed` at the viewport bottom), and poster detection (`<img>`, not CSS backgrounds).
- Terms, emails and the portal describe Blendy Play as not hosting content. Imagery of the third-party site's films (posters, titles) belongs to its owners; check the rights before using it in marketing.
- Charging for ad-free access to a third-party site may conflict with that site's own terms; have a lawyer look at this together with the Terms and Conditions.

## Where the raw session lives

- Local transcripts (this machine), in `~/.claude/projects/-home-mk-dev-mk-flix/`: `01f7c073-67e5-47d5-8b14-f5a1d2d22235.jsonl` (the build-out) and `e7756eab-d8b0-46a7-bc93-1720d74eb355.jsonl` (2026-11-13 → 16: CORS, M-Pesa sandbox, gate fixes, rename, terms, email, portal and dashboard, email verification, forgot password, releases 1.5.0–1.6.0, outages and logging, devices, staff, live till payments, the email queue). On the same machine, `claude --resume` lists past sessions and `claude -c` continues the most recent.
- On a different machine, this file + the three GitHub repos are the handoff.
