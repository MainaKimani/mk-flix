# Referrals: plan for 1.8.0

Ambassadors (people marketing Blendy Play for a commission) each get a referral code. A
customer types it in when creating their Blendy Play account, and the ambassador earns **20% of every payment that customer makes in their first 12 months**.
The customer pays the normal price; there is no discount.

The admin dashboard gets a Referrals section: how each ambassador is doing, a drill-in per
ambassador, and monthly reports. Ambassadors sign in to the portal and see their own
dashboard: their referrals (emails masked), those customers' subscriptions, the revenue they
brought in, and their commission, with the report also emailed to them each month.

Status: planned, not started. Target: release 1.8.0.

## Decisions

| Question | Decision |
|---|---|
| Commission | 20% of each successful payment by a referred customer |
| How long | 12 months from that customer's first successful payment |
| Discount for the customer | None |
| Rate per ambassador | Defaults to 20%, editable per ambassador by a super-admin. Each commission line keeps the rate in force when it was earned, so a rate change never rewrites past months |
| Codes | Not case sensitive, and unique ignoring case: `Wanjiku10`, `WANJIKU10` and `wanjiku10` are the same code, and only one ambassador can have it |
| When a code is attached | At sign-up, by the customer. Afterwards only a super-admin can add or correct it, from the dashboard |
| Ambassador access | Their own portal sign-in and dashboard |
| Monthly report | An Excel file (`.xlsx`). Ambassadors can download it, and it is emailed to them on the 1st of every month at 09:00 EAT for the previous month |
| Super-admin monthly email | Same time: the previous month's revenue breakdown and what to send each ambassador |
| Commission refunded after it was paid out | Taken off the next payout. If nothing more is due, it is written off unless you recover it yourself |
| Name | "Ambassador" in everything people see, and in the code |
| Customer emails shown to ambassadors | Masked on the server, e.g. `wan***iku@gmail.com`. Phone numbers and names are never shown |
| Payouts | Paid by hand over M-Pesa and recorded in the dashboard. Automatic B2C payouts are out of scope |
| What earns commission | Only successful M-Pesa payments. Free or admin-granted access earns nothing |
| Existing customers | Not linked to anyone. Referrals start from 1.8.0 |
| Months | Calendar months in Nairobi time (EAT), by payment date |

## How it fits the current system

- Sign-up is `POST /api/auth/register` (`accounts.RegisterSerializer`), called from the apps'
  account gate (`mkflix-account.html`, shared by Android, TV, Windows and Linux). The portal has
  no sign-up form.
- Every payment is a `payments.Payment` with the user, plan, amount, status and `paid_at`.
  Commission is worked out from these rows: money actually received, not sign-ups.
- Portal roles today come from `/me`: `is_admin` (staff and super-admins see the dashboard)
  and `is_superadmin` (only they can change things). Ambassadors are a third kind of account.

## Backend (`mk-flix-be`): new `referrals` app

### Data

**Ambassador**: one per marketer, created by a super-admin.

| Field | Notes |
|---|---|
| `user` | One-to-one to `CustomUser`. The ambassador signs in with this account. An ambassador may also be a customer |
| `code` | Stored upper-cased; a unique constraint on the upper-cased value. Letters and digits, 4 to 20 characters |
| `commission_rate` | Decimal percentage, default `20.00` |
| `payout_phone` | M-Pesa number for payouts |
| `is_active` | Turning an ambassador off stops new sign-ups using the code. Customers already linked keep earning for the rest of their 12 months |
| `notes`, `created_at`, `updated_at` | |

**Referral**: the link between a customer and the ambassador who brought them. One per customer, never reassigned automatically.

| Field | Notes |
|---|---|
| `customer` | One-to-one to `CustomUser` |
| `ambassador` | FK to `Ambassador` |
| `code_used` | The code as typed, for the record |
| `source` | `signup` or `admin` (added or corrected later by a super-admin) |
| `window_starts_at` | The customer's first successful payment. Empty until they pay |
| `window_ends_at` | `window_starts_at` + 12 months |
| `created_at` | |

**CommissionLine**: one per successful payment by a referred customer inside their window.

| Field | Notes |
|---|---|
| `referral`, `payment` | `payment` is unique, so a payment can't earn twice |
| `payment_amount`, `rate`, `amount` | Copied at the time the commission is earned. `amount` = `payment_amount` x `rate`, rounded to the shilling |
| `month` | First day of the month the payment was made, in EAT, for reports |
| `status` | `earned`, `reversed` (the payment was reversed or refunded), `paid` |
| `payout` | FK to `Payout` once paid |

**Payout**: what you actually sent the ambassador.

| Field | Notes |
|---|---|
| `ambassador`, `month`, `amount` | |
| `mpesa_reference` | The M-Pesa receipt code |
| `paid_at`, `recorded_by` | |

### Behaviour

- **Sign-up**: `RegisterSerializer` takes an optional `referral_code`. It is trimmed and
  upper-cased, then looked up among active ambassadors. An unknown or inactive code is rejected
  with a clear field error ("That referral code isn't valid"), so the customer can fix it or
  leave the field empty; it does not silently create the account without the referral. A
  ambassador can't use their own code.
- **Code check**: `GET /api/referrals/check?code=…` answers `{valid: true|false}` so the gate
  can confirm the code as it's typed. It returns nothing about the ambassador. Rate-limited.
- **Earning**: wherever a payment is marked successful today, a hook creates the commission
  line. On a referred customer's first successful payment it also sets the 12-month window.
  Payments after `window_ends_at` earn nothing.
- **Reversal**: when a payment that earned commission is reversed or refunded, its line becomes
  `reversed`. If it was already paid out, the next payout is reduced by that amount and the
  reports show it as a deduction.
- **Email masking**: done on the server, so full emails never reach an ambassador's browser. Keep
  the first 3 and last 3 characters of the part before the `@`, and the whole domain:
  `wanjikukamau@gmail.com` becomes `wan***mau@gmail.com`. For 6 characters or fewer, keep only
  the first: `ann@yahoo.com` becomes `a***@yahoo.com`.

### API

Admin (staff can read; super-admins can change):

| Endpoint | What it returns or does |
|---|---|
| `GET /api/dashboard/referrals?month=2027-01` | One row per ambassador for the month: new referrals, paying customers, active subscriptions, revenue, commission earned, paid and owed. Totals row |
| `POST /api/dashboard/ambassadors` | Create an ambassador: creates or links the user account and sets the code and rate. The ambassador sets their password through the existing password-reset email |
| `GET /api/dashboard/ambassadors/<id>` | Profile and month-by-month figures |
| `PATCH /api/dashboard/ambassadors/<id>` | Change rate, payout phone, active, notes |
| `GET /api/dashboard/ambassadors/<id>/customers` | Their referrals, with full emails (admins may see them) and each customer's subscription status |
| `POST /api/dashboard/ambassadors/<id>/payouts` | Record a payout for a month |
| `GET /api/dashboard/ambassadors/<id>/report.xlsx?month=2027-01` | Monthly report, see below |
| `GET /api/dashboard/referrals/report.xlsx?month=2027-01` | All ambassadors for a month: the same workbook as the super-admin email |
| `PUT /api/dashboard/users/<id>/referral` | Add or correct a customer's ambassador |

Ambassador (only for a signed-in ambassador, only their own data):

| Endpoint | What it returns |
|---|---|
| `GET /api/ambassador/summary?month=…` | Referrals, paying customers, active subscriptions, revenue from their customers, commission earned, paid, owed; and the same figures for each of the last 12 months for a chart |
| `GET /api/ambassador/customers` | Masked email, date joined, plan, subscription status, date the commission window ends, commission earned from that customer |
| `GET /api/ambassador/report.xlsx?month=…` | Their monthly report, emails masked |

`/me` gains `is_ambassador` so the portal knows where to send them after sign-in.

### Monthly emails

A new cron job, `send_monthly_reports`, runs on the **1st of every month at 09:00 EAT** and
reports on the month just ended (on 1 March it covers February).

**To each active ambassador:**

- The body has their figures for the month: new referrals, paying customers, active
  subscriptions, revenue from their customers, commission earned, reversals, paid and owed,
  plus a link to `/ambassador`.
- Their monthly report is attached as an Excel file (emails masked).
- An ambassador with nothing that month still gets a short "no new commission" email, so a
  missing email means something went wrong.

**To every super-admin:**

- The body has the month's revenue breakdown:
  - total revenue from paid M-Pesa payments, with the number of payments
  - by plan (weekly, monthly)
  - new customers' first payments against renewals
  - referred customers against everyone else
  - total commission owed, and revenue after commission
- Then **what to send each ambassador**: name, M-Pesa number, commission earned, minus
  reversals, minus anything already paid, giving the amount to send. Ambassadors with nothing
  to send are listed with KES 0, so the list is complete.
- Attached: an Excel workbook with three sheets: Summary (the revenue breakdown), Payouts (one
  row per ambassador, with an empty M-Pesa reference column to fill in as you pay) and Lines
  (every commission line of the month, full emails).
- Payouts are still recorded in the dashboard; the email is the to-do list, not the record.

**How it's sent:**

- A `MonthlyReportEmail` row (recipient, kind, month, sent at) is written for each email that
  goes out, so running the job twice doesn't send anything twice. The admin dashboard shows
  which reports went out for each month, with a Resend button.
- Sending goes through `notifications.email` like the other emails. `QueuedEmail` has no
  attachments today, so it gains an optional attachment (file name, content type, content)
  for retries. Report emails don't expire.
- DEPLOY.md gets the new cron line next to `send_queued_emails`:
  `0 9 1 * *` if the server clock is on EAT, or `0 6 1 * *` if it's on UTC.

### Reports (Excel)

All reports download as `.xlsx`, built with `openpyxl` (a new backend dependency). Amounts are
real numbers formatted as KES, so they can be summed in Excel; dates are real dates; the header
row is frozen and columns are sized to fit.

- **Ambassador's monthly report**: a Summary sheet (earned, reversals, paid out, owed) and a
  Commission sheet with one row per commission line: date, customer email (masked when the
  ambassador downloads it, full when an admin does), plan, payment amount, rate, commission,
  status (earned, reversed, paid).
- **All ambassadors for a month** (admin only): the same three sheets as the super-admin email.

## Apps: account gate (`mkflix-account.html`)

- A **Referral code (optional)** field on the create-account form, below the password fields.
- It upper-cases as typed, and after a short pause calls the code check: a green tick for a
  valid code, a quiet "That code isn't valid" otherwise. An invalid code blocks sign-up until
  it's fixed or cleared.
- It works with a TV remote: the field is in the focus order, and the on-screen keyboard is
  fine for letters and digits.
- The gate is shared by all four apps, so this ships as an app release: **1.8.0**.
- The APKs are installed from the website, not a store, so a referral link can't carry the
  code through the install. Customers type it. The portal can still accept `?ref=CODE` on its
  home page and show "Your referral code: CODE" by the downloads, so it's easy to copy.

## Portal (`blendy-play`)

### Admin dashboard: Referrals

- **Referrals list**: month picker, the overview table, sortable by revenue, paying customers
  or commission owed. A Download Excel button for the month. Add ambassador.
- **One ambassador**: profile and code, a 12-month chart of revenue and commission, the customer
  list (full emails), payouts with Record payout, and the monthly Excel report for any month.
- **User detail page**: shows who referred the customer; super-admins can change it.

### Ambassador dashboard: `/ambassador`

- After sign-in, an ambassador goes to `/ambassador` (a customer who is also an ambassador gets a link
  to it from My account).
- Tiles for the chosen month: referrals, paying customers, active subscriptions, revenue
  brought in, commission earned, paid, owed.
- A 12-month chart of revenue and commission.
- The customer list with masked emails and each subscription's status.
- Their code, with a copy button, and the `?ref=` link.
- Download the monthly Excel report for any month.

## Tests

- Codes: the same code in different case is rejected as a duplicate; lookup ignores case and
  surrounding spaces; an inactive code and an ambassador's own code are rejected.
- Commission: 20% of a successful payment; nothing for failed payments or free access; the
  window starts at the first successful payment and nothing is earned after 12 months; a rate
  change doesn't alter old lines; a reversal marks the line reversed and reduces the next payout.
- Masking: long, short (6 or fewer) and edge-case emails; no full email in any ambassador
  response.
- Access: an ambassador can't see another ambassador's data or any admin endpoint; staff can read
  but not change; super-admins can change.
- Months: payments near midnight EAT land in the right month.

## Out of scope for 1.8.0

- Automatic M-Pesa (B2C) payouts.
- Customer discounts for using a code.
- Ambassadors creating their own accounts or codes.
- Linking customers who signed up before 1.8.0.
- Multi-level referrals (ambassadors recruiting ambassadors).

## Rough size

| Part | Estimate |
|---|---|
| Backend: models, sign-up, earning hook, reversals, APIs, Excel reports, tests | 3 to 4 days |
| Monthly emails: cron job, ambassador and super-admin templates, attachment support in the queue | 1 to 1.5 days |
| Gate field and code check, in all four apps | about half a day |
| Admin Referrals section | about 2 days |
| Ambassador dashboard | 1 to 2 days |
| **Total** | **about 2 weeks** |

## Still to decide

Nothing at the moment. Decisions made on 2026-11-18 are in the table at the top.
