import { supabaseAdmin } from '../config/supabase.js';
import { isWithinSchedule, type BusinessHours } from './ai.js';

interface AutoReplyResult {
  shouldReply: boolean;
  message?: string;
  channelId?: number;
}

/**
 * Evaluates whether an auto-reply should fire for a new inbound message.
 * Auto-reply is a feature for channels where AI is OFF — it sends a one-time
 * message on the first message of a new conversation based on trigger conditions:
 *   - 'outside_hours': fires when current time is outside company business hours
 *   - 'all_unavailable': fires when all team members with channel access are unavailable
 *
 * Availability override logic: if a member has set personal availability
 * (availability_overrides_hours = true), their availability status is used
 * instead of the business hours schedule.
 */
export async function evaluateAutoReply(
  companyId: string,
  channelId: number,
  isNewSession: boolean,
): Promise<AutoReplyResult> {
  // Only fire on the first message of a new session
  if (!isNewSession) {
    return { shouldReply: false };
  }

  // Fetch channel auto-reply settings
  const { data: channelSettings } = await supabaseAdmin
    .from('channel_agent_settings')
    .select('is_enabled, auto_reply_enabled, auto_reply_message, auto_reply_trigger')
    .eq('channel_id', channelId)
    .single();

  // Auto-reply only applies when AI is OFF for the channel
  if (!channelSettings || channelSettings.is_enabled) {
    return { shouldReply: false };
  }

  if (!channelSettings.auto_reply_enabled || !channelSettings.auto_reply_message?.trim()) {
    return { shouldReply: false };
  }

  const trigger = channelSettings.auto_reply_trigger || 'outside_hours';

  if (trigger === 'outside_hours') {
    return evaluateOutsideHoursTrigger(companyId, channelId, channelSettings.auto_reply_message);
  } else if (trigger === 'all_unavailable') {
    return evaluateAllUnavailableTrigger(companyId, channelId, channelSettings.auto_reply_message);
  }

  return { shouldReply: false };
}

/**
 * Fires auto-reply when current time is outside company business hours.
 * If any team member has availability_overrides_hours = true and is_available = true,
 * we treat the company as "available" regardless of the business hours schedule.
 */
async function evaluateOutsideHoursTrigger(
  companyId: string,
  channelId: number,
  message: string,
): Promise<AutoReplyResult> {
  // Fetch company timezone and business hours
  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('timezone, business_hours')
    .eq('id', companyId)
    .single();

  const timezone = company?.timezone || 'UTC';
  const businessHours = company?.business_hours as BusinessHours | null;

  // Check if any member has overridden hours with personal availability
  const { data: overrideMembers } = await supabaseAdmin
    .from('company_members')
    .select('is_available')
    .eq('company_id', companyId)
    .eq('availability_overrides_hours', true);

  if (overrideMembers && overrideMembers.length > 0) {
    // If any member with override is available, don't fire auto-reply
    const anyAvailable = overrideMembers.some((m) => m.is_available);
    if (anyAvailable) {
      return { shouldReply: false };
    }
    // All override members are unavailable — fire auto-reply
    return { shouldReply: true, message, channelId };
  }

  // No override members — fall back to business hours schedule
  if (!businessHours) {
    // No business hours configured — treat as always available
    return { shouldReply: false };
  }

  const withinHours = isWithinSchedule(businessHours, timezone);
  if (withinHours) {
    return { shouldReply: false };
  }

  return { shouldReply: true, message, channelId };
}

/**
 * Fires auto-reply when ALL team members with access to this channel are unavailable.
 */
async function evaluateAllUnavailableTrigger(
  companyId: string,
  channelId: number,
  message: string,
): Promise<AutoReplyResult> {
  // Get all company members' availability
  const { data: members } = await supabaseAdmin
    .from('company_members')
    .select('user_id, is_available')
    .eq('company_id', companyId);

  if (!members || members.length === 0) {
    // No members — fire auto-reply
    return { shouldReply: true, message, channelId };
  }

  // Check if any member is available
  const anyAvailable = members.some((m) => m.is_available);
  if (anyAvailable) {
    return { shouldReply: false };
  }

  return { shouldReply: true, message, channelId };
}
