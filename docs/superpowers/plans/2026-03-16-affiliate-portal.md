# Affiliate Portal Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone affiliate portal with commission schedules, ACH payouts via Stripe Connect, and admin tools in the reply-flow super admin panel.

**Architecture:** Standalone Vite+React frontend at `/affiliate-portal/` talking to new `/api/affiliate/*` routes on the existing Express server. New Supabase tables for affiliates, commissions, schedules, payouts, campaigns. Commission calculation hooks into existing Stripe webhook handlers. Payouts run via node-cron with Stripe Connect Express accounts.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind CSS (portal frontend), Express 5 + Supabase + Stripe + node-cron (server), PostgreSQL (database)

**Spec:** `docs/superpowers/specs/2026-03-16-affiliate-portal-design.md`

---

## Chunk 1: Database Schema & Server Foundation

### Task 1.1: Database Migration

**Files:**
- Create: `supabase/migrations/063_affiliate_portal.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/063_affiliate_portal.sql` with all affiliate tables. Follow the existing migration pattern (see `supabase/migrations/062_company_branding.sql` for reference).

```sql
-- Enable moddatetime extension if not already enabled
CREATE EXTENSION IF NOT EXISTS moddatetime;

-- Commission schedule templates
CREATE TABLE commission_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  commission_type TEXT NOT NULL CHECK (commission_type IN ('percentage', 'flat')),
  end_behavior TEXT NOT NULL CHECK (end_behavior IN ('stop', 'continue_last', 'custom_rate')),
  end_rate NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Schedule periods
CREATE TABLE commission_schedule_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES commission_schedules(id) ON DELETE CASCADE,
  from_payment INT NOT NULL,
  to_payment INT NOT NULL,
  rate NUMERIC NOT NULL,
  CHECK (from_payment >= 1),
  CHECK (to_payment >= from_payment)
);

-- Core affiliate accounts
CREATE TABLE affiliates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  affiliate_code TEXT UNIQUE NOT NULL,
  approval_status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (approval_status IN ('pending_review', 'approved', 'rejected')),
  stripe_connect_account_id TEXT,
  bank_account_added BOOLEAN DEFAULT false,
  commission_schedule_id UUID REFERENCES commission_schedules(id),
  commission_type TEXT CHECK (commission_type IN ('percentage', 'flat')),
  commission_rate NUMERIC,
  refresh_token TEXT,
  password_reset_token TEXT,
  password_reset_expires_at TIMESTAMPTZ,
  deletion_requested_at TIMESTAMPTZ,
  deletion_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Auto-update updated_at
CREATE TRIGGER affiliates_updated_at
  BEFORE UPDATE ON affiliates
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

-- Affiliate referrals
CREATE TABLE affiliate_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'trialing', 'active', 'churned')),
  payment_count INT DEFAULT 0,
  last_plan_name TEXT,
  commission_schedule_id UUID REFERENCES commission_schedules(id),
  schedule_override_applied BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Payout records
CREATE TABLE affiliate_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  amount_cents INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'paid', 'failed')),
  stripe_transfer_id TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Commission events
CREATE TABLE commission_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  referral_id UUID NOT NULL REFERENCES affiliate_referrals(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('signup', 'renewal', 'upgrade', 'downgrade', 'churn')),
  payment_number INT NOT NULL,
  plan_name TEXT,
  invoice_amount_cents INT NOT NULL,
  commission_amount_cents INT NOT NULL,
  stripe_invoice_id TEXT,
  payout_id UUID REFERENCES affiliate_payouts(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Campaign links
CREATE TABLE affiliate_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  total_clicks INT DEFAULT 0,
  total_signups INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Notification preferences
CREATE TABLE affiliate_notification_preferences (
  affiliate_id UUID PRIMARY KEY REFERENCES affiliates(id) ON DELETE CASCADE,
  new_referral BOOLEAN DEFAULT true,
  referral_converted BOOLEAN DEFAULT true,
  commission_earned BOOLEAN DEFAULT true,
  payout_processed BOOLEAN DEFAULT true
);

-- Terms & conditions
CREATE TABLE affiliate_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT NOT NULL,
  terms_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Agreement acceptances
CREATE TABLE affiliate_agreement_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  agreement_id UUID NOT NULL REFERENCES affiliate_agreements(id) ON DELETE CASCADE,
  accepted_at TIMESTAMPTZ DEFAULT now()
);

-- Click log for deduplication
CREATE TABLE affiliate_click_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES affiliate_campaigns(id),
  ip_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Payout settings (singleton)
CREATE TABLE payout_settings (
  id UUID PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001'::uuid
    CHECK (id = '00000000-0000-0000-0000-000000000001'::uuid),
  min_payout_cents INT DEFAULT 2500,
  payout_day_of_month INT DEFAULT 1 CHECK (payout_day_of_month BETWEEN 1 AND 28),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed the singleton payout settings row
INSERT INTO payout_settings (id) VALUES ('00000000-0000-0000-0000-000000000001');

-- Indexes
CREATE INDEX idx_affiliate_referrals_company_id ON affiliate_referrals(company_id);
CREATE INDEX idx_affiliate_referrals_affiliate_id ON affiliate_referrals(affiliate_id);
CREATE INDEX idx_commission_events_referral_id ON commission_events(referral_id);
CREATE INDEX idx_commission_events_affiliate_id ON commission_events(affiliate_id);
CREATE INDEX idx_commission_events_payout_id ON commission_events(payout_id);
CREATE INDEX idx_affiliate_campaigns_affiliate_id ON affiliate_campaigns(affiliate_id);
CREATE INDEX idx_affiliate_click_log_dedup ON affiliate_click_log(affiliate_id, ip_hash, created_at);
CREATE INDEX idx_commission_schedule_periods_schedule_id ON commission_schedule_periods(schedule_id);
```

- [ ] **Step 2: Commit migration**

```bash
git add supabase/migrations/063_affiliate_portal.sql
git commit -m "feat(affiliate): add database schema for affiliate portal"
```

### Task 1.2: Server Dependencies & Environment Config

**Files:**
- Modify: `server/package.json`
- Modify: `server/src/config/env.ts`

- [ ] **Step 1: Install server dependencies**

```bash
npm --prefix server install bcryptjs jsonwebtoken node-cron
npm --prefix server install -D @types/bcryptjs @types/jsonwebtoken @types/node-cron
```

- [ ] **Step 2: Add JWT_SECRET to env config**

In `server/src/config/env.ts`, add to the Zod schema:

```typescript
AFFILIATE_JWT_SECRET: z.string().default('change-me-in-production'),
AFFILIATE_JWT_REFRESH_SECRET: z.string().default('change-me-refresh-in-production'),
AFFILIATE_PORTAL_URL: z.string().default('http://localhost:5176'),
```

- [ ] **Step 3: Update CORS configuration**

In `server/src/index.ts`, find the CORS `allowedClientOrigins` array (around lines 42-71) and add the affiliate portal URL:

```typescript
const allowedClientOrigins = [
  env.CLIENT_URL,
  env.AFFILIATE_PORTAL_URL, // Add this line
  // ... existing origins
];
```

This is required because the affiliate portal runs on a different port (5176) in dev and a different subdomain in production.

- [ ] **Step 4: Commit**

```bash
git add server/package.json server/package-lock.json server/src/config/env.ts server/src/index.ts
git commit -m "feat(affiliate): add server dependencies, env config, and CORS for affiliate portal"
```

### Task 1.3: Affiliate Auth Middleware

**Files:**
- Create: `server/src/middleware/affiliateAuth.ts`

- [ ] **Step 1: Create the middleware**

```typescript
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

// Extend Express Request for affiliate context
declare global {
  namespace Express {
    interface Request {
      affiliateId?: string;
    }
  }
}

export async function requireAffiliateAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, env.AFFILIATE_JWT_SECRET) as { affiliateId: string };
    req.affiliateId = payload.affiliateId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/middleware/affiliateAuth.ts
git commit -m "feat(affiliate): add JWT auth middleware for affiliate portal"
```

---

## Chunk 2: Server — Affiliate Auth Routes

### Task 2.1: Auth Routes (Login, Signup, Logout, Refresh)

**Files:**
- Create: `server/src/routes/affiliateAuth.ts`

- [ ] **Step 1: Create the auth routes file**

Implement the following endpoints following the patterns in `server/src/routes/billing.ts` and `server/src/routes/team.ts`:

```typescript
// POST /login — Verify email/password, return JWT + refresh token
// POST /signup — Hash password with bcrypt, generate affiliate_code via nanoid(8),
//                insert into affiliates table, create notification_preferences row,
//                return JWT + refresh token
// POST /logout — Clear refresh_token in DB
// POST /refresh — Validate refresh token from body, issue new access token
// POST /forgot-password — Generate reset token, store in affiliates table with 1hr expiry,
//                         (email sending placeholder — log token for now)
// POST /reset-password — Validate token + expiry, hash new password, clear reset fields
```

Apply rate limiters per the spec:

```typescript
import rateLimit from 'express-rate-limit';

const authLimiter = rateLimit({ windowMs: 60_000, max: 10 }); // 10/min for login & signup
const forgotLimiter = rateLimit({ windowMs: 60_000, max: 3 });  // 3/min for forgot-password

router.post('/login', authLimiter, async (req, res, next) => { ... });
router.post('/signup', authLimiter, async (req, res, next) => { ... });
router.post('/forgot-password', forgotLimiter, async (req, res, next) => { ... });
```

Key implementation details:
- Use `bcryptjs` with 12 salt rounds for password hashing
- Access token: `jwt.sign({ affiliateId }, env.AFFILIATE_JWT_SECRET, { expiresIn: '15m' })`
- Refresh token: `jwt.sign({ affiliateId }, env.AFFILIATE_JWT_REFRESH_SECRET, { expiresIn: '7d' })`
- Generate affiliate_code using Node built-in crypto: `import crypto from 'crypto'; const code = crypto.randomBytes(6).toString('base64url').slice(0, 8);`
- All DB operations use `supabaseAdmin` from `../config/supabase.js`

- [ ] **Step 2: Register routes in server/src/index.ts**

Add to `server/src/index.ts`:

```typescript
import affiliateAuthRouter from './routes/affiliateAuth.js';
// Mount BEFORE the rate limiter block or within the /api group
app.use('/api/affiliate', affiliateAuthRouter);
```

- [ ] **Step 3: Test auth routes manually**

Start the dev server and test with curl:
```bash
# Signup
curl -X POST http://localhost:3001/api/affiliate/signup \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@example.com","password":"Test123!"}'

# Login
curl -X POST http://localhost:3001/api/affiliate/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123!"}'
```

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/affiliateAuth.ts server/src/index.ts
git commit -m "feat(affiliate): add auth routes (login, signup, logout, refresh, password reset)"
```

---

## Chunk 3: Server — Affiliate Portal API Routes

### Task 3.1: Profile & Settings Routes

**Files:**
- Create: `server/src/routes/affiliatePortal.ts`

- [ ] **Step 1: Create portal routes file**

All routes use `requireAffiliateAuth` middleware. Implement:

```typescript
// GET /me — Return affiliate profile (exclude password_hash, refresh_token, reset fields)
// PUT /profile — Update name, email, phone
// PUT /password — Verify current password, hash new password, update
// PUT /bank-account — (Stripe Connect onboarding — see Task 6.1)
// POST /delete-request — Set deletion_requested_at + deletion_reason on affiliate record
```

Pattern reference: Follow `server/src/routes/contacts.ts` for middleware chaining and response format.

- [ ] **Step 2: Add analytics routes to the same file**

```typescript
// GET /stats — Query aggregate stats:
//   totalReferrals: count from affiliate_referrals
//   activeCompanies: count where status='active'
//   totalCommission: sum commission_amount_cents from commission_events
//   thisMonthCommission: sum where created_at >= start of current month
//   conversionRate: activeCompanies / totalReferrals * 100

// GET /balance — Calculate:
//   totalEarnedCents: sum of all commission_events.commission_amount_cents
//   totalPaidOutCents: sum of affiliate_payouts where status='paid'
//   pendingPayoutCents: sum of affiliate_payouts where status IN ('pending','processing')
//   balanceOwedCents: totalEarned - totalPaidOut - pendingPayout

// GET /earnings-history — Group commission_events by month (last 12 months)
//   Return: [{ month: '2026-01', amountCents: 5000 }, ...]

// GET /funnel — Return aggregate campaign stats:
//   Total clicks, signups, trials, active, churned across all campaigns + default link
```

- [ ] **Step 3: Add data listing routes**

```typescript
// GET /referrals — List all affiliate_referrals for this affiliate, join with companies table
//   for company_name, join with subscriptions for plan info
//   Return: [{ id, company_name, status, plan_name, billing_cycle, commission_earned, created_at }]

// GET /commissions — List all commission_events for this affiliate
//   Return: [{ id, event_type, plan_name, invoice_amount_cents, commission_amount_cents,
//              stripe_invoice_id, created_at }]

// GET /payout-history — List all affiliate_payouts for this affiliate
//   Return: [{ id, period_start, period_end, amount_cents, status, stripe_transfer_id,
//              paid_at, created_at }]
```

- [ ] **Step 4: Add campaign routes**

```typescript
// GET /campaigns — List all affiliate_campaigns for this affiliate
//   Add computed fields: url and directUrl based on affiliate_code + slug

// POST /campaigns — Create new campaign
//   Validate: max 20 campaigns per affiliate
//   Generate slug from name (lowercase, hyphens, no special chars)
//   Return created campaign

// DELETE /campaigns/:id — Delete campaign (verify ownership)
```

- [ ] **Step 5: Add notification preference routes**

```typescript
// GET /notification-preferences — Return preferences row for this affiliate
// PUT /notification-preferences — Update preferences (new_referral, referral_converted,
//   commission_earned, payout_processed)
```

- [ ] **Step 6: Add agreement routes**

```typescript
// GET /agreement — Return the latest affiliate_agreements row + whether this affiliate
//   has accepted it (join with affiliate_agreement_acceptances)

// POST /agreement/accept — Insert into affiliate_agreement_acceptances
//   with the provided version/agreement_id
```

- [ ] **Step 7: Register portal routes in server/src/index.ts**

```typescript
import affiliatePortalRouter from './routes/affiliatePortal.js';
app.use('/api/affiliate', affiliatePortalRouter);
```

Note: Auth routes from Task 2.1 and portal routes need to coexist on `/api/affiliate`. The auth routes are public (no middleware), while portal routes use `requireAffiliateAuth`. Use separate router instances and mount them both, or combine into one router with selective middleware application.

- [ ] **Step 8: Commit**

```bash
git add server/src/routes/affiliatePortal.ts server/src/index.ts
git commit -m "feat(affiliate): add portal API routes (profile, stats, referrals, commissions, payouts, campaigns, notifications, agreements)"
```

### Task 3.2: Referral Tracking Routes

**Files:**
- Modify: `server/src/routes/affiliateAuth.ts` (or create `server/src/routes/affiliateTracking.ts`)

- [ ] **Step 1: Add tracking endpoints (public, no auth)**

```typescript
// POST /track-click — Record referral link click
//   Body: { affiliate_code, campaign_slug? }
//   1. Look up affiliate by code
//   2. If campaign_slug, look up campaign
//   3. Hash IP: crypto.createHash('sha256').update(req.ip).digest('hex')
//   4. Check affiliate_click_log for duplicate (same affiliate_id + ip_hash within 24h)
//   5. If not duplicate: insert click_log row, increment campaign.total_clicks
//   6. Return { success: true }

// POST /track-signup — Attribute company signup to affiliate
//   Body: { affiliate_code, campaign_slug?, company_id }
//   1. Look up affiliate by code (must be approved)
//   2. Check if company_id already has a referral (prevent double-attribution)
//   3. Insert affiliate_referrals row with the affiliate's current commission_schedule_id
//   4. If campaign_slug, increment campaign.total_signups
//   5. Return { success: true }
```

- [ ] **Step 2: Add rate limiting**

Apply `express-rate-limit` to tracking endpoints:
```typescript
import rateLimit from 'express-rate-limit';

const trackClickLimiter = rateLimit({ windowMs: 60_000, max: 30 });
const trackSignupLimiter = rateLimit({ windowMs: 60_000, max: 10 });

router.post('/track-click', trackClickLimiter, async (req, res, next) => { ... });
router.post('/track-signup', trackSignupLimiter, async (req, res, next) => { ... });
```

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/affiliateAuth.ts
git commit -m "feat(affiliate): add referral tracking endpoints (click + signup attribution)"
```

---

## Chunk 4: Server — Admin API Routes

### Task 4.1: Admin Routes for Affiliate Management

**Files:**
- Create: `server/src/routes/affiliateAdmin.ts`

- [ ] **Step 1: Create admin routes file**

All routes use `requireAuth` + `requireSuperAdmin` middleware (same pattern as `server/src/routes/superAdmin.ts`):

```typescript
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireSuperAdmin } from '../middleware/superAdmin.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(requireAuth);
router.use(requireSuperAdmin);

// GET /affiliates — List all affiliates with stats
//   Join with aggregate counts: referral_count, total_earned, pending_payout
//   Support ?status=pending_review filter for approval queue

// POST /affiliates — Invite new affiliate (admin-created)
//   Body: { name, email, phone?, commission_schedule_id?, approval_status? }
//   Generate temp password or send invite link
//   Default approval_status = 'approved' for admin invites

// GET /affiliates/:id — Get single affiliate detail with referrals, commissions, payouts

// PUT /affiliates/:id — Update affiliate (approve/reject, assign schedule, edit profile)
//   Body may include: { approval_status, commission_schedule_id, apply_to_existing_referrals }
//   If apply_to_existing_referrals: update all active affiliate_referrals with new schedule_id,
//     set schedule_override_applied = true

// DELETE /affiliates/:id — Soft delete or hard delete affiliate
//   Set approval_status = 'deleted' or cascade delete
```

- [ ] **Step 2: Add schedule management routes**

```typescript
// GET /schedules — List all commission_schedules with their periods

// POST /schedules — Create schedule + periods
//   Body: { name, commission_type, end_behavior, end_rate?, periods: [{ from_payment, to_payment, rate }] }
//   Insert schedule, then bulk insert periods

// PUT /schedules/:id — Update schedule + periods
//   Replace all periods (delete existing, insert new)

// DELETE /schedules/:id — Delete schedule
//   Check if any affiliates reference it first, warn if so
```

- [ ] **Step 3: Add payout management routes**

```typescript
// GET /payouts — List all payouts across affiliates
//   Join with affiliates for name/email
//   Support ?status=failed filter

// POST /payouts/run — Manually trigger payout run (calls the same function as cron)

// POST /payouts/:id/retry — Retry a failed payout

// GET /payout-settings — Return payout_settings singleton row
// PUT /payout-settings — Update min_payout_cents and/or payout_day_of_month
```

- [ ] **Step 4: Add agreement management routes**

```typescript
// GET /agreements — List all agreement versions with acceptance counts
// POST /agreements — Create new agreement version
//   Body: { version, terms_text }
```

- [ ] **Step 5: Register admin routes in server/src/index.ts**

```typescript
import affiliateAdminRouter from './routes/affiliateAdmin.js';
app.use('/api/affiliate/admin', affiliateAdminRouter);
```

Important: Mount admin routes BEFORE the general affiliate portal routes so `/api/affiliate/admin/*` matches first.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/affiliateAdmin.ts server/src/index.ts
git commit -m "feat(affiliate): add admin API routes (affiliates, schedules, payouts, agreements)"
```

---

## Chunk 5: Server — Commission Engine

### Task 5.1: Commission Calculation Service

**Files:**
- Create: `server/src/services/affiliateCommissionService.ts`

- [ ] **Step 1: Create commission service**

```typescript
import { supabaseAdmin } from '../config/supabase.js';

interface CommissionResult {
  shouldPay: boolean;
  amount_cents: number;
  rate: number;
  commission_type: 'percentage' | 'flat';
}

/**
 * Calculate commission for a specific referral at a given payment number.
 * Resolves the schedule, finds the matching period, applies end_behavior.
 */
export async function calculateCommission(
  referralId: string,
  invoiceAmountCents: number
): Promise<CommissionResult> {
  // 1. Fetch referral with its commission_schedule_id and payment_count
  // 2. If no schedule → fall back to affiliate's commission_type + commission_rate
  // 3. If schedule exists:
  //    a. Fetch periods ordered by from_payment
  //    b. Find period where from_payment <= payment_count <= to_payment
  //    c. If no match → apply end_behavior (stop/continue_last/custom_rate)
  // 4. Calculate: percentage → invoiceAmountCents * rate / 100, flat → rate directly
  // 5. Return { shouldPay, amount_cents, rate, commission_type }
}

/**
 * Detect event type by comparing current plan with referral's last_plan_name.
 */
export function detectEventType(
  paymentCount: number,
  currentPlanName: string | null,
  lastPlanName: string | null,
  plans: Array<{ name: string; stripe_price_id: string }> // for tier comparison
): 'signup' | 'renewal' | 'upgrade' | 'downgrade' {
  if (paymentCount === 1) return 'signup';
  if (!lastPlanName || !currentPlanName || lastPlanName === currentPlanName) return 'renewal';
  // Compare plan tiers by price or position in plans array
  // If current > last → 'upgrade', if current < last → 'downgrade'
  // Default to 'renewal' if ambiguous
}

/**
 * Process an invoice.paid event for affiliate commission.
 * Called from the Stripe webhook handler.
 */
export async function processInvoicePaidForAffiliate(
  companyId: string,
  invoiceAmountCents: number,
  planName: string | null,
  stripeInvoiceId: string
): Promise<void> {
  // 1. Look up affiliate_referrals where company_id matches and status IN ('pending','trialing','active')
  // 2. If no referral → return (not an affiliate referral)
  // 3. Increment payment_count
  // 4. Detect event type using last_plan_name
  // 5. Update last_plan_name to current plan
  // 6. Calculate commission
  // 7. If shouldPay: insert commission_events record
  // 8. If payment_count === 1: update referral status to 'active'
}

/**
 * Process a subscription.deleted event for affiliate tracking.
 */
export async function processSubscriptionDeletedForAffiliate(
  companyId: string
): Promise<void> {
  // 1. Look up affiliate_referrals where company_id matches
  // 2. If found: set status = 'churned'
  // 3. Insert commission_events with event_type='churn', commission_amount_cents=0
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/services/affiliateCommissionService.ts
git commit -m "feat(affiliate): add commission calculation service"
```

### Task 5.2: Integrate with Stripe Webhook Handler

**Files:**
- Modify: `server/src/routes/billing.ts` (lines ~1330-1360 for invoice.paid, ~1321-1328 for subscription.deleted)

- [ ] **Step 1: Add affiliate processing to invoice.paid handler**

In `server/src/routes/billing.ts`, inside the `case 'invoice.paid':` block (around line 1330), after the existing subscription update logic, add:

```typescript
import { processInvoicePaidForAffiliate } from '../services/affiliateCommissionService.js';

// Inside case 'invoice.paid', after existing logic:
// Affiliate commission processing
try {
  const planData = await supabaseAdmin
    .from('subscriptions')
    .select('plans(name)')
    .eq('stripe_customer_id', invoice.customer)
    .single();

  await processInvoicePaidForAffiliate(
    sub.company_id,
    invoice.amount_paid,
    planData?.data?.plans?.name ?? null,
    invoice.id
  );
} catch (err) {
  console.error('Affiliate commission processing error (non-fatal):', err);
  // Non-fatal: don't fail the webhook response
}
```

- [ ] **Step 2: Add affiliate processing to subscription.deleted handler**

In the `case 'customer.subscription.deleted':` block (around line 1321), after the existing status update:

```typescript
import { processSubscriptionDeletedForAffiliate } from '../services/affiliateCommissionService.js';

// Inside case 'customer.subscription.deleted', after existing logic:
try {
  await processSubscriptionDeletedForAffiliate(sub.company_id);
} catch (err) {
  console.error('Affiliate churn tracking error (non-fatal):', err);
}
```

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/billing.ts
git commit -m "feat(affiliate): integrate commission processing with Stripe webhook handlers"
```

---

## Chunk 6: Server — Payout System

### Task 6.1: Stripe Connect Onboarding

**Files:**
- Add to: `server/src/routes/affiliatePortal.ts`

- [ ] **Step 1: Add Stripe Connect onboarding endpoint**

```typescript
// POST /connect-onboarding — Create Stripe Express account + return onboarding URL
//   1. If affiliate already has stripe_connect_account_id, create new Account Link (re-onboard)
//   2. Otherwise: stripe.accounts.create({ type: 'express', ... })
//   3. Store account ID on affiliate record
//   4. Create Account Link: stripe.accountLinks.create({
//        account: accountId,
//        refresh_url: `${PORTAL_URL}/#/settings?connect=refresh`,
//        return_url: `${PORTAL_URL}/#/settings?connect=complete`,
//        type: 'account_onboarding',
//      })
//   5. Return { url: accountLink.url }

// GET /connect-status — Check if onboarding is complete
//   1. Fetch account from Stripe: stripe.accounts.retrieve(accountId)
//   2. Return { charges_enabled, payouts_enabled, details_submitted }
//   3. If charges_enabled && payouts_enabled: set bank_account_added = true
```

- [ ] **Step 2: Add Stripe Connect webhook handling**

**Important:** Stripe Connect events for connected accounts require either:
- The existing webhook endpoint to be configured in Stripe Dashboard to "Listen to events on Connected accounts", OR
- A separate Connect webhook endpoint with its own signing secret

Option A (simpler): In Stripe Dashboard → Webhooks → Edit the existing endpoint → Check "Listen to events on Connected accounts" → Add `account.updated` event. Then add a case in `billing.ts`:

```typescript
case 'account.updated': {
  const account = event.data.object as Stripe.Account;
  if (account.charges_enabled && account.payouts_enabled) {
    await supabaseAdmin
      .from('affiliates')
      .update({ bank_account_added: true })
      .eq('stripe_connect_account_id', account.id);
  }
  break;
}
```

Option B (fallback): If Connect webhook config isn't available, the `GET /connect-status` endpoint (polled by the portal after onboarding redirect) will set `bank_account_added = true` when it detects the account is fully onboarded. This provides a non-webhook path to the same outcome.

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/affiliatePortal.ts server/src/routes/billing.ts
git commit -m "feat(affiliate): add Stripe Connect Express onboarding for ACH payouts"
```

### Task 6.2: Payout Cron Job

**Files:**
- Create: `server/src/cron/affiliatePayouts.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Create payout cron job**

```typescript
import cron from 'node-cron';
import { supabaseAdmin } from '../config/supabase.js';
import Stripe from 'stripe';
import { env } from '../config/env.js';

const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;

export async function runPayouts(): Promise<{ processed: number; skipped: number; failed: number }> {
  // 1. Acquire advisory lock: SELECT pg_try_advisory_lock(12345)
  //    If false → another instance is running, return early

  // 2. Fetch payout_settings for min_payout_cents

  // 3. Calculate period: previous month (1st to last day)

  // 4. For each approved affiliate with bank_account_added = true:
  //    a. Sum commission_events where payout_id IS NULL and affiliate_id matches
  //    b. Skip if total < min_payout_cents
  //    c. Check for existing payout with same period_start/period_end (idempotency)
  //    d. Create affiliate_payouts record (status = 'pending')
  //    e. Update commission_events: SET payout_id = new_payout_id WHERE payout_id IS NULL
  //    f. Execute Stripe Transfer:
  //       stripe.transfers.create({
  //         amount: totalCents,
  //         currency: 'usd',
  //         destination: affiliate.stripe_connect_account_id,
  //       })
  //    g. Update payout: status = 'paid', stripe_transfer_id, paid_at
  //    h. On error: status = 'failed', log error

  // 5. Release advisory lock: SELECT pg_advisory_unlock(12345)

  // 6. Return summary
}

export function startPayoutScheduler(): void {
  // Run daily at midnight
  cron.schedule('0 0 * * *', async () => {
    // Check if today is the configured payout day
    const { data: settings } = await supabaseAdmin
      .from('payout_settings')
      .select('payout_day_of_month')
      .single();

    const today = new Date().getDate();
    if (settings && today === settings.payout_day_of_month) {
      console.log('Running scheduled affiliate payouts...');
      const result = await runPayouts();
      console.log('Payout run complete:', result);
    }
  });

  console.log('Affiliate payout scheduler started');
}
```

- [ ] **Step 2: Register cron in server/src/index.ts**

Add alongside existing scheduler starts (line ~127):

```typescript
import { startPayoutScheduler } from './cron/affiliatePayouts.js';
// After existing startScheduler() call:
startPayoutScheduler();
```

- [ ] **Step 3: Add manual trigger in admin routes**

In `server/src/routes/affiliateAdmin.ts`, the `POST /payouts/run` endpoint should call:

```typescript
import { runPayouts } from '../cron/affiliatePayouts.js';

router.post('/payouts/run', async (req, res, next) => {
  try {
    const result = await runPayouts();
    res.json(result);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 4: Commit**

```bash
git add server/src/cron/affiliatePayouts.ts server/src/index.ts server/src/routes/affiliateAdmin.ts
git commit -m "feat(affiliate): add payout cron job with Stripe Connect transfers"
```

---

## Chunk 7: Affiliate Portal Frontend — Setup & Auth

### Task 7.1: Scaffold the Portal Project

**Files:**
- Create: `affiliate-portal/package.json`
- Create: `affiliate-portal/tsconfig.json`
- Create: `affiliate-portal/vite.config.ts`
- Create: `affiliate-portal/tailwind.config.js`
- Create: `affiliate-portal/postcss.config.js`
- Create: `affiliate-portal/index.html`
- Create: `affiliate-portal/src/main.tsx`
- Create: `affiliate-portal/src/index.css`
- Create: `affiliate-portal/src/vite-env.d.ts`

- [ ] **Step 1: Create package.json**

Base on the example's `affiliate-portal-example/package.json` but update dependencies:
- React 18, react-router-dom 7, recharts, qrcode.react, lucide-react
- Tailwind CSS 3 (not v4 — the portal is standalone)
- Vite 5, TypeScript 5.6

- [ ] **Step 2: Create config files**

Copy and adapt from the example:
- `vite.config.ts` — change port to 5176, same React SWC plugin
- `tsconfig.json` — same as example
- `tailwind.config.js` — same theme structure, adapt colors to match reply-flow's palette
- `postcss.config.js` — tailwindcss + autoprefixer
- `index.html` — update title to "Reply Flow - Affiliate Portal"

- [ ] **Step 3: Create entry files**

- `src/main.tsx` — React root render
- `src/index.css` — CSS variables matching reply-flow's color palette (adapt from example's HSL variables)
- `src/vite-env.d.ts` — Vite env types

- [ ] **Step 4: Install dependencies**

```bash
npm --prefix affiliate-portal install
```

- [ ] **Step 5: Verify the app starts**

```bash
npm --prefix affiliate-portal run dev
```

- [ ] **Step 6: Commit**

```bash
git add affiliate-portal/
git commit -m "feat(affiliate): scaffold affiliate portal frontend project"
```

### Task 7.2: UI Component Library

**Files:**
- Create: `affiliate-portal/src/components/ui/Button.tsx`
- Create: `affiliate-portal/src/components/ui/Input.tsx`
- Create: `affiliate-portal/src/components/ui/Card.tsx`
- Create: `affiliate-portal/src/components/ui/Badge.tsx`
- Create: `affiliate-portal/src/components/ui/Table.tsx`
- Create: `affiliate-portal/src/components/ui/Skeleton.tsx`
- Create: `affiliate-portal/src/components/ui/EmptyState.tsx`
- Create: `affiliate-portal/src/lib/utils.ts`

- [ ] **Step 1: Copy and adapt UI components from the example**

Copy each UI component from `affiliate-portal-example/src/components/ui/` and `affiliate-portal-example/src/lib/utils.ts`. Adapt colors to match reply-flow's palette where needed.

These are standalone components (no Radix dependency) designed for the portal's simpler needs.

- [ ] **Step 2: Commit**

```bash
git add affiliate-portal/src/components/ui/ affiliate-portal/src/lib/
git commit -m "feat(affiliate): add UI component library for affiliate portal"
```

### Task 7.3: API Client

**Files:**
- Create: `affiliate-portal/src/api.ts`

- [ ] **Step 1: Adapt the API client from the example**

Copy `affiliate-portal-example/src/api.ts` and update:
- Change `VITE_API_URL` default to `http://localhost:3001`
- Update all endpoint paths to use `/api/affiliate/` prefix
- Add new endpoints: `connectOnboarding()`, `getConnectStatus()` for Stripe Connect
- Remove BookingPro-specific references
- Keep the token refresh deduplication logic (H12 pattern)
- Keep the memory-only access token pattern

- [ ] **Step 2: Commit**

```bash
git add affiliate-portal/src/api.ts
git commit -m "feat(affiliate): add API client with token refresh and deduplication"
```

### Task 7.4: Auth Hooks & Components

**Files:**
- Create: `affiliate-portal/src/hooks/useAuth.ts`
- Create: `affiliate-portal/src/components/auth/LoginForm.tsx`
- Create: `affiliate-portal/src/components/auth/SignupForm.tsx`
- Create: `affiliate-portal/src/components/auth/ForgotPasswordForm.tsx`
- Create: `affiliate-portal/src/components/auth/ResetPasswordForm.tsx`
- Create: `affiliate-portal/src/components/auth/PendingReviewScreen.tsx`
- Create: `affiliate-portal/src/components/auth/RejectedScreen.tsx`

- [ ] **Step 1: Copy and adapt useAuth hook from example**

Copy `affiliate-portal-example/src/hooks/useAuth.ts`. No significant changes needed — the auth flow is identical.

- [ ] **Step 2: Copy and adapt all auth components from example**

Copy all 6 auth components from `affiliate-portal-example/src/components/auth/`. Update:
- Brand name references: "BookingPro" → "Reply Flow"
- Any hardcoded URLs
- Remove inactivity logout logic (was in App.tsx, not auth components)

- [ ] **Step 3: Commit**

```bash
git add affiliate-portal/src/hooks/useAuth.ts affiliate-portal/src/components/auth/
git commit -m "feat(affiliate): add auth hooks and screens (login, signup, forgot, reset, pending, rejected)"
```

### Task 7.5: App Shell & Layout

**Files:**
- Create: `affiliate-portal/src/App.tsx`
- Create: `affiliate-portal/src/components/layout/Header.tsx`
- Create: `affiliate-portal/src/components/layout/TabNav.tsx`
- Create: `affiliate-portal/src/components/shared/StatusBadge.tsx`
- Create: `affiliate-portal/src/components/shared/EventTypeBadge.tsx`

- [ ] **Step 1: Adapt App.tsx from example**

Copy `affiliate-portal-example/src/App.tsx` and update:
- Remove the 30-minute inactivity logout logic (M14)
- Keep: HashRouter, auth guard, approval status checks, tab routing
- Update brand references

- [ ] **Step 2: Copy layout and shared components**

Copy Header.tsx, TabNav.tsx, StatusBadge.tsx, EventTypeBadge.tsx from the example. Update brand references.

- [ ] **Step 3: Verify the app renders with auth screens**

```bash
npm --prefix affiliate-portal run dev
```

Open http://localhost:5176 — should see the login form.

- [ ] **Step 4: Commit**

```bash
git add affiliate-portal/src/App.tsx affiliate-portal/src/components/layout/ affiliate-portal/src/components/shared/
git commit -m "feat(affiliate): add app shell with routing, header, tab navigation"
```

---

## Chunk 8: Affiliate Portal Frontend — Tabs

### Task 8.1: Data Hook

**Files:**
- Create: `affiliate-portal/src/hooks/usePortalData.ts`

- [ ] **Step 1: Adapt usePortalData from example**

Copy `affiliate-portal-example/src/hooks/usePortalData.ts`. Same pattern — loads all data in parallel with `Promise.all()`, only fetches if affiliate is approved.

- [ ] **Step 2: Commit**

```bash
git add affiliate-portal/src/hooks/usePortalData.ts
git commit -m "feat(affiliate): add portal data fetching hook"
```

### Task 8.2: Dashboard Tab

**Files:**
- Create: `affiliate-portal/src/tabs/DashboardTab.tsx`

- [ ] **Step 1: Adapt DashboardTab from example**

Copy `affiliate-portal-example/src/tabs/DashboardTab.tsx`. Keep:
- Balance card (Total Earned, Paid Out, Pending, Balance Owed)
- 4 stat cards (Total Referrals, Active Companies, This Month, Conversion Rate)
- Earnings bar chart (recharts)
- Conversion funnel visualization
- Affiliate link display with copy button

Update brand references and any URL patterns.

- [ ] **Step 2: Commit**

```bash
git add affiliate-portal/src/tabs/DashboardTab.tsx
git commit -m "feat(affiliate): add dashboard tab with stats, chart, and funnel"
```

### Task 8.3: Referrals, Commissions, Payouts Tabs

**Files:**
- Create: `affiliate-portal/src/tabs/ReferralsTab.tsx`
- Create: `affiliate-portal/src/tabs/CommissionsTab.tsx`
- Create: `affiliate-portal/src/tabs/PayoutsTab.tsx`

- [ ] **Step 1: Copy all three tabs from example**

These are straightforward table displays. Copy from the example, update brand references.

- [ ] **Step 2: Commit**

```bash
git add affiliate-portal/src/tabs/ReferralsTab.tsx affiliate-portal/src/tabs/CommissionsTab.tsx affiliate-portal/src/tabs/PayoutsTab.tsx
git commit -m "feat(affiliate): add referrals, commissions, and payouts tabs"
```

### Task 8.4: Marketing Tab

**Files:**
- Create: `affiliate-portal/src/tabs/MarketingTab.tsx`

- [ ] **Step 1: Adapt MarketingTab from example**

Copy `affiliate-portal-example/src/tabs/MarketingTab.tsx`. Keep all features:
- Default affiliate link with copy/QR/share
- Campaign creation form (max 20)
- Campaign cards with stats
- QR code modal with PNG download
- Social share dropdown (Twitter, LinkedIn, Facebook, WhatsApp)

Update URLs:
- Default link: `https://app.replyflow.com/auth?ref={affiliate_code}`
- Campaign link: `https://app.replyflow.com/auth?ref={affiliate_code}&campaign={slug}`

- [ ] **Step 2: Commit**

```bash
git add affiliate-portal/src/tabs/MarketingTab.tsx
git commit -m "feat(affiliate): add marketing tab with campaigns, QR codes, and social share"
```

### Task 8.5: Settings Tab

**Files:**
- Create: `affiliate-portal/src/tabs/SettingsTab.tsx`

- [ ] **Step 1: Adapt SettingsTab from example**

Copy `affiliate-portal-example/src/tabs/SettingsTab.tsx` and modify:

**Keep as-is:**
- Profile form (name, email, phone)
- Change password form
- Notification preferences (4 toggles)
- Program terms section
- Account deletion (danger zone)

**Replace bank details section** — instead of collecting bank account + routing number directly, add a Stripe Connect onboarding button:

```tsx
{/* Payout Setup Card */}
<Card title="Payout Setup">
  {affiliate.bank_account_added ? (
    <div className="flex items-center gap-2 text-success">
      <CheckCircle className="w-5 h-5" />
      <span>Bank account connected. Payouts will be sent via ACH.</span>
    </div>
  ) : (
    <div>
      <p className="text-sm text-muted-foreground mb-4">
        Connect your bank account to receive commission payouts via ACH direct deposit.
      </p>
      <Button onClick={handleConnectOnboarding} disabled={connectLoading}>
        {connectLoading ? 'Redirecting...' : 'Set Up Payouts'}
      </Button>
    </div>
  )}
</Card>
```

The `handleConnectOnboarding` function calls `api.connectOnboarding()` and redirects to the Stripe-hosted onboarding URL.

**Add commission schedule display:**

```tsx
{/* Commission Info Card */}
<Card title="Commission Schedule">
  {/* Show current schedule name, type, current period rate */}
  {/* Show how many payments until next tier change */}
</Card>
```

- [ ] **Step 2: Handle Stripe Connect return**

In Settings, check for `?connect=complete` or `?connect=refresh` query params:
- `complete` → call `getConnectStatus()` to verify, show success message
- `refresh` → show "Please try again" message with retry button

- [ ] **Step 3: Commit**

```bash
git add affiliate-portal/src/tabs/SettingsTab.tsx
git commit -m "feat(affiliate): add settings tab with Stripe Connect onboarding, profile, notifications, terms"
```

---

## Chunk 9: Super Admin UI (in reply-flow)

### Task 9.1: Affiliate Admin Components

**Files:**
- Create: `client/src/components/super-admin/affiliates/AffiliateListTab.tsx`
- Create: `client/src/components/super-admin/affiliates/AffiliateDetailView.tsx`
- Create: `client/src/components/super-admin/affiliates/InviteAffiliateDialog.tsx`
- Create: `client/src/components/super-admin/affiliates/AssignScheduleDialog.tsx`

- [ ] **Step 1: Create AffiliateListTab**

Table of all affiliates using reply-flow's shadcn Table component. Columns: Name, Email, Status (badge), Referrals, Total Earned, Schedule, Joined. Actions: Approve/Reject (for pending), Edit, View Detail.

Follow the pattern in `SuperAdminPage.tsx` OverviewTab (stat cards + data display).

- [ ] **Step 2: Create AffiliateDetailView**

Detailed view of a single affiliate showing their referrals, commission events, and payouts in sub-tables. Include an "Assign Schedule" button.

- [ ] **Step 3: Create InviteAffiliateDialog**

Dialog form using shadcn Dialog component. Fields: name, email, phone, schedule selection dropdown, auto-approve checkbox.

- [ ] **Step 4: Create AssignScheduleDialog**

Dialog with schedule dropdown and "Apply to existing referrals too?" checkbox.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/super-admin/affiliates/
git commit -m "feat(affiliate): add super admin affiliate management components"
```

### Task 9.2: Commission Schedule Components

**Files:**
- Create: `client/src/components/super-admin/commission-schedules/ScheduleListTab.tsx`
- Create: `client/src/components/super-admin/commission-schedules/ScheduleEditorDialog.tsx`
- Create: `client/src/components/super-admin/commission-schedules/SchedulePreview.tsx`

- [ ] **Step 1: Create ScheduleListTab**

Table of all schedules: Name, Type (percentage/flat), Periods, End Behavior. Actions: Edit, Delete.

- [ ] **Step 2: Create ScheduleEditorDialog**

Dialog form for creating/editing a schedule:
- Name input
- Commission type select (percentage/flat)
- Dynamic period rows: from_payment, to_payment, rate (add/remove rows)
- End behavior select (stop/continue_last/custom_rate)
- End rate input (shown only when end_behavior = custom_rate)

- [ ] **Step 3: Create SchedulePreview**

Visual display showing what an affiliate earns at each payment number. Simple table or step chart showing payment # → rate.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/super-admin/commission-schedules/
git commit -m "feat(affiliate): add commission schedule management components"
```

### Task 9.3: Payout & Agreement Components

**Files:**
- Create: `client/src/components/super-admin/affiliate-payouts/PayoutListTab.tsx`
- Create: `client/src/components/super-admin/affiliate-payouts/PayoutSettingsDialog.tsx`
- Create: `client/src/components/super-admin/affiliate-agreements/AgreementListTab.tsx`
- Create: `client/src/components/super-admin/affiliate-agreements/AgreementEditorDialog.tsx`

- [ ] **Step 1: Create PayoutListTab**

Table of all payouts: Affiliate, Period, Amount, Status (badge), Transfer ID, Paid At. Filter by status. "Run Payouts Now" button + "Retry" on failed rows. "Settings" button opens PayoutSettingsDialog.

- [ ] **Step 2: Create PayoutSettingsDialog**

Dialog with: minimum payout amount input, payout day of month select (1-28).

- [ ] **Step 3: Create AgreementListTab**

Table of all agreement versions: Version, Created At, Accepted By (count). "Create New Version" button.

- [ ] **Step 4: Create AgreementEditorDialog**

Dialog with: version input, terms text textarea.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/super-admin/affiliate-payouts/ client/src/components/super-admin/affiliate-agreements/
git commit -m "feat(affiliate): add payout and agreement management components"
```

### Task 9.4: Integrate into SuperAdminPage

**Files:**
- Modify: `client/src/pages/SuperAdminPage.tsx`

- [ ] **Step 1: Add new tabs to SuperAdminPage**

In `SuperAdminPage.tsx`, update the `TABS` constant (line 32):

```typescript
const TABS = ['overview', 'templates', 'preview', 'knowledge-bases', 'retrieval', 'debug',
              'affiliates', 'schedules', 'affiliate-payouts', 'agreements'] as const;
```

Add tab triggers and content panels for each new tab, rendering the components created in Tasks 9.1-9.3.

- [ ] **Step 2: Verify tabs render**

```bash
npm --prefix client run dev
```

Navigate to `/super-admin?tab=affiliates` and verify the new tabs appear and render.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/SuperAdminPage.tsx
git commit -m "feat(affiliate): integrate affiliate admin tabs into super admin page"
```

---

## Chunk 10: Referral Tracking Integration

### Task 10.1: Modify Auth Page for Referral Tracking

**Files:**
- Modify: `client/src/pages/AuthPage.tsx`

- [ ] **Step 1: Read and store referral params**

At the top of `AuthPage.tsx`, add logic to capture `ref` and `campaign` query params:

```typescript
// Near line 25, alongside existing URL param handling:
const [searchParams] = useSearchParams();

useEffect(() => {
  const ref = searchParams.get('ref');
  const campaign = searchParams.get('campaign');
  if (ref) {
    sessionStorage.setItem('affiliate_ref', ref);
    if (campaign) {
      sessionStorage.setItem('affiliate_campaign', campaign);
    }
    // Fire click tracking (fire-and-forget)
    fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/affiliate/track-click`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ affiliate_code: ref, campaign_slug: campaign || undefined }),
    }).catch(() => {}); // Silently fail
  }
}, [searchParams]);
```

- [ ] **Step 2: Attribute signup after company creation**

Find the signup success handler (around line 128-157). After the Supabase auth signup succeeds and the company is created (this happens in the onboarding flow), fire the attribution call.

Since company creation happens in the onboarding page (not AuthPage), the attribution should be triggered from the onboarding completion flow. Find where the company is created and add:

```typescript
// After successful company creation:
const affiliateRef = sessionStorage.getItem('affiliate_ref');
if (affiliateRef) {
  const affiliateCampaign = sessionStorage.getItem('affiliate_campaign');
  fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/affiliate/track-signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      affiliate_code: affiliateRef,
      campaign_slug: affiliateCampaign || undefined,
      company_id: newCompanyId,
    }),
  }).catch(() => {}); // Silently fail
  sessionStorage.removeItem('affiliate_ref');
  sessionStorage.removeItem('affiliate_campaign');
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/AuthPage.tsx client/src/pages/OnboardingPage.tsx
git commit -m "feat(affiliate): add referral tracking to signup flow (click + attribution)"
```

---

## Chunk 11: Build & Verify

### Task 11.1: Full Build Check

- [ ] **Step 1: Build server**

```bash
npm --prefix server run build
```

Fix any TypeScript errors.

- [ ] **Step 2: Build client**

```bash
npm --prefix client run build
```

Fix any TypeScript errors.

- [ ] **Step 3: Build affiliate portal**

```bash
npm --prefix affiliate-portal run build
```

Fix any TypeScript errors.

- [ ] **Step 4: Run the migration**

(Requires user confirmation — do NOT auto-run)

The migration file is at: `supabase/migrations/063_affiliate_portal.sql`

- [ ] **Step 5: Commit any build fixes**

```bash
git add -A
git commit -m "fix(affiliate): resolve build errors across all packages"
```

### Task 11.2: End-to-End Smoke Test

- [ ] **Step 1: Start all services**

```bash
# Terminal 1: Server
npm --prefix server run dev

# Terminal 2: Client
npm --prefix client run dev

# Terminal 3: Affiliate Portal
npm --prefix affiliate-portal run dev
```

- [ ] **Step 2: Test affiliate signup flow**

1. Open http://localhost:5176 (affiliate portal)
2. Sign up as a new affiliate
3. Verify "pending review" screen appears
4. Open http://localhost:5173/super-admin?tab=affiliates
5. Approve the affiliate
6. Refresh portal — verify tabs load

- [ ] **Step 3: Test referral tracking**

1. Open http://localhost:5173/auth?ref=TEST_CODE
2. Verify click is tracked (check `affiliate_click_log` table)
3. Complete signup + onboarding
4. Verify `affiliate_referrals` record is created

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(affiliate): complete affiliate portal implementation"
```
