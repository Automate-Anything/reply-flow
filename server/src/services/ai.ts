import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { buildSystemPrompt } from './promptBuilder.js';
import type { ProfileData, KBEntry } from './promptBuilder.js';
import * as whapi from './whapi.js';

const anthropic = env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  : null;

// ── Types ──────────────────────────────────────────

interface AIContext {
  systemPrompt: string;
  maxTokens: number;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

interface DaySchedule {
  enabled: boolean;
  open: string;  // "HH:MM"
  close: string; // "HH:MM"
}

interface BusinessHours {
  monday: DaySchedule;
  tuesday: DaySchedule;
  wednesday: DaySchedule;
  thursday: DaySchedule;
  friday: DaySchedule;
  saturday: DaySchedule;
  sunday: DaySchedule;
}

type ScheduleMode = 'always_on' | 'business_hours' | 'custom';

export type ShouldAIRespondResult =
  | { action: 'respond'; context: AIContext }
  | { action: 'outside_hours'; outsideHoursMessage: string; channelId: number }
  | { action: 'skip' };

// ── Schedule helper ────────────────────────────────

/**
 * Checks whether the current moment falls within the given schedule,
 * evaluated in the specified IANA timezone.
 */
function isWithinSchedule(schedule: BusinessHours, timezone: string): boolean {
  const now = new Date();

  // Get current day name in the target timezone
  const dayName = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
  }).format(now).toLowerCase() as keyof BusinessHours;

  const day = schedule[dayName];
  if (!day?.enabled) return false;

  // Get current hours and minutes in the target timezone
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const hour = parseInt(parts.find((p) => p.type === 'hour')!.value, 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')!.value, 10);
  const currentMinutes = hour * 60 + minute;

  const [openH, openM] = day.open.split(':').map(Number);
  const [closeH, closeM] = day.close.split(':').map(Number);

  return currentMinutes >= openH * 60 + openM && currentMinutes < closeH * 60 + closeM;
}

// ── Main AI decision function ──────────────────────

/**
 * Checks whether AI should respond to an incoming message for a given session.
 * Resolution path: session → ai_agents + channel_agent_settings
 */
export async function shouldAIRespond(
  companyId: string,
  sessionId: string
): Promise<ShouldAIRespondResult> {
  if (!anthropic) return { action: 'skip' };

  // 1. Get session + channel_id
  const { data: session } = await supabaseAdmin
    .from('chat_sessions')
    .select('channel_id, human_takeover, auto_resume_at')
    .eq('id', sessionId)
    .single();

  if (!session || !session.channel_id) return { action: 'skip' };

  // 2. Check per-channel AI settings
  const { data: channelSettings } = await supabaseAdmin
    .from('channel_agent_settings')
    .select('is_enabled, custom_instructions, profile_data, max_tokens, schedule_mode, ai_schedule, outside_hours_message, default_language, business_hours, agent_id')
    .eq('channel_id', session.channel_id)
    .single();

  if (!channelSettings?.is_enabled) return { action: 'skip' };

  // 4. Check per-conversation human_takeover
  if (session.human_takeover) {
    if (session.auto_resume_at && new Date(session.auto_resume_at) <= new Date()) {
      await supabaseAdmin
        .from('chat_sessions')
        .update({ human_takeover: false, auto_resume_at: null })
        .eq('id', sessionId);
    } else {
      return { action: 'skip' };
    }
  }

  // 5. Check AI schedule
  const scheduleMode = (channelSettings.schedule_mode || 'always_on') as ScheduleMode;

  if (scheduleMode !== 'always_on') {
    // Fetch company timezone (still company-level)
    const { data: company } = await supabaseAdmin
      .from('companies')
      .select('timezone')
      .eq('id', companyId)
      .single();
    const timezone = company?.timezone || 'UTC';

    let schedule: BusinessHours | null = null;

    if (scheduleMode === 'business_hours') {
      schedule = channelSettings.business_hours as BusinessHours | null;
    } else if (scheduleMode === 'custom') {
      schedule = channelSettings.ai_schedule as BusinessHours | null;
    }

    if (schedule) {
      if (!isWithinSchedule(schedule, timezone)) {
        const outsideMessage = (channelSettings.outside_hours_message as string | null)?.trim();
        if (outsideMessage) {
          return {
            action: 'outside_hours',
            outsideHoursMessage: outsideMessage,
            channelId: session.channel_id,
          };
        }
        return { action: 'skip' };
      }
    }
  }

  // 7. Fetch KB entries assigned to this channel (via channel_kb_assignments)
  const { data: assignedKB } = await supabaseAdmin
    .from('channel_kb_assignments')
    .select('entry_id')
    .eq('channel_id', session.channel_id);

  let kbData: KBEntry[] = [];

  if (assignedKB && assignedKB.length > 0) {
    const entryIds = assignedKB.map((a) => a.entry_id);
    const { data: kbEntries } = await supabaseAdmin
      .from('knowledge_base_entries')
      .select('title, content')
      .in('id', entryIds);
    kbData = (kbEntries || []) as KBEntry[];
  } else {
    const { data: kbEntries } = await supabaseAdmin
      .from('knowledge_base_entries')
      .select('title, content')
      .eq('company_id', companyId);
    kbData = (kbEntries || []) as KBEntry[];
  }

  // 8. Resolve profile_data — prefer agent's profile if assigned
  let profileData = (channelSettings.profile_data || {}) as ProfileData;

  if (channelSettings.agent_id) {
    const { data: agent } = await supabaseAdmin
      .from('ai_agents')
      .select('profile_data')
      .eq('id', channelSettings.agent_id)
      .single();
    if (agent) {
      profileData = (agent.profile_data || {}) as ProfileData;
    }
  }
  const channelOverrides = channelSettings.custom_instructions
    ? { custom_instructions: channelSettings.custom_instructions }
    : undefined;
  const systemPrompt = buildSystemPrompt(profileData, kbData, channelOverrides);

  const maxTokens = channelSettings.max_tokens || 500;

  // 9. Build message context from last 20 messages
  const { data: recentMessages } = await supabaseAdmin
    .from('chat_messages')
    .select('message_body, direction, sender_type')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (!recentMessages) return { action: 'skip' };

  const messages = recentMessages.reverse().map((msg) => ({
    role: (msg.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: msg.message_body || '',
  }));

  return {
    action: 'respond',
    context: { systemPrompt, maxTokens, messages },
  };
}

// ── AI reply generation ────────────────────────────

/**
 * Generates an AI response and sends it via WhatsApp.
 */
export async function generateAndSendAIReply(
  companyId: string,
  sessionId: string,
  context: AIContext
): Promise<void> {
  if (!anthropic) return;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: context.maxTokens,
    system: context.systemPrompt,
    messages: context.messages,
  });

  const aiReply = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  if (!aiReply.trim()) return;

  await sendAndStoreMessage(companyId, sessionId, aiReply);
}

/**
 * Sends a pre-configured outside-hours message via WhatsApp.
 */
export async function sendOutsideHoursReply(
  companyId: string,
  sessionId: string,
  channelId: number,
  message: string
): Promise<void> {
  const { data: session } = await supabaseAdmin
    .from('chat_sessions')
    .select('chat_id, phone_number')
    .eq('id', sessionId)
    .single();

  if (!session) return;

  const { data: ch } = await supabaseAdmin
    .from('whatsapp_channels')
    .select('channel_token')
    .eq('id', channelId)
    .eq('channel_status', 'connected')
    .single();

  if (!ch) return;

  const chatId = session.chat_id.includes('@')
    ? session.chat_id
    : `${session.chat_id}@s.whatsapp.net`;

  const result = await whapi.sendTextMessage(ch.channel_token, chatId, message);

  const now = new Date().toISOString();
  await supabaseAdmin.from('chat_messages').insert({
    session_id: sessionId,
    company_id: companyId,
    chat_id_normalized: session.chat_id,
    phone_number: session.phone_number,
    message_body: message,
    message_type: 'text',
    message_id_normalized: (result as Record<string, string>)?.message_id || null,
    direction: 'outbound',
    sender_type: 'ai',
    status: 'sent',
    read: true,
    message_ts: now,
  });

  await supabaseAdmin
    .from('chat_sessions')
    .update({
      last_message: message,
      last_message_at: now,
      last_message_direction: 'outbound',
      last_message_sender: 'ai',
      updated_at: now,
    })
    .eq('id', sessionId);
}

// ── Shared helper ──────────────────────────────────

async function sendAndStoreMessage(
  companyId: string,
  sessionId: string,
  message: string
): Promise<void> {
  const { data: session } = await supabaseAdmin
    .from('chat_sessions')
    .select('chat_id, phone_number, channel_id')
    .eq('id', sessionId)
    .single();

  if (!session || !session.channel_id) return;

  const { data: ch } = await supabaseAdmin
    .from('whatsapp_channels')
    .select('channel_token')
    .eq('id', session.channel_id)
    .eq('channel_status', 'connected')
    .single();

  if (!ch) return;

  const chatId = session.chat_id.includes('@')
    ? session.chat_id
    : `${session.chat_id}@s.whatsapp.net`;

  const result = await whapi.sendTextMessage(ch.channel_token, chatId, message);

  const now = new Date().toISOString();
  await supabaseAdmin.from('chat_messages').insert({
    session_id: sessionId,
    company_id: companyId,
    chat_id_normalized: session.chat_id,
    phone_number: session.phone_number,
    message_body: message,
    message_type: 'text',
    message_id_normalized: (result as Record<string, string>)?.message_id || null,
    direction: 'outbound',
    sender_type: 'ai',
    status: 'sent',
    read: true,
    message_ts: now,
  });

  await supabaseAdmin
    .from('chat_sessions')
    .update({
      last_message: message,
      last_message_at: now,
      last_message_direction: 'outbound',
      last_message_sender: 'ai',
      updated_at: now,
    })
    .eq('id', sessionId);
}
