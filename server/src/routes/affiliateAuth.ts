import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { requireAffiliateAuth } from '../middleware/affiliateAuth.js';

const router = Router();

// ── Rate limiters ──────────────────────────────────────────────
const authLimiter = rateLimit({ windowMs: 60_000, max: 10 });
const forgotLimiter = rateLimit({ windowMs: 60_000, max: 3 });

const BCRYPT_ROUNDS = 12;

// ── Helpers ────────────────────────────────────────────────────

function signAccessToken(affiliateId: string): string {
  return jwt.sign({ affiliateId }, env.AFFILIATE_JWT_SECRET, { expiresIn: '15m' });
}

function signRefreshToken(affiliateId: string): string {
  return jwt.sign({ affiliateId, type: 'refresh' }, env.AFFILIATE_JWT_REFRESH_SECRET, { expiresIn: '7d' });
}

// ── POST /login ────────────────────────────────────────────────
router.post('/login', authLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const { data: affiliate, error } = await supabaseAdmin
      .from('affiliates')
      .select('id, password_hash, approval_status')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (error) {
      console.error('Login DB error:', error.message);
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    if (!affiliate || !affiliate.password_hash) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const valid = await bcrypt.compare(password, affiliate.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const accessToken = signAccessToken(affiliate.id);
    const refreshToken = signRefreshToken(affiliate.id);

    // Store refresh token in DB
    await supabaseAdmin
      .from('affiliates')
      .update({ refresh_token: refreshToken })
      .eq('id', affiliate.id);

    res.json({ accessToken, refreshToken, approvalStatus: affiliate.approval_status });
  } catch (err) {
    console.error('Login error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /signup ───────────────────────────────────────────────
router.post('/signup', authLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password, name, phone } = req.body;
    if (!email || !password || !name) {
      res.status(400).json({ error: 'Email, password, and name are required' });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    // Check for existing affiliate
    const { data: existing } = await supabaseAdmin
      .from('affiliates')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const affiliateCode = crypto.randomBytes(6).toString('base64url').slice(0, 8);

    const { data: affiliate, error } = await supabaseAdmin
      .from('affiliates')
      .insert({
        email: email.toLowerCase().trim(),
        password_hash: passwordHash,
        name,
        phone: phone || null,
        affiliate_code: affiliateCode,
        approval_status: 'pending_review',
      })
      .select('id')
      .single();

    if (error) {
      console.error('Signup DB error:', error.message);
      if (error.code === '23505') {
        res.status(409).json({ error: 'An account with this email already exists' });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    // Create default notification preferences
    await supabaseAdmin
      .from('affiliate_notification_preferences')
      .insert({ affiliate_id: affiliate.id });

    const accessToken = signAccessToken(affiliate.id);
    const refreshToken = signRefreshToken(affiliate.id);

    // Store refresh token
    await supabaseAdmin
      .from('affiliates')
      .update({ refresh_token: refreshToken })
      .eq('id', affiliate.id);

    res.status(201).json({ accessToken, refreshToken, affiliateCode });
  } catch (err) {
    console.error('Signup error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /logout ───────────────────────────────────────────────
router.post('/logout', requireAffiliateAuth, async (req: Request, res: Response) => {
  try {
    const affiliateId = req.affiliateId;
    if (!affiliateId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    await supabaseAdmin
      .from('affiliates')
      .update({ refresh_token: null })
      .eq('id', affiliateId);

    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    console.error('Logout error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /refresh ──────────────────────────────────────────────
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(400).json({ error: 'Refresh token is required' });
      return;
    }

    let decoded: { affiliateId: string; type: string };
    try {
      const payload = jwt.verify(refreshToken, env.AFFILIATE_JWT_REFRESH_SECRET);
      if (typeof payload !== 'object' || payload === null || (payload as any).type !== 'refresh') {
        res.status(401).json({ error: 'Invalid refresh token' });
        return;
      }
      decoded = payload as { affiliateId: string; type: string };
    } catch {
      res.status(401).json({ error: 'Invalid or expired refresh token' });
      return;
    }

    // Verify token matches what's stored in DB
    const { data: affiliate } = await supabaseAdmin
      .from('affiliates')
      .select('id, refresh_token')
      .eq('id', decoded.affiliateId)
      .maybeSingle();

    if (!affiliate || affiliate.refresh_token !== refreshToken) {
      res.status(401).json({ error: 'Refresh token has been revoked' });
      return;
    }

    const accessToken = signAccessToken(affiliate.id);
    res.json({ accessToken });
  } catch (err) {
    console.error('Refresh error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /forgot-password ──────────────────────────────────────
router.post('/forgot-password', forgotLimiter, async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    const { data: affiliate } = await supabaseAdmin
      .from('affiliates')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    // Always return success to avoid email enumeration
    if (!affiliate) {
      res.json({ message: 'If that email exists, a reset link has been sent' });
      return;
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    await supabaseAdmin
      .from('affiliates')
      .update({
        password_reset_token: resetToken,
        password_reset_expires_at: expiresAt,
      })
      .eq('id', affiliate.id);

    // Log the token for now — email integration later
    console.log('[Affiliate Password Reset] Token generated for', email);

    res.json({ message: 'If that email exists, a reset link has been sent' });
  } catch (err) {
    console.error('Forgot-password error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /reset-password ───────────────────────────────────────
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      res.status(400).json({ error: 'Token and password are required' });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    const { data: affiliate } = await supabaseAdmin
      .from('affiliates')
      .select('id, password_reset_token, password_reset_expires_at')
      .eq('password_reset_token', token)
      .maybeSingle();

    if (!affiliate) {
      res.status(400).json({ error: 'Invalid or expired reset token' });
      return;
    }

    if (!affiliate.password_reset_expires_at || new Date(affiliate.password_reset_expires_at) < new Date()) {
      res.status(400).json({ error: 'Invalid or expired reset token' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    await supabaseAdmin
      .from('affiliates')
      .update({
        password_hash: passwordHash,
        password_reset_token: null,
        password_reset_expires_at: null,
        refresh_token: null, // Invalidate existing sessions
      })
      .eq('id', affiliate.id);

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error('Reset-password error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Rate limiters for tracking ───────────────────────────────────
const trackClickLimiter = rateLimit({ windowMs: 60_000, max: 30 });
const trackSignupLimiter = rateLimit({ windowMs: 60_000, max: 10 });

// ── POST /track-click ─────────────────────────────────────────────
router.post('/track-click', trackClickLimiter, async (req: Request, res: Response) => {
  try {
    const { affiliate_code, campaign_slug } = req.body;
    if (!affiliate_code) {
      res.status(400).json({ error: 'affiliate_code is required' });
      return;
    }

    // Look up affiliate (must be approved)
    const { data: affiliate } = await supabaseAdmin
      .from('affiliates')
      .select('id')
      .eq('affiliate_code', affiliate_code)
      .eq('approval_status', 'approved')
      .maybeSingle();

    if (!affiliate) {
      // Silently succeed to avoid leaking info
      res.json({ success: true });
      return;
    }

    // Look up campaign if slug provided
    let campaignId: string | null = null;
    if (campaign_slug) {
      const { data: campaign } = await supabaseAdmin
        .from('affiliate_campaigns')
        .select('id')
        .eq('slug', campaign_slug)
        .eq('affiliate_id', affiliate.id)
        .maybeSingle();
      campaignId = campaign?.id || null;
    }

    // Hash IP for deduplication
    const ipHash = crypto.createHash('sha256').update(req.ip || '').digest('hex');

    // Check for duplicate click (same affiliate + IP within 24h)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: existing } = await supabaseAdmin
      .from('affiliate_click_log')
      .select('id')
      .eq('affiliate_id', affiliate.id)
      .eq('ip_hash', ipHash)
      .gte('created_at', twentyFourHoursAgo)
      .limit(1)
      .maybeSingle();

    if (!existing) {
      // Insert click log
      await supabaseAdmin
        .from('affiliate_click_log')
        .insert({
          affiliate_id: affiliate.id,
          campaign_id: campaignId,
          ip_hash: ipHash,
        });

      // Increment campaign total_clicks if campaign found
      // NOTE: This uses a read-then-write pattern which has a known race condition:
      // if two requests increment simultaneously, one increment may be lost.
      // This is acceptable for analytics counters (best-effort counts), not for
      // financial/payment data. Campaign click counts are denormalized and inherently approximate.
      if (campaignId) {
        const { data: campaign } = await supabaseAdmin
          .from('affiliate_campaigns')
          .select('total_clicks')
          .eq('id', campaignId)
          .single();

        if (campaign) {
          await supabaseAdmin
            .from('affiliate_campaigns')
            .update({ total_clicks: (campaign.total_clicks || 0) + 1 })
            .eq('id', campaignId);
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Track click error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /track-signup ────────────────────────────────────────────
router.post('/track-signup', trackSignupLimiter, async (req: Request, res: Response) => {
  try {
    const { affiliate_code, campaign_slug, company_id } = req.body;
    if (!affiliate_code || !company_id) {
      res.status(400).json({ error: 'affiliate_code and company_id are required' });
      return;
    }

    // Look up affiliate (must be approved)
    const { data: affiliate } = await supabaseAdmin
      .from('affiliates')
      .select('id, commission_schedule_id')
      .eq('affiliate_code', affiliate_code)
      .eq('approval_status', 'approved')
      .maybeSingle();

    if (!affiliate) {
      res.json({ success: true });
      return;
    }

    // Check if company already has a referral (prevent double-attribution)
    const { data: existingReferral } = await supabaseAdmin
      .from('affiliate_referrals')
      .select('id')
      .eq('company_id', company_id)
      .limit(1)
      .maybeSingle();

    if (existingReferral) {
      // Already attributed — silently succeed
      res.json({ success: true });
      return;
    }

    // Insert referral
    await supabaseAdmin
      .from('affiliate_referrals')
      .insert({
        affiliate_id: affiliate.id,
        company_id,
        commission_schedule_id: affiliate.commission_schedule_id || null,
      });

    // Increment campaign total_signups if campaign slug provided
    // NOTE: This uses a read-then-write pattern which has a known race condition:
    // if two requests increment simultaneously, one increment may be lost.
    // This is acceptable for analytics counters (best-effort counts), not for
    // financial/payment data. Campaign signup counts are denormalized and inherently approximate.
    if (campaign_slug) {
      const { data: campaign } = await supabaseAdmin
        .from('affiliate_campaigns')
        .select('id, total_signups')
        .eq('slug', campaign_slug)
        .eq('affiliate_id', affiliate.id)
        .maybeSingle();

      if (campaign) {
        await supabaseAdmin
          .from('affiliate_campaigns')
          .update({ total_signups: (campaign.total_signups || 0) + 1 })
          .eq('id', campaign.id);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Track signup error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
