import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { buildSystemPrompt, buildClassificationPrompt, buildScenarioResponsePrompt } from './promptBuilder.js';
import type { ProfileData, KBEntry, ChannelOverrides } from './promptBuilder.js';
import { isEmbeddingsAvailable, searchKnowledgeBase } from './embeddings.js';
import { classifyQuery } from './queryClassifier.js';
import { getContactContext } from './sessionMemory.js';
import type { ContactMemory } from './sessionMemory.js';
import * as whapi from './whapi.js';

const anthropic = env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  : null;

const CLASSIFICATION_MODEL = 'claude-haiku-4-5-20251001';
const RESPONSE_MODEL = 'claude-sonnet-4-20250514';

// ── Types ──────────────────────────────────────────

interface AIContext {
  profileData: ProfileData;
  kbEntries: KBEntry[];
  channelOverrides?: ChannelOverrides;
  maxTokens: number;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  contactMemories: ContactMemory[];
}

export interface ClassificationResult {
  scenario_label: string | null;
  confidence: 'high' | 'medium' | 'low';
}

interface DaySchedule {
  enabled: boolean;
  open: string;  // "HH:MM"
  close: string; // "HH:MM"
  slots?: Array<{ open: string; close: string }>;
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

  // Check against all time slots (backwards compatible with single open/close)
  const slots = day.slots && day.slots.length > 0
    ? day.slots
    : [{ open: day.open, close: day.close }];

  for (const slot of slots) {
    const [openH, openM] = slot.open.split(':').map(Number);
    const [closeH, closeM] = slot.close.split(':').map(Number);
    if (currentMinutes >= openH * 60 + openM && currentMinutes < closeH * 60 + closeM) return true;
  }

  return false;
}

// ── Query reformulation for RAG ──────────────────────

/**
 * Reformulates a multi-turn conversation query into a standalone search query.
 * For short conversations, returns the last user message as-is.
 * For longer conversations, uses Claude to resolve pronouns and add context.
 */
async function reformulateQuery(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<string> {
  const lastUserMessage = messages[messages.length - 1]?.content || '';

  // Short conversations are likely self-contained
  if (!anthropic || messages.length <= 3) {
    return lastUserMessage;
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 150,
      system: 'You are a search query reformulator. Given a conversation, rewrite the last user message as a standalone search query that captures the full intent. Return ONLY the reformulated query, nothing else.',
      messages: [
        {
          role: 'user',
          content: `Conversation:\n${messages.slice(-6).map((m) => `${m.role}: ${m.content}`).join('\n')}\n\nReformulate the last user message into a standalone search query:`,
        },
      ],
    });

    const reformulated = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    return reformulated || lastUserMessage;
  } catch {
    return lastUserMessage;
  }
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
    .select('channel_id, human_takeover, auto_resume_at, contact_id')
    .eq('id', sessionId)
    .single();

  if (!session || !session.channel_id) return { action: 'skip' };

  // 2. Check per-channel AI settings
  const { data: channelSettings } = await supabaseAdmin
    .from('channel_agent_settings')
    .select('is_enabled, custom_instructions, profile_data, max_tokens, schedule_mode, ai_schedule, outside_hours_message, default_language, agent_id')
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
    // Fetch company timezone and business hours (both company-level)
    const { data: company } = await supabaseAdmin
      .from('companies')
      .select('timezone, business_hours')
      .eq('id', companyId)
      .single();
    const timezone = company?.timezone || 'UTC';

    let schedule: BusinessHours | null = null;

    if (scheduleMode === 'business_hours') {
      schedule = company?.business_hours as BusinessHours | null;
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

  // 7. Build message context from last 20 messages (needed for query reformulation)
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

  // 8. Semantic search for relevant KB content (or fall back to loading all)
  let kbData: KBEntry[] = [];
  let searchQuery = messages[messages.length - 1]?.content || '';

  if (isEmbeddingsAvailable()) {
    searchQuery = await reformulateQuery(messages);
    const qc = classifyQuery(searchQuery);
    const searchResults = await searchKnowledgeBase(companyId, searchQuery, {
      retrievalMethod: qc.method,
      vectorWeight: qc.vectorWeight,
      ftsWeight: qc.ftsWeight,
    });

    if (searchResults.length > 0) {
      kbData = searchResults.map((r) => ({
        id: r.id,
        title: (r.metadata?.sourceEntryTitle as string) || 'Knowledge Base',
        content: r.content,
        knowledge_base_id: r.knowledgeBaseId,
      }));
    }
  }

  // Fallback: load all entries if search returned nothing or embeddings unavailable
  if (kbData.length === 0) {
    const { data: kbEntries } = await supabaseAdmin
      .from('knowledge_base_entries')
      .select('id, title, content, knowledge_base_id')
      .eq('company_id', companyId);
    kbData = (kbEntries || []) as KBEntry[];
  }

  // 8b. Load contact memories for returning contacts
  let contactMemories: ContactMemory[] = [];
  if (session.contact_id) {
    contactMemories = await getContactContext(session.contact_id, companyId, searchQuery);
  }

  // 9. Resolve profile_data — prefer agent's profile if assigned
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

  const maxTokens = channelSettings.max_tokens || 500;

  return {
    action: 'respond',
    context: { profileData, kbEntries: kbData, channelOverrides, maxTokens, messages, contactMemories },
  };
}

// ── Classification (Haiku) ─────────────────────────

/**
 * Classifies an incoming message against defined scenarios using Haiku.
 * Returns the matched scenario label and confidence level.
 */
export async function classifyMessage(
  profileData: ProfileData,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<ClassificationResult> {
  if (!anthropic) {
    return { scenario_label: null, confidence: 'low' };
  }

  const classificationPrompt = await buildClassificationPrompt(profileData);
  if (!classificationPrompt) {
    return { scenario_label: null, confidence: 'high' };
  }

  const recentMessages = messages.slice(-6);

  const response = await anthropic.messages.create({
    model: CLASSIFICATION_MODEL,
    max_tokens: 100,
    system: classificationPrompt,
    messages: recentMessages,
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()
    // Strip markdown code fences if present
    .replace(/^```(?:json)?\s*/, '')
    .replace(/\s*```$/, '');

  try {
    const parsed = JSON.parse(text);
    const label = parsed.scenario_label || null;
    const confidence: ClassificationResult['confidence'] =
      ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low';

    // Validate label exists in known scenarios
    if (label) {
      const scenarios = profileData.response_flow?.scenarios || [];
      const match = scenarios.find((sc) => sc.label.toLowerCase() === label.toLowerCase());
      if (!match) {
        return { scenario_label: null, confidence: 'low' };
      }
      // Return the canonical label (exact casing from scenario definition)
      return { scenario_label: match.label, confidence };
    }

    return { scenario_label: null, confidence };
  } catch {
    return { scenario_label: null, confidence: 'low' };
  }
}

// ── Contact memory formatting ─────────────────────

function formatContactMemories(memories: ContactMemory[]): string {
  const summary = memories.find((m) => m.memory_type === 'summary');
  const others = memories.filter((m) => m.memory_type !== 'summary');

  const parts: string[] = ['## What You Know About This Contact From Previous Conversations'];

  if (summary) {
    parts.push(`**Last conversation:** ${summary.content}`);
  }

  if (others.length > 0) {
    const grouped: Record<string, string[]> = {};
    for (const m of others) {
      if (!grouped[m.memory_type]) grouped[m.memory_type] = [];
      grouped[m.memory_type].push(m.content);
    }

    const labels: Record<string, string> = {
      preference: 'Preferences',
      fact: 'Key Facts',
      decision: 'Past Agreements',
      issue: 'Unresolved Issues',
    };

    for (const [type, items] of Object.entries(grouped)) {
      parts.push(`**${labels[type] || type}:**`);
      parts.push(items.map((item) => `- ${item}`).join('\n'));
    }
  }

  parts.push(
    '\nUse this context naturally — don\'t explicitly mention "your previous conversation" unless the contact brings it up first. If an issue was unresolved, proactively check if it\'s been resolved.'
  );

  return parts.join('\n');
}

// ── AI reply generation ────────────────────────────

/**
 * Classifies the message (Haiku), then generates a targeted response (Sonnet).
 * Falls back to the full prompt if classification fails.
 */
export async function generateAndSendAIReply(
  companyId: string,
  sessionId: string,
  context: AIContext
): Promise<void> {
  if (!anthropic) return;

  const { profileData, kbEntries, channelOverrides, maxTokens, messages, contactMemories } = context;
  const hasScenarios = !!(profileData.response_flow?.scenarios?.length);

  let systemPrompt: string;

  if (hasScenarios) {
    try {
      const classification = await classifyMessage(profileData, messages);
      systemPrompt = await buildScenarioResponsePrompt(
        profileData, kbEntries, classification.scenario_label, channelOverrides,
      );
    } catch (err) {
      console.error('Classification failed, falling back to full prompt:', err);
      systemPrompt = await buildSystemPrompt(profileData, kbEntries, channelOverrides);
    }
  } else {
    systemPrompt = await buildSystemPrompt(profileData, kbEntries, channelOverrides);
  }

  // Append contact memories from previous sessions
  if (contactMemories.length > 0) {
    systemPrompt += '\n\n' + formatContactMemories(contactMemories);
  }

  const response = await anthropic.messages.create({
    model: RESPONSE_MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
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
