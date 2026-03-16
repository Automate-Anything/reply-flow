# Affiliate Portal Design Spec

**Date:** 2026-03-16
**Status:** Approved

## Overview

A standalone affiliate portal for reply-flow that allows partners to refer companies, earn commissions on Stripe invoice events, track their performance, and receive automatic ACH payouts. Includes admin tools in the reply-flow super admin panel.

## Architecture

- **Frontend:** Standalone Vite + React + TypeScript app at `/affiliate-portal/`, deployed to its own subdomain (e.g., `affiliates.replyflow.com`)
- **Backend:** New `/api/affiliate/*` routes on the existing Express server in `/server/`
- **Database:** New tables in the existing Supabase (PostgreSQL) database
- **Auth:** Separate JWT-based authentication for affiliates (not Supabase Auth)
- **Payments:** Stripe Connect Express accounts for ACH payouts; commissions triggered by existing Stripe invoice webhooks
- **Cron:** `node-cron` for scheduled payouts (new dependency)
- **Email:** Uses the project's existing email provider for password resets and notifications
- **RLS:** All affiliate tables accessed via `supabaseAdmin` (bypasses RLS). Access control enforced at the Express middleware layer. RLS enabled on tables but with no restrictive policies.

## Database Schema

### `affiliates`

Core affiliate account table. Separate from reply-flow `users`.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Default gen_random_uuid() |
| name | text NOT NULL | |
| email | text UNIQUE NOT NULL | Login credential |
| phone | text | Optional |
| password_hash | text NOT NULL | bcrypt hashed |
| affiliate_code | text UNIQUE NOT NULL | Auto-generated via nanoid (8 chars, alphanumeric), used in referral links |
| approval_status | text NOT NULL DEFAULT 'pending_review' | `pending_review`, `approved`, `rejected` |
| stripe_connect_account_id | text | Stripe Express Connect account for ACH payouts |
| bank_account_added | boolean DEFAULT false | Whether bank details have been submitted |
| commission_schedule_id | uuid FK → commission_schedules | Schedule template (nullable for simple rate) |
| commission_type | text | `percentage` or `flat` (fallback if no schedule) |
| commission_rate | numeric | Simple rate fallback if no schedule |
| refresh_token | text | For JWT refresh flow |
| password_reset_token | text | Nullable, for password reset flow |
| password_reset_expires_at | timestamptz | Nullable, token expiration |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | Auto-updated via `moddatetime` trigger |

### `commission_schedules`

Reusable templates defining how commission rates change over payment events.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | text NOT NULL | e.g., "Standard Partner", "Premium 6-Month" |
| commission_type | text NOT NULL | `percentage` or `flat` — applies to all periods |
| end_behavior | text NOT NULL | `stop`, `continue_last`, `custom_rate` |
| end_rate | numeric | Only used when end_behavior = `custom_rate` |
| created_at | timestamptz DEFAULT now() | |

### `commission_schedule_periods`

Individual periods within a schedule.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| schedule_id | uuid FK → commission_schedules ON DELETE CASCADE | |
| from_payment | int NOT NULL | Starting payment number (1-based) |
| to_payment | int NOT NULL | Ending payment number (inclusive) |
| rate | numeric NOT NULL | Percentage (e.g., 30) or flat amount in cents |

### `affiliate_referrals`

Tracks each company referred by an affiliate.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| affiliate_id | uuid FK → affiliates ON DELETE CASCADE | |
| company_id | uuid FK → companies | The referred company |
| status | text NOT NULL DEFAULT 'pending' | `pending`, `trialing`, `active`, `churned` |
| payment_count | int DEFAULT 0 | Number of successful payments (drives schedule period) |
| last_plan_name | text | Tracks the previous plan for upgrade/downgrade detection |
| commission_schedule_id | uuid FK → commission_schedules | FK reference to schedule at time of referral. Schedules are immutable once assigned to referrals — editing a schedule creates a new version. |
| schedule_override_applied | boolean DEFAULT false | Whether admin applied a new schedule to this referral |
| created_at | timestamptz DEFAULT now() | |

### `commission_events`

Individual commission earnings tied to Stripe invoice events.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| affiliate_id | uuid FK → affiliates ON DELETE CASCADE | |
| referral_id | uuid FK → affiliate_referrals ON DELETE CASCADE | |
| event_type | text NOT NULL | `signup`, `renewal`, `upgrade`, `downgrade`, `churn` |
| payment_number | int NOT NULL | Which payment this was for the referral |
| plan_name | text | |
| invoice_amount_cents | int NOT NULL | Stripe invoice amount |
| commission_amount_cents | int NOT NULL | Calculated commission |
| stripe_invoice_id | text | |
| payout_id | uuid FK → affiliate_payouts | Nullable. Set when this event is included in a payout. Prevents double-paying. |
| created_at | timestamptz DEFAULT now() | |

### `affiliate_payouts`

Monthly payout records.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| affiliate_id | uuid FK → affiliates ON DELETE CASCADE | |
| period_start | date NOT NULL | |
| period_end | date NOT NULL | |
| amount_cents | int NOT NULL | |
| status | text NOT NULL DEFAULT 'pending' | `pending`, `processing`, `paid`, `failed` |
| stripe_transfer_id | text | Stripe Transfer ID for ACH |
| paid_at | timestamptz | |
| created_at | timestamptz DEFAULT now() | |

### `affiliate_campaigns`

Marketing campaign links for tracking.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| affiliate_id | uuid FK → affiliates ON DELETE CASCADE | |
| name | text NOT NULL | |
| slug | text UNIQUE NOT NULL | URL-safe campaign identifier |
| description | text | |
| total_clicks | int DEFAULT 0 | |
| total_signups | int DEFAULT 0 | |
| created_at | timestamptz DEFAULT now() | |

### `affiliate_notification_preferences`

Email notification toggles.

| Column | Type | Notes |
|--------|------|-------|
| affiliate_id | uuid PK FK → affiliates ON DELETE CASCADE | |
| new_referral | boolean DEFAULT true | |
| referral_converted | boolean DEFAULT true | |
| commission_earned | boolean DEFAULT true | |
| payout_processed | boolean DEFAULT true | |

### `affiliate_agreements`

Terms & conditions versioning.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| version | text NOT NULL | e.g., "1.0" |
| terms_text | text NOT NULL | Full terms content |
| created_at | timestamptz DEFAULT now() | |

### `affiliate_agreement_acceptances`

Tracks which affiliate accepted which version.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| affiliate_id | uuid FK → affiliates ON DELETE CASCADE | |
| agreement_id | uuid FK → affiliate_agreements ON DELETE CASCADE | |
| accepted_at | timestamptz DEFAULT now() | |

### `payout_settings`

Global payout configuration (singleton table — migration seeds exactly one row, API uses UPDATE only).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | CHECK (id = '00000000-0000-0000-0000-000000000001') enforces singleton |
| min_payout_cents | int DEFAULT 2500 | Configurable minimum threshold ($25 default) |
| payout_day_of_month | int DEFAULT 1 | Day of month auto-payouts run |
| updated_at | timestamptz DEFAULT now() | |

### `affiliate_click_log`

Stores raw click events for deduplication and analytics.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| affiliate_id | uuid FK → affiliates ON DELETE CASCADE | |
| campaign_id | uuid FK → affiliate_campaigns | Nullable (null = default link) |
| ip_hash | text NOT NULL | SHA-256 of IP address (for dedup without storing raw IPs) |
| created_at | timestamptz DEFAULT now() | |

Deduplication: before inserting, check for existing row with same `affiliate_id` + `ip_hash` within last 24 hours.

### Indexes

In addition to PKs and unique constraints, the migration should create:

- `affiliate_referrals(company_id)` — webhook lookup on `invoice.paid`
- `affiliate_referrals(affiliate_id)` — portal queries
- `commission_events(referral_id)` — commission lookups per referral
- `commission_events(affiliate_id)` — portal queries
- `commission_events(payout_id)` — payout aggregation
- `affiliate_campaigns(affiliate_id)` — campaign listing
- `affiliate_click_log(affiliate_id, ip_hash, created_at)` — dedup check

## Authentication & Authorization

### Affiliate Auth (Standalone Portal)

Separate JWT-based auth system, independent of Supabase Auth:

- **Signup:** Name/email/password/phone → bcrypt hash → `affiliates` table → `approval_status = 'pending_review'`
- **Login:** Email/password verified → JWT access token (15 min, in-memory) + refresh token (7 days, localStorage)
- **Token refresh:** `/api/affiliate/refresh` validates refresh token, returns new access token
- **Password reset:** Email-based token flow with URL-cleared-before-render security pattern
- **Token security:** Access token in memory only (not localStorage) to prevent XSS theft. Refresh token deduplication to prevent race conditions on concurrent 401s.

### Route Protection

- **Portal routes:** `requireAffiliateAuth` middleware on all `/api/affiliate/*` routes (except auth endpoints)
- **Admin routes:** Existing `requireAuth` + `isSuperAdmin` check for `/api/affiliate/admin/*` routes

### Approval Flow

1. Open signup → `pending_review` → affiliate sees pending screen
2. Admin invites → can be set to `approved` immediately
3. Super admin approves/rejects from the admin panel
4. Only `approved` affiliates can access portal data

## Commission Calculation Engine

### Trigger: `invoice.paid`

Within the existing `invoice.paid` webhook handler in `server/src/routes/billing.ts`, after resolving `company_id` from the `subscriptions` table via `stripe_customer_id`:

1. Query `affiliate_referrals` where `company_id` matches and `status` IN (`pending`, `trialing`, `active`)
2. If a referral exists → increment `payment_count`
3. Determine event type by comparing invoice plan to `referral.last_plan_name` (see Event Type Detection)
4. Update `last_plan_name` to the current invoice's plan
5. Determine the correct commission rate from the schedule + payment number
6. Create a `commission_events` record
7. If `payment_count === 1`, update referral `status` to `active`

### Trigger: `customer.subscription.deleted`

Within the existing `customer.subscription.deleted` webhook handler:

1. Resolve `company_id` from the `subscriptions` table
2. Query `affiliate_referrals` where `company_id` matches
3. If a referral exists → set `status = 'churned'`
4. Create a `commission_events` record with `event_type = 'churn'`, `commission_amount_cents = 0`

### Rate Resolution

For a referral at payment N:

1. Check the referral's `commission_schedule_id`
2. Find matching period where `from_payment <= N <= to_payment`
3. If no period matches, apply `end_behavior`:
   - `stop` → no commission
   - `continue_last` → last period's rate
   - `custom_rate` → schedule's `end_rate`
4. If no schedule → fall back to affiliate's `commission_type` + `commission_rate`
5. Calculate: `percentage` → `invoice_amount_cents * rate / 100`, `flat` → `rate` in cents

### Event Type Detection

Detection uses `payment_count` and `last_plan_name` on `affiliate_referrals`:

| Condition | Event Type |
|---|---|
| `payment_count === 0` (first payment) | `signup` |
| `last_plan_name === current_plan_name` | `renewal` |
| `last_plan_name` is a lower tier than `current_plan_name` | `upgrade` |
| `last_plan_name` is a higher tier than `current_plan_name` | `downgrade` |
| `customer.subscription.deleted` webhook | `churn` (tracked, no commission) |

Plan tier comparison uses the `plans` table's price or a tier rank column. If plan comparison is ambiguous, default to `renewal`.

### Schedule Assignment

When admin assigns a new schedule to an affiliate:
- Checkbox: "Apply to existing referrals too?"
- Unchecked → only new referrals use the new schedule
- Checked → all active referrals updated, `schedule_override_applied = true`

## Payout System

### Monthly Auto-Payout Flow

Runs on configured `payout_day_of_month` via `node-cron` in the Express server:

1. For each approved affiliate, sum all `commission_events` where `payout_id IS NULL`
2. Skip if total < `min_payout_cents`
3. Skip if `bank_account_added = false`
4. Create `affiliate_payouts` record with status = `pending`
5. Set `payout_id` on all included `commission_events` to link them to this payout
6. Execute ACH via Stripe Connect Transfer to the affiliate's Express account
7. Update status: `pending` → `processing` → `paid` (or `failed`)

### Stripe Connect Setup (Express Accounts)

Using Stripe Connect **Express** accounts (Stripe handles identity verification via hosted onboarding):

1. Affiliate clicks "Set up payouts" in Settings
2. Backend creates a Stripe Express Connected Account and generates an Account Link (onboarding URL)
3. Affiliate is redirected to Stripe's hosted onboarding flow (collects bank details, identity verification, tax info)
4. On completion, Stripe redirects back to the portal
5. Backend listens for `account.updated` webhook to confirm onboarding is complete
6. Sets `stripe_connect_account_id` and `bank_account_added = true`

This avoids the platform needing to collect sensitive bank/identity information directly.

### Cron Infrastructure

- **Dependency:** `node-cron` package added to `/server/`
- **Registration:** Cron job registered in `server/src/cron/affiliatePayouts.ts`, initialized from `server/src/index.ts`
- **Schedule:** Runs daily at midnight; checks if today matches `payout_day_of_month` from `payout_settings`
- **Idempotency:** Before creating payouts, checks `affiliate_payouts` for existing records with the same `period_start`/`period_end` for each affiliate. Skips if already exists. This prevents double runs on server restart.
- **Multi-instance safety:** Uses a PostgreSQL advisory lock (`pg_try_advisory_lock`) at the start of each run. Only one instance processes payouts; others skip gracefully.

### Manual Controls

- Super admin can trigger payout run manually: `POST /api/affiliate/admin/payouts/run`
- Retry failed payouts: `POST /api/affiliate/admin/payouts/:id/retry`
- Configure threshold and payout day

## Frontend Architecture

### Standalone Portal (`/affiliate-portal/`)

```
affiliate-portal/
├── src/
│   ├── App.tsx                    # Hash router, auth guard, tab layout
│   ├── main.tsx                   # Entry point
│   ├── api.ts                     # API client (JWT, refresh, dedup)
│   ├── index.css                  # Tailwind + CSS variables
│   ├── hooks/
│   │   ├── useAuth.ts             # Login/signup/forgot/reset
│   │   └── usePortalData.ts       # Dashboard data fetching
│   ├── components/
│   │   ├── auth/                  # LoginForm, SignupForm, ForgotPasswordForm, ResetPasswordForm, PendingReviewScreen, RejectedScreen
│   │   ├── layout/                # Header, TabNav
│   │   ├── ui/                    # Button, Input, Card, Badge, Table, Skeleton, EmptyState
│   │   └── shared/                # StatusBadge, EventTypeBadge
│   ├── tabs/
│   │   ├── DashboardTab.tsx       # Stats, earnings chart, funnel, affiliate link
│   │   ├── ReferralsTab.tsx       # Referred companies table
│   │   ├── CommissionsTab.tsx     # Commission events table
│   │   ├── PayoutsTab.tsx         # Payout history
│   │   ├── MarketingTab.tsx       # Campaign links, QR codes, social share
│   │   └── SettingsTab.tsx        # Profile, bank details, password, notifications, terms, delete account
│   └── lib/
│       └── utils.ts
├── index.html
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── postcss.config.js
```

### Portal Tabs

1. **Dashboard** — Balance card, 4 stat cards, 12-month earnings bar chart, conversion funnel, affiliate link with copy
2. **Referrals** — Table of referred companies (company, status, plan, billing, commission, date)
3. **Commissions** — Table of commission events (date, event type, plan, invoice amount, commission)
4. **Payouts** — Payout history (period, amount, status, payment method, paid date)
5. **Marketing** — Default link + campaign links (create/delete, max 20), QR codes, social share (Twitter/LinkedIn/Facebook/WhatsApp)
6. **Settings** — Profile form, bank account + routing number, change password, notification toggles, terms acceptance, request account deletion

### Key Differences from Example

- No 30-minute inactivity auto-logout
- Bank account/routing number form for ACH (new)
- Schedule-aware commission display (current period, rate, payments until next tier)
- Account deletion included
- Styled to match reply-flow's design system (Tailwind variables/colors)

## Super Admin (in reply-flow)

### New Tabs in Super Admin Page

1. **Affiliates** — Table of all affiliates, approve/reject, edit, assign schedule, invite new, detail view
2. **Commission Schedules** — CRUD for schedule templates, period editor, visual preview
3. **Payouts** — All payouts across affiliates, manual trigger, retry failed, settings (threshold, day)
4. **Agreements** — Manage terms versions, view acceptance status

### New Components

```
client/src/components/super-admin/
├── affiliates/
│   ├── AffiliateListTab.tsx
│   ├── AffiliateDetailView.tsx
│   ├── InviteAffiliateDialog.tsx
│   └── AssignScheduleDialog.tsx
├── commission-schedules/
│   ├── ScheduleListTab.tsx
│   ├── ScheduleEditorDialog.tsx
│   └── SchedulePreview.tsx
├── affiliate-payouts/
│   ├── PayoutListTab.tsx
│   └── PayoutSettingsDialog.tsx
└── affiliate-agreements/
    ├── AgreementListTab.tsx
    └── AgreementEditorDialog.tsx
```

### Backend Admin Routes

```
GET/POST   /api/affiliate/admin/affiliates
GET/PUT/DELETE /api/affiliate/admin/affiliates/:id
GET/POST   /api/affiliate/admin/schedules
PUT/DELETE /api/affiliate/admin/schedules/:id
GET        /api/affiliate/admin/payouts
POST       /api/affiliate/admin/payouts/run
POST       /api/affiliate/admin/payouts/:id/retry
GET/PUT    /api/affiliate/admin/payout-settings
GET/POST   /api/affiliate/admin/agreements
```

All protected by `requireAuth` + `isSuperAdmin`.

## Referral Tracking

### Link Format

- Default: `https://app.replyflow.com/auth?ref={affiliate_code}`
- With campaign: `https://app.replyflow.com/auth?ref={affiliate_code}&campaign={slug}`

### Click Tracking

- Signup page loads with `ref` param → fires `POST /api/affiliate/track-click` with `{ affiliate_code, campaign_slug? }`
- Increments `total_clicks` on matching campaign
- Deduplicated by IP + affiliate_code within 24 hours

### Signup Attribution

- `ref` and `campaign` stored in sessionStorage during signup flow
- After successful company creation → `POST /api/affiliate/track-signup` with `{ affiliate_code, campaign_slug?, company_id }`
- Creates `affiliate_referrals` record
- Loosely coupled: if tracking fails, signup still succeeds

### Changes to Existing Code

Minimal changes to reply-flow's auth page:
1. Read `ref` and `campaign` from URL query params
2. Store in sessionStorage
3. After company creation, call tracking endpoint

## API Endpoints (Affiliate Portal)

### Auth (no auth required)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/affiliate/login` | Login |
| POST | `/api/affiliate/signup` | Create account |
| POST | `/api/affiliate/logout` | Logout |
| POST | `/api/affiliate/refresh` | Refresh access token |
| POST | `/api/affiliate/forgot-password` | Request reset link |
| POST | `/api/affiliate/reset-password` | Reset password with token |

### Profile & Settings (auth required)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/affiliate/me` | Get profile |
| PUT | `/api/affiliate/profile` | Update name/email/phone |
| PUT | `/api/affiliate/password` | Change password |
| PUT | `/api/affiliate/bank-account` | Add/update bank details |
| GET | `/api/affiliate/agreement` | Get current terms |
| POST | `/api/affiliate/agreement/accept` | Accept terms |
| POST | `/api/affiliate/delete-request` | Request account deletion (sets a flag for admin review, does not immediately delete) |

### Analytics (auth required)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/affiliate/stats` | Dashboard KPIs |
| GET | `/api/affiliate/balance` | Earnings/payout summary |
| GET | `/api/affiliate/earnings-history` | Monthly earnings (12 months) |
| GET | `/api/affiliate/funnel` | Conversion funnel metrics |

### Data (auth required)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/affiliate/referrals` | List referrals |
| GET | `/api/affiliate/commissions` | List commission events |
| GET | `/api/affiliate/payout-history` | List payouts |

### Marketing (auth required)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/affiliate/campaigns` | List campaigns |
| POST | `/api/affiliate/campaigns` | Create campaign |
| DELETE | `/api/affiliate/campaigns/:id` | Delete campaign |

### Notifications (auth required)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/affiliate/notification-preferences` | Get preferences |
| PUT | `/api/affiliate/notification-preferences` | Update preferences |

### Tracking (no auth required)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/affiliate/track-click` | Record referral link click |
| POST | `/api/affiliate/track-signup` | Attribute company signup to affiliate |

### Rate Limiting

All unauthenticated endpoints (`login`, `signup`, `forgot-password`, `track-click`, `track-signup`) should be rate-limited:
- Login/signup: 10 requests per minute per IP
- Track-click: 30 requests per minute per IP
- Track-signup: 10 requests per minute per IP
- Forgot-password: 3 requests per minute per email
