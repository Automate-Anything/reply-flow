import crypto from 'crypto';
import { supabaseAdmin } from '../config/supabase.js';

// --- Rate Limiting (in-memory, single-process) ---

const RATE_LIMIT = 60; // messages per channel per hour
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

export function checkRateLimit(
  channelId: number | string,
  _companyId: string,
  overrideLimit?: number
): { allowed: boolean; remaining: number; limit: number; resetsAt: Date } {
  const key = String(channelId);
  const now = Date.now();
  const limit = overrideLimit ?? RATE_LIMIT;

  let entry = rateLimitMap.get(key);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    rateLimitMap.set(key, entry);
  }

  const remaining = Math.max(0, limit - entry.count);
  const resetsAt = new Date(entry.windowStart + RATE_WINDOW_MS);

  return { allowed: remaining > 0, remaining, limit, resetsAt };
}

export function incrementRateCounter(channelId: number | string, _companyId?: string): void {
  const key = String(channelId);
  const entry = rateLimitMap.get(key);
  if (entry) {
    entry.count++;
  }
}

// --- 24-Hour Window ---

export async function check24HourWindow(
  sessionId: string
): Promise<{ allowed: boolean; lastInboundAt: Date | null; expiresAt: Date | null }> {
  const { data } = await supabaseAdmin
    .from('chat_messages')
    .select('message_ts')
    .eq('session_id', sessionId)
    .eq('direction', 'inbound')
    .order('message_ts', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.message_ts) {
    return { allowed: false, lastInboundAt: null, expiresAt: null };
  }

  const lastInboundAt = new Date(data.message_ts);
  const expiresAt = new Date(lastInboundAt.getTime() + 24 * 60 * 60 * 1000);
  const allowed = Date.now() < expiresAt.getTime();

  return { allowed, lastInboundAt, expiresAt };
}

// --- Content Safety ---

const FINANCIAL_KEYWORDS = [
  'bank', 'transfer', 'payment', 'crypto', 'bitcoin',
  'wire', 'account number', 'routing number', 'iban', 'invest',
];

const URL_REGEX = /https?:\/\/[^\s]+/i;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_REGEX = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;

export async function checkContentSafety(
  messageBody: string,
  sessionId?: string
): Promise<{ warnings: string[] }> {
  const warnings: string[] = [];
  const lower = messageBody.toLowerCase();

  // Check financial keywords
  for (const keyword of FINANCIAL_KEYWORDS) {
    if (lower.includes(keyword)) {
      warnings.push(`Message contains financial keyword: "${keyword}"`);
      break;
    }
  }

  // Check for links in first message to contact
  if (sessionId && URL_REGEX.test(messageBody)) {
    const { count } = await supabaseAdmin
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .eq('direction', 'outbound');

    if (count === 0) {
      warnings.push('Sending a link in your first message may trigger spam detection');
    }
  }

  // Check for phone/email in body
  if (EMAIL_REGEX.test(messageBody)) {
    warnings.push('Message contains an email address');
  }
  if (PHONE_REGEX.test(messageBody)) {
    warnings.push('Message contains a phone number');
  }

  return { warnings };
}

// --- Duplicate Content Detection ---

export function hashMessageBody(body: string): string {
  return crypto.createHash('sha256').update(body.trim().toLowerCase()).digest('hex');
}

export async function checkDuplicateContent(
  channelId: number | string,
  messageBody: string,
  windowMinutes = 60
): Promise<{ isDuplicate: boolean; matchCount: number }> {
  const hash = hashMessageBody(messageBody);
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

  // Use PostgREST JSON path filter: event_data->>'hash' = hash
  const { count } = await supabaseAdmin
    .from('compliance_metrics')
    .select('id', { count: 'exact', head: true })
    .eq('event_type', 'message_sent')
    .eq('channel_id', channelId)
    .gte('created_at', windowStart)
    .filter('event_data->>hash', 'eq', hash);

  const matchCount = count ?? 0;
  return { isDuplicate: matchCount >= 10, matchCount };
}

// --- Metric Logging ---

export function logComplianceMetric(
  channelId: number | string,
  companyId: string,
  event: { type: string; path?: string; hash?: string; [key: string]: unknown }
): void {
  void supabaseAdmin
    .from('compliance_metrics')
    .insert({
      company_id: companyId,
      channel_id: channelId,
      event_type: event.type,
      event_data: event,
    })
    .then(({ error }) => {
      if (error) console.error('Failed to log compliance metric:', error);
    });
}
