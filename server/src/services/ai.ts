import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { buildSystemPrompt } from './promptBuilder.js';
import type { ProfileData, KBEntry } from './promptBuilder.js';
import * as whapi from './whapi.js';

const anthropic = env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  : null;

interface AIContext {
  systemPrompt: string;
  maxTokens: number;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/**
 * Checks whether AI should respond to an incoming message for a given session.
 * Reads from per-channel AI profiles (channel_ai_profiles table).
 * Returns null if AI should NOT respond, or the AI context if it should.
 */
export async function shouldAIRespond(
  companyId: string,
  sessionId: string
): Promise<AIContext | null> {
  if (!anthropic) return null;

  // 1. Get session + channel_id
  const { data: session } = await supabaseAdmin
    .from('chat_sessions')
    .select('channel_id, human_takeover, auto_resume_at')
    .eq('id', sessionId)
    .single();

  if (!session || !session.channel_id) return null;

  // 2. Check per-channel AI profile
  const { data: profile } = await supabaseAdmin
    .from('channel_ai_profiles')
    .select('is_enabled, profile_data, max_tokens')
    .eq('channel_id', session.channel_id)
    .single();

  if (!profile?.is_enabled) return null;

  // 3. Check per-conversation human_takeover
  if (session.human_takeover) {
    if (session.auto_resume_at && new Date(session.auto_resume_at) <= new Date()) {
      await supabaseAdmin
        .from('chat_sessions')
        .update({ human_takeover: false, auto_resume_at: null })
        .eq('id', sessionId);
    } else {
      return null;
    }
  }

  // 4. Fetch knowledge base entries for the channel
  const { data: kbEntries } = await supabaseAdmin
    .from('knowledge_base_entries')
    .select('title, content')
    .eq('channel_id', session.channel_id);

  // 5. Build system prompt from profile data + KB
  const profileData = (profile.profile_data || {}) as ProfileData;
  const kbData = (kbEntries || []) as KBEntry[];
  const systemPrompt = buildSystemPrompt(profileData, kbData);

  // 6. Build message context from last 20 messages
  const { data: recentMessages } = await supabaseAdmin
    .from('chat_messages')
    .select('message_body, direction, sender_type')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (!recentMessages) return null;

  const messages = recentMessages.reverse().map((msg) => ({
    role: (msg.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: msg.message_body || '',
  }));

  return {
    systemPrompt,
    maxTokens: profile.max_tokens || 500,
    messages,
  };
}

/**
 * Generates an AI response and sends it via WhatsApp.
 */
export async function generateAndSendAIReply(
  companyId: string,
  sessionId: string,
  context: AIContext
): Promise<void> {
  if (!anthropic) return;

  // Call Claude
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

  // Get session + channel info (derive channel from session's channel_id)
  const { data: session } = await supabaseAdmin
    .from('chat_sessions')
    .select('chat_id, phone_number, channel_id')
    .eq('id', sessionId)
    .single();

  if (!session || !session.channel_id) return;

  const { data: channel } = await supabaseAdmin
    .from('whatsapp_channels')
    .select('channel_token')
    .eq('id', session.channel_id)
    .eq('channel_status', 'connected')
    .single();

  if (!channel) return;

  // Send via Whapi
  const chatId = session.chat_id.includes('@')
    ? session.chat_id
    : `${session.chat_id}@s.whatsapp.net`;

  const result = await whapi.sendTextMessage(channel.channel_token, chatId, aiReply);

  // Store AI message in DB
  const now = new Date().toISOString();
  await supabaseAdmin.from('chat_messages').insert({
    session_id: sessionId,
    company_id: companyId,
    chat_id_normalized: session.chat_id,
    phone_number: session.phone_number,
    message_body: aiReply,
    message_type: 'text',
    message_id_normalized: (result as Record<string, string>)?.message_id || null,
    direction: 'outbound',
    sender_type: 'ai',
    status: 'sent',
    read: true,
    message_ts: now,
  });

  // Update session
  await supabaseAdmin
    .from('chat_sessions')
    .update({
      last_message: aiReply,
      last_message_at: now,
      last_message_direction: 'outbound',
      last_message_sender: 'ai',
      updated_at: now,
    })
    .eq('id', sessionId);
}
