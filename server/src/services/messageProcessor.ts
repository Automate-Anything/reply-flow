import { supabaseAdmin } from '../config/supabase.js';
import type { WhapiIncomingMessage } from '../types/webhook.js';
import { shouldAIRespond, generateAndSendAIReply } from './ai.js';

/**
 * Normalizes a WhatsApp chat_id to a phone number.
 * e.g. "1234567890@s.whatsapp.net" -> "1234567890"
 */
function normalizeChatId(chatId: string): string {
  return chatId.replace(/@.*$/, '');
}

/**
 * Extracts message body from various message types.
 */
function extractMessageBody(msg: WhapiIncomingMessage): string {
  if (msg.text?.body) return msg.text.body;
  if (msg.image?.caption) return msg.image.caption;
  if (msg.video?.caption) return msg.video.caption;
  if (msg.document?.filename) return `[Document: ${msg.document.filename}]`;
  if (msg.audio) return '[Audio message]';
  if (msg.image) return '[Image]';
  if (msg.video) return '[Video]';
  return `[${msg.type || 'Unknown'} message]`;
}

/**
 * Processes an incoming WhatsApp message:
 * 1. Finds or creates a contact
 * 2. Finds or creates a chat session
 * 3. Idempotency check (skip duplicate messages)
 * 4. Inserts the message
 * 5. Updates session metadata
 * 6. Triggers AI response if enabled
 */
export async function processIncomingMessage(
  msg: WhapiIncomingMessage,
  companyId: string,
  channelId: number
): Promise<void> {
  const phoneNumber = normalizeChatId(msg.from);
  const chatId = normalizeChatId(msg.chat_id);
  const messageBody = extractMessageBody(msg);
  const messageTs = new Date(msg.timestamp * 1000).toISOString();

  // 1. Find or create contact
  const { data: existingContact } = await supabaseAdmin
    .from('contacts')
    .select('id')
    .eq('company_id', companyId)
    .eq('phone_number', phoneNumber)
    .eq('is_deleted', false)
    .single();

  let contactId: string;

  if (existingContact) {
    contactId = existingContact.id;
    // Update whatsapp_name if provided
    if (msg.from_name) {
      await supabaseAdmin
        .from('contacts')
        .update({ whatsapp_name: msg.from_name, updated_at: new Date().toISOString() })
        .eq('id', contactId);
    }
  } else {
    const { data: newContact, error: contactError } = await supabaseAdmin
      .from('contacts')
      .insert({
        company_id: companyId,
        phone_number: phoneNumber,
        whatsapp_name: msg.from_name || null,
        first_name: msg.from_name || null,
      })
      .select('id')
      .single();

    if (contactError) throw contactError;
    contactId = newContact.id;
  }

  // 2. Find or create chat session
  const { data: existingSession } = await supabaseAdmin
    .from('chat_sessions')
    .select('id')
    .eq('channel_id', channelId)
    .eq('chat_id', chatId)
    .single();

  let sessionId: string;

  if (existingSession) {
    sessionId = existingSession.id;
  } else {
    const { data: newSession, error: sessionError } = await supabaseAdmin
      .from('chat_sessions')
      .insert({
        company_id: companyId,
        channel_id: channelId,
        contact_id: contactId,
        chat_id: chatId,
        phone_number: phoneNumber,
        contact_name: msg.from_name || phoneNumber,
        status: 'open',
      })
      .select('id')
      .single();

    if (sessionError) throw sessionError;
    sessionId = newSession.id;
  }

  // 3. Idempotency check — skip if message already exists
  if (msg.id) {
    const { data: existing } = await supabaseAdmin
      .from('chat_messages')
      .select('id')
      .eq('message_id_normalized', msg.id)
      .eq('company_id', companyId)
      .maybeSingle();

    if (existing) {
      console.log(`Duplicate message skipped: ${msg.id}`);
      return;
    }
  }

  // 4. Insert the message
  const { error: messageError } = await supabaseAdmin
    .from('chat_messages')
    .insert({
      session_id: sessionId,
      company_id: companyId,
      chat_id_normalized: chatId,
      phone_number: phoneNumber,
      message_body: messageBody,
      message_type: msg.type || 'text',
      message_id_normalized: msg.id,
      direction: 'inbound',
      sender_type: 'contact',
      status: 'received',
      read: false,
      message_ts: messageTs,
      metadata: msg.image || msg.document || msg.audio || msg.video
        ? { media: msg.image || msg.document || msg.audio || msg.video }
        : null,
    });

  if (messageError) throw messageError;

  // 5. Update session metadata + auto-reopen resolved/closed conversations
  const { data: currentSession } = await supabaseAdmin
    .from('chat_sessions')
    .select('status, snoozed_until')
    .eq('id', sessionId)
    .single();

  const sessionUpdate: Record<string, unknown> = {
    contact_id: contactId,
    contact_name: msg.from_name || phoneNumber,
    last_message: messageBody,
    last_message_at: messageTs,
    last_message_direction: 'inbound',
    last_message_sender: 'contact',
    updated_at: new Date().toISOString(),
  };

  if (currentSession?.status === 'resolved' || currentSession?.status === 'closed') {
    sessionUpdate.status = 'open';
  }

  if (currentSession?.snoozed_until) {
    sessionUpdate.snoozed_until = null;
  }

  await supabaseAdmin
    .from('chat_sessions')
    .update(sessionUpdate)
    .eq('id', sessionId);

  // 6. Check if AI should respond (async, don't block)
  try {
    const aiContext = await shouldAIRespond(companyId, sessionId);
    if (aiContext) {
      // Fire and forget — don't block the webhook response
      generateAndSendAIReply(companyId, sessionId, aiContext).catch((err) => {
        console.error('AI reply error:', err);
      });
    }
  } catch (err) {
    console.error('AI check error:', err);
  }
}
