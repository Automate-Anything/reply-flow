import { supabaseAdmin } from '../config/supabase.js';
import type { WhapiIncomingMessage } from '../types/webhook.js';
import { shouldAIRespond, generateAndSendAIReply, sendOutsideHoursReply } from './ai.js';
import { extractSessionMemories } from './sessionMemory.js';

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
 * Determines if an active session should be ended based on:
 * 1. Status is resolved/closed → always end (user explicitly closed it)
 * 2. Status is open/pending but inactivity timeout exceeded → end
 */
async function checkSessionShouldEnd(
  session: { id: string; status: string; last_message_at: string | null },
  companyId: string
): Promise<boolean> {
  if (session.status === 'resolved' || session.status === 'closed') {
    return true;
  }

  if (session.last_message_at) {
    const { data: company } = await supabaseAdmin
      .from('companies')
      .select('session_timeout_hours')
      .eq('id', companyId)
      .single();

    const timeoutHours = company?.session_timeout_hours ?? 24;
    const lastActivity = new Date(session.last_message_at).getTime();
    const timeoutMs = timeoutHours * 60 * 60 * 1000;

    if (Date.now() - lastActivity > timeoutMs) {
      return true;
    }
  }

  return false;
}

/**
 * Creates a new chat session and returns its ID.
 * Handles race conditions: if a unique constraint violation occurs
 * (another request just created the session), falls back to lookup.
 */
async function createNewSession(
  companyId: string,
  channelId: number,
  contactId: string,
  chatId: string,
  phoneNumber: string,
  fromName?: string
): Promise<string> {
  const { data: newSession, error: sessionError } = await supabaseAdmin
    .from('chat_sessions')
    .insert({
      company_id: companyId,
      channel_id: channelId,
      contact_id: contactId,
      chat_id: chatId,
      phone_number: phoneNumber,
      contact_name: fromName || phoneNumber,
      status: 'open',
    })
    .select('id')
    .single();

  if (sessionError) {
    // Unique constraint violation — another request just created the session
    if (sessionError.code === '23505') {
      const { data: existing } = await supabaseAdmin
        .from('chat_sessions')
        .select('id')
        .eq('channel_id', channelId)
        .eq('chat_id', chatId)
        .is('ended_at', null)
        .single();
      if (existing) return existing.id;
    }
    throw sessionError;
  }
  return newSession.id;
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

  // 2. Find or create ACTIVE session (session boundary logic)
  let sessionId: string;

  const { data: activeSession } = await supabaseAdmin
    .from('chat_sessions')
    .select('id, status, last_message_at')
    .eq('channel_id', channelId)
    .eq('chat_id', chatId)
    .is('ended_at', null)
    .single();

  if (activeSession) {
    const shouldEnd = await checkSessionShouldEnd(activeSession, companyId);

    if (shouldEnd) {
      // End the old session
      await supabaseAdmin
        .from('chat_sessions')
        .update({ ended_at: new Date().toISOString() })
        .eq('id', activeSession.id);

      // Extract memories from the ended session (async, never blocks)
      extractSessionMemories(activeSession.id, companyId).catch((err) => {
        console.error('Memory extraction error:', err);
      });

      // Create a fresh session
      sessionId = await createNewSession(companyId, channelId, contactId, chatId, phoneNumber, msg.from_name);
    } else {
      sessionId = activeSession.id;
    }
  } else {
    sessionId = await createNewSession(companyId, channelId, contactId, chatId, phoneNumber, msg.from_name);
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

  // 4. Build metadata (media + reply context)
  const metadata: Record<string, unknown> = {};
  if (msg.image || msg.document || msg.audio || msg.video) {
    metadata.media = msg.image || msg.document || msg.audio || msg.video;
  }
  if (msg.context?.quoted_id) {
    metadata.reply = {
      quoted_message_id: msg.context.quoted_id,
      quoted_content: msg.context.quoted_content?.body?.slice(0, 200) || null,
      quoted_sender: msg.context.quoted_author || null,
      quoted_type: msg.context.quoted_type || null,
    };
  }

  // 5. Insert the message
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
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
    });

  if (messageError) throw messageError;

  // 5. Update session metadata
  const { data: currentSession } = await supabaseAdmin
    .from('chat_sessions')
    .select('snoozed_until')
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

  if (currentSession?.snoozed_until) {
    sessionUpdate.snoozed_until = null;
  }

  await supabaseAdmin
    .from('chat_sessions')
    .update(sessionUpdate)
    .eq('id', sessionId);

  // 6. Check if AI should respond (async, don't block)
  try {
    const aiResult = await shouldAIRespond(companyId, sessionId);
    if (aiResult.action === 'respond') {
      generateAndSendAIReply(companyId, sessionId, aiResult.context).catch((err) => {
        console.error('AI reply error:', err);
      });
    } else if (aiResult.action === 'outside_hours') {
      sendOutsideHoursReply(companyId, sessionId, aiResult.channelId, aiResult.outsideHoursMessage).catch((err) => {
        console.error('Outside hours reply error:', err);
      });
    }
  } catch (err) {
    console.error('AI check error:', err);
  }
}
