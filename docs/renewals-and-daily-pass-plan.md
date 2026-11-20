# Renewal reminders and the daily pass: plan for 1.7.2

Two changes that go out together:

1. **Renewal reminders and one-tap renew.** Customers hear from us before their access ends
   and when it has ended, and can renew in the app with one tap: their last plan and M-Pesa
   number are already filled in, and they only approve the prompt on their phone.
2. **A daily pass.** A third plan next to Weekly and Monthly, for 24 hours of access.

Nothing renews by itself. Terms 6.4 ("No automatic renewal") stays true: every payment is
still a prompt the customer approves on their phone.

Status: planned for 1.7.2, decisions confirmed. Not built yet.

## Decisions

| Question | Decision |
|---|---|
| Daily pass price | KES 29 for 24 hours. Weekly is KES 149 (about KES 21 a day), so a day at a time costs more, and Weekly remains the better deal |
| Daily pass length | 24 hours from payment (`duration_days = 1`). Paying again while it's active adds 24 hours on top, like the other plans |
| "Ends soon" email | Once per period, 24 hours before the end. Weekly and Monthly only: daily pass customers never get it |
| "Has ended" email | Once, within an hour of the end. Weekly and Monthly only: daily pass customers never get it |
| Daily pass customers | No reminder emails at all. They are reminded in the app only (the banner and launch reminder below) |
| Other reminders | None. Two emails per period at most, and no repeats after the "has ended" email |
| In-app reminder | A banner on the gate's subscription page and the paywall while 24 hours or less are left (3 hours for a daily pass), plus a short reminder screen when the app opens in that window |
| Turning reminders off | One link in every reminder email turns them off, with no sign-in. The customer can turn them back on from the portal's `/account` page. Receipts and security emails keep coming |
| One-tap renew | Renews on the plan the customer last paid for, using the phone number from their last successful payment. Shown masked (`0712 *** 678`). "Change plan or number" opens the normal paywall |
| Terms on one-tap renew | No tick box if the customer already agreed to the current Terms version on an earlier payment. If the Terms have changed since, the box is shown as it is today |
| Lifetime and admin-granted access | No reminders and no renew banner |
| Referrals | Nothing to change. Daily pass payments are ordinary successful payments, so a referred customer's daily passes earn commission like any other plan |

## How it fits the current system

- `billing.Plan` has `interval` (`WEEK`, `MONTH`) and `duration_days`. The dashboard can
  already create plans (`dashboard/editing.py`), but it only accepts `WEEK` and `MONTH`, so a
  day pass would show as "Billed weekly".
- `billing.Subscription` is one row per user. `extend()` stacks a payment's days onto any
  time that's left, so renewing early never loses time.
- Nothing marks a subscription `EXPIRED` today. "Expired" is worked out from
  `current_period_end` when it's read (`is_active`, the dashboard's `_state`), and the
  reminder job does the same.
- Email goes through `notifications.send_email(..., queue=True)` and the
  `send_queued_emails` cron job. Templates live in `notifications/templates/emails/<name>/`.
- The gate (`mkflix-account.html`, shared by Android, TV, Windows and Linux) shows the
  subscription page (`showSubscription`) and the paywall (`showPaywall`). Pay calls
  `POST /api/payments/mpesa/stk` with `plan_code`, `phone_number` and `terms_version`.
- The apps label a plan from its interval: `{ WEEK: "weekly", MONTH: "monthly" }`, otherwise
  the interval in lower case. On 1.7.1 a `DAY` plan would read "Billed day".

## Backend (`mk-flix-be`)

### Daily pass

- Add `DAY = "DAY", "Daily"` to `Plan.Interval` (migration: choices only, no data change).
- Let the dashboard plan editor accept `DAY`. `dashboard/tests.py` currently checks that
  `DAY` is rejected; change that test.
- Create the plan **after** 1.7.2 is out and the minimum app version is raised to 1.7.2
  (`MIN_APP_VERSIONS` and the release manifest's `minimum_version`), so no app shows
  "Billed day". It's created from the dashboard (code `daily`, name "Daily", KES 29, `DAY`,
  1 day), not in a migration, so the price can change without a release.

### Reminders

**On `Subscription`**: two fields that record which period each email was sent for. When a
renewal moves `current_period_end`, they no longer match it, so the next period gets its own
reminders with no reset needed.

| Field | Notes |
|---|---|
| `ending_soon_sent_for` | The `current_period_end` the "ends soon" email went out for. Empty if none |
| `ended_sent_for` | The `current_period_end` the "has ended" email went out for. Empty if none |

**On `CustomUser`**: `renewal_reminders` (boolean, default on).

**Job `send_renewal_reminders`** (`billing/management/commands/`), every 15 minutes:

- *Ends soon:* ACTIVE, not lifetime, plan interval is not `DAY`, ends within the next 24 hours,
  `ending_soon_sent_for != current_period_end`, and the user has reminders on.
- *Has ended:* not lifetime, plan interval is not `DAY`, ended within the last 24 hours, `ended_sent_for !=
  current_period_end`, and the user has reminders on. The 24-hour limit means customers whose
  access ended long ago don't all get an email the first time the job runs.
- Each email is queued (`queue=True`) and its field is set in the same transaction, so a
  crash or a second run never sends it twice.
- Logs one line per run: how many of each it sent.

**Emails** (`notifications/templates/emails/`), plain and short, in the style of
`payment_receipt`:

- `renewal_ending_soon`: "Your Blendy Play plan ends tomorrow at 14:30". Says how to renew in the app
  (open Blendy Play → Renew) and that renewing early adds to the time left.
- `renewal_ended`: "Your Blendy Play plan has ended". Says how to renew in the app.
- Both have the footer link "Stop renewal reminders".
- Neither mentions CineJoy, and neither links to cinejoy.pk.
- Times in EAT.

**Turning reminders off:** the link in the email opens the portal page
`<PORTAL_URL>/reminders-off?token=<signed token>` (Django `signing`, user id plus purpose, no
expiry). The page posts the token to `POST /api/reminders/off`, which needs no sign-in and sets
`renewal_reminders = False`. It's a POST from a page rather than a GET on the link itself,
because mail scanners open every link in an email and would turn reminders off on their
own. `PATCH /api/auth/me` accepts `renewal_reminders` for the portal toggle.

### One-tap renew

- `GET /api/me/subscription` gains a `renew` object for the gate, or `null` when there's
  nothing to renew with (no successful payment yet, lifetime access, or the last plan is no
  longer active):

  ```json
  "renew": {
    "plan": { "code": "weekly", "name": "Weekly", "price": "149.00", "currency": "KES", "interval": "WEEK" },
    "phone_masked": "0712 *** 678",
    "terms_agreed": true
  }
  ```

  `terms_agreed` is true when the customer's newest successful payment carries the current
  Terms version.
- `POST /api/payments/mpesa/stk` accepts `{"renew": true}` in place of `plan_code` and
  `phone_number`. The backend takes both from the last successful payment, and takes
  `terms_version` from that payment when `terms_agreed` is true. Everything after that
  (the STK push, the callback, reconciliation, the receipt, referral commission) is the
  existing code path.
- The full phone number never goes to the app; it already has it, because the customer typed
  it, but the masked form is all the gate needs.

### Deploy

- Migrations: `billing` (interval choices, two subscription fields), `accounts`
  (`renewal_reminders`).
- New cron line, every 15 minutes (`*/15 * * * *`), with the real paths from
  the cPanel notes:
  `.../python .../manage.py send_renewal_reminders >> .../reminders.log 2>&1`
- Add it to `DEPLOY.md` section 7.

## Apps (`mk-flix`): the gate

Both copies of `mkflix-account.html` (desktop and Android assets) stay byte-identical.

- **Plan labels:** add `DAY: "daily"` to the cadence map, and show "24 hours" in place of
  "Billed daily" for that plan, since it's a pass rather than a repeating bill.
- **Subscription page, ending soon** (24 hours or less, 3 hours for a daily pass): a note
  above the details, "Your plan ends today at 14:30", and the secondary button becomes
  **Renew Weekly — KES 149** when `renew` is set. Otherwise it stays "Renew or change plan".
- **Subscription page, expired:** the primary button becomes **Renew Weekly — KES 149**
  when `renew` is set, with "Choose a different plan" below it.
- **The renew screen:** a short confirmation in place of the paywall: plan, price, the masked
  number, the Terms box only when `terms_agreed` is false, and **Pay with M-Pesa**. Then the
  existing "Check your phone" screen and status polling. A link, "Change plan or number",
  opens the full paywall.
- **Reminder on launch:** if the subscription check at app start finds the plan in its
  ending-soon window, the gate shows a short screen before the site: "Your plan ends soon",
  with **Renew Weekly — KES 149** and **Continue to Blendy Play**, and goes on to the site by
  itself after 8 seconds unless the user touches it. Shown at most once per app start.
  (Planned as a toast inside the site, but that needs new bridge code in both apps; the gate
  screen needs none.)
- **Expired at launch:** with `renew` set, the gate opens the renew screen ("Your plan ended
  today at 14:05. Renew it to keep watching.") in place of the paywall, with "Browse without
  subscribing" below.
- **Terms:** the price table gains the Daily row (in the fallback copy here and in a new Terms
  version published from the dashboard), and section 6.4 adds that we email a reminder
  before and when access ends, which can be turned off. Bump `TERMS_VERSION`.

## Portal (`blendy-play`)

- `/reminders-off?token=...`: a small page with one button, "Stop renewal reminders", that
  posts the token to `POST /api/reminders/off`, then says how to turn them back on.
- `/account`: a "Renewal reminders" switch (calls `PATCH /api/auth/me`).
- `/dashboard`: the plan editor offers "Daily". Plan lists show "24 hours" for it.
- The product page's price list gains the Daily pass once the plan is live.

## Tests

- Backend: the reminder job sends each email once per period; renewing moves the period so
  the next one is sent; daily plans get neither email; lifetime gets nothing; turned-off
  users get nothing; access that ended over 24 hours ago is skipped; the off link works without
  sign-in and rejects a tampered token; `renew: true` uses the last successful payment's plan
  and phone, refuses with no earlier payment, and requires a Terms version when the Terms
  have changed; the plan editor accepts `DAY`.
- Apps: by hand on Android, TV and desktop, with a test subscription whose
  `current_period_end` is set from the admin: ending-soon banner and launch reminder, expired renew,
  Terms box shown and hidden, "Change plan or number", and a daily plan's label.

## Order of work

1. Backend: `DAY` interval, reminder fields, the job, the emails, the off link.
2. Backend: `renew` on `/me/subscription` and `renew: true` on the STK endpoint.
3. Gate: labels, banners, renew screen, launch reminder. New Terms version.
4. Portal: reminders switch, Daily in the plan editor.
5. Release 1.7.2, deploy the backend, add the cron line.
6. Raise the minimum app version to 1.7.2, then create the Daily plan from the dashboard.

## Out of scope

- SMS or push notifications. Email and the in-app banner only.
- Automatic renewal of any kind (M-Pesa Ratiba standing orders included).
- Discounts or offers in reminder emails.
