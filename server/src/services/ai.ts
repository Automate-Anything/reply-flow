import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
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
 * Returns null if AI should NOT respond, or the AI context if it should.
 */
export async function shouldAIRespond(
  userId: string,
  sessionId: string
): Promise<AIContext | null> {
  if (!anthropic) return null;

  // 1. Check global AI settings
  const { data: settings } = await supabaseAdmin
    .from('ai_settings')
    .select('is_enabled, system_prompt, max_tokens')
    .eq('user_id', userId)
    .single();

  if (!settings?.is_enabled) return null;

  // 2. Check per-conversation human_takeover
  const { data: session } = await supabaseAdmin
    .from('chat_sessions')
    .select('human_takeover, auto_resume_at')
    .eq('id', sessionId)
    .single();

  if (!session) return null;

  if (session.human_takeover) {
    // Check if auto_resume_at has passed
    if (session.auto_resume_at && new Date(session.auto_resume_at) <= new Date()) {
      // Auto-resume: clear the takeover
      await supabaseAdmin
        .from('chat_sessions')
        .update({ human_takeover: false, auto_resume_at: null })
        .eq('id', sessionId);
    } else {
      return null; // Human has taken over, AI should not respond
    }
  }

  // 3. Build message context from last 20 messages
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
    systemPrompt: settings.system_prompt || 'You are a helpful business assistant. Respond professionally and concisely.',
    maxTokens: settings.max_tokens || 500,
    messages,
  };
}

/**
 * Generates an AI response and sends it via WhatsApp.
 */
export async function generateAndSendAIReply(
  userId: string,
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

  // Get session + channel info
  const { data: session } = await supabaseAdmin
    .from('chat_sessions')
    .select('chat_id, phone_number')
    .eq('id', sessionId)
    .single();

  if (!session) return;

  const { data: channel } = await supabaseAdmin
    .from('whatsapp_channels')
    .select('channel_token')
    .eq('user_id', userId)
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
    user_id: userId,
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
