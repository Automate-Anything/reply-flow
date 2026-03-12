import { supabaseAdmin } from '../config/supabase.js';
import type { WhapiIncomingMessage } from '../types/webhook.js';
import { shouldAIRespond, generateAndSendAIReply, sendOutsideHoursReply } from './ai.js';
import { checkMessageAllowance, deductOverageBalance, triggerAutoTopup } from './billingService.js';
import { extractSessionMemories } from './sessionMemory.js';
import { downloadAndStore, storeBuffer } from './mediaStorage.js';
import { extractAudioTranscript, extractDocumentText } from './mediaContentExtractor.js';
import { downloadMediaById, fetchFullMessage, getContactProfile } from './whapi.js';

/**
 * Normalizes a WhatsApp JID/chat_id to a plain phone number or identifier.
 * e.g. "1234567890@s.whatsapp.net" -> "1234567890"
 */
function normalizeChatId(chatId?: string | null): string | null {
  if (!chatId) return null;
  return chatId.replace(/@.*$/, '');
}

function pickCounterpartyId(
  candidates: Array<string | null>,
  channelPhone: string | null
): string | null {
  for (const candidate of candidates) {
    if (candidate && candidate !== channelPhone) return candidate;
  }
  return candidates.find(Boolean) ?? null;
}

function resolveMessageRouting(
  msg: WhapiIncomingMessage,
  channelPhone: string | null
): { isOutbound: boolean; phoneNumber: string | null; chatId: string | null } {
  const normalizedFrom = normalizeChatId(msg.from);
  const normalizedTo = normalizeChatId(msg.to);
  const normalizedChat = normalizeChatId(msg.chat_id);

  const isOutbound = msg.from_me === true || (
    channelPhone !== null &&
    (normalizedFrom === channelPhone || normalizedTo === channelPhone) &&
    [normalizedFrom, normalizedTo, normalizedChat].some((value) => value && value !== channelPhone)
  );

  const counterpartyId = isOutbound
    ? pickCounterpartyId([normalizedTo, normalizedChat, normalizedFrom], channelPhone)
    : pickCounterpartyId([normalizedFrom, normalizedChat, normalizedTo], channelPhone);

  return {
    isOutbound,
    phoneNumber: counterpartyId,
    chatId: counterpartyId,
  };
}

/**
 * Extracts message body from various message types.
 */
function extractMessageBody(msg: WhapiIncomingMessage): string {
  if (msg.text?.body) return msg.text.body;
  if (msg.link_preview?.body) return msg.link_preview.body;
  if (msg.link_preview?.url) return msg.link_preview.url;
  if (msg.image?.caption) return msg.image.caption;
  if (msg.video?.caption) return msg.video.caption;
  if (msg.document?.filename) return `[Document: ${msg.document.filename}]`;
  if (msg.audio || msg.voice) {
    const dur = (msg.audio?.duration ?? msg.voice?.duration);
    if (dur) {
      const m = Math.floor(dur / 60);
      const s = dur % 60;
      return `[Voice message ${m}:${s.toString().padStart(2, '0')}]`;
    }
    return '[Voice message]';
  }
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
  userId: string,
  fromName?: string
): Promise<string> {
  const { data: newSession, error: sessionError } = await supabaseAdmin
    .from('chat_sessions')
    .insert({
      company_id: companyId,
      user_id: userId,
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
  channelId: number,
  userId: string,
  channelPhoneNumber?: string
): Promise<void> {
  // DEBUG: Log raw payload for voice/audio messages to understand Whapi's format
  if (msg.type === 'voice' || msg.type === 'ptt' || msg.type === 'audio') {
    console.log(`[webhook][DEBUG] Voice/audio message raw payload:`, JSON.stringify(msg, null, 2));
  }

  // Whapi webhook payloads for link_preview messages often omit the link_preview object.
  // Fetch the full message from Whapi API to get the missing data.
  if (msg.type === 'link_preview' && !msg.link_preview) {
    try {
      const { data: ch } = await supabaseAdmin
        .from('whatsapp_channels')
        .select('channel_token')
        .eq('id', channelId)
        .single();
      if (ch?.channel_token) {
        const full = await fetchFullMessage(ch.channel_token, msg.id);
        if (full?.link_preview) {
          msg.link_preview = full.link_preview as unknown as typeof msg.link_preview;
        }
      }
    } catch (err) {
      console.error('[webhook] Failed to enrich link_preview from Whapi API:', err);
    }
  }

  // If msg.from matches the channel's own number, it's an outbound message even if from_me is missing/false.
  // This happens with linked WhatsApp devices where Whapi doesn't always set from_me correctly.
  const channelPhone = normalizeChatId(channelPhoneNumber);
  const { isOutbound, phoneNumber, chatId } = resolveMessageRouting(msg, channelPhone);
  // For outbound messages, msg.from is our own number — the contact is identified by chat_id
  const messageBody = extractMessageBody(msg);
  const messageTs = new Date(msg.timestamp * 1000).toISOString();

  if (!phoneNumber || !chatId) {
    console.warn('[webhook] Could not resolve message routing', {
      id: msg.id,
      from: msg.from,
      to: msg.to,
      chat_id: msg.chat_id,
      from_me: msg.from_me,
      channelPhone,
    });
    return;
  }

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
        user_id: userId,
        phone_number: phoneNumber,
        whatsapp_name: msg.from_name || null,
        first_name: msg.from_name || null,
        owner_id: userId,
      })
      .select('id')
      .single();

    if (contactError) throw contactError;
    contactId = newContact.id;
  }

  // 1b. Fetch profile picture if not already stored (non-blocking)
  fetchAndStoreProfilePicture(contactId, phoneNumber, channelId).catch((err) => {
    console.error('Profile picture fetch error:', err);
  });

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
      // End the old session. If it's ending due to timeout (status is still open/pending),
      // also archive it so it doesn't linger in the inbox alongside the new session.
      const endUpdate: Record<string, unknown> = { ended_at: new Date().toISOString() };
      if (activeSession.status !== 'resolved' && activeSession.status !== 'closed') {
        endUpdate.is_archived = true;
      }
      await supabaseAdmin
        .from('chat_sessions')
        .update(endUpdate)
        .eq('id', activeSession.id);

      // Extract memories from the ended session (async, never blocks)
      extractSessionMemories(activeSession.id, companyId).catch((err) => {
        console.error('Memory extraction error:', err);
      });

      // Create a fresh session
      sessionId = await createNewSession(companyId, channelId, contactId, chatId, phoneNumber, userId, msg.from_name);
    } else {
      sessionId = activeSession.id;
    }
  } else {
    sessionId = await createNewSession(companyId, channelId, contactId, chatId, phoneNumber, userId, msg.from_name);
  }

  // 3. Idempotency check — skip if message already exists (by WhatsApp message ID)
  if (msg.id) {
    const { data: existing } = await supabaseAdmin
      .from('chat_messages')
      .select('id')
      .eq('message_id_normalized', msg.id)
      .eq('company_id', companyId)
      .maybeSingle();

    if (existing) {
      console.log(`[webhook] Duplicate skipped (id match): ${msg.id}`);
      return;
    }
  }

  // 3b. Secondary dedup: Whapi echoes API-sent messages back through the webhook.
  // This catches two failure modes:
  //   (a) Echo arrives with from_me=true but message_id_normalized format doesn't match → primary dedup misses it
  //   (b) Echo arrives with from_me absent/false → treated as inbound, primary dedup misses it
  // In both cases, an outbound message with the same body already exists in the session.
  // We only compare against outbound messages so a contact legitimately sending the same
  // message twice is never suppressed.
  if (isOutbound) {
    const windowStart = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: recentOutbound } = await supabaseAdmin
      .from('chat_messages')
      .select('id, metadata')
      .eq('session_id', sessionId)
      .eq('company_id', companyId)
      .eq('direction', 'outbound')
      .eq('message_body', messageBody)
      .gte('created_at', windowStart);

    const existingOutbound = (recentOutbound || []).find((message) => {
      const source = (message.metadata as { source?: string } | null)?.source;
      return source === 'app_send' || source === 'ai_send';
    });

    if (existingOutbound) {
      console.log(`[webhook] Echo skipped (outbound content match): msg.id=${msg.id}, from_me=${msg.from_me}`);
      return;
    }
  }

  // 4. Build metadata (media + reply context + link preview)
  const metadata: Record<string, unknown> = {};

  // Store link preview metadata from Whapi
  if (msg.link_preview) {
    metadata.link_preview = {
      title: msg.link_preview.title || null,
      description: msg.link_preview.description || null,
      url: msg.link_preview.url || msg.link_preview.canonical_url || null,
      image: msg.link_preview.preview || msg.link_preview.thumbnail || null,
      site_name: null,
    };
  }

  // Voice notes come as type "voice" with data in the voice field (not audio)
  const mediaPayload = msg.image || msg.document || msg.audio || msg.voice || msg.video;
  if (mediaPayload) {
    metadata.media = mediaPayload;
  }
  if (msg.context?.quoted_id) {
    // Look up the quoted message in our DB to get the real sender_type
    let quotedSender: string | null = msg.context.quoted_author || null;
    const { data: quotedMsg } = await supabaseAdmin
      .from('messages')
      .select('sender_type')
      .eq('message_id_normalized', msg.context.quoted_id)
      .maybeSingle();
    if (quotedMsg?.sender_type) {
      quotedSender = quotedMsg.sender_type;
    }
    metadata.reply = {
      quoted_message_id: msg.context.quoted_id,
      quoted_content: msg.context.quoted_content?.body?.slice(0, 200) || null,
      quoted_sender: quotedSender,
      quoted_type: msg.context.quoted_type || null,
    };
  }

  // Extract media info for storage
  let mediaLink = mediaPayload?.link as string | undefined;
  const mediaId = mediaPayload?.id as string | undefined;
  const mediaMimeType = mediaPayload?.mime_type as string | undefined;
  const mediaFilename = (mediaPayload as Record<string, unknown>)?.filename as string | undefined;

  // Fallback: if Whapi didn't include a direct link, download binary via the Gate API
  let mediaBuffer: Buffer | null = null;
  if (!mediaLink && mediaId && mediaMimeType) {
    try {
      const { data: ch } = await supabaseAdmin
        .from('whatsapp_channels')
        .select('channel_token')
        .eq('id', channelId)
        .single();
      if (ch?.channel_token) {
        mediaBuffer = await downloadMediaById(ch.channel_token, mediaId);
      }
    } catch (err) {
      console.error('Media binary fallback error:', err);
    }
  }

  // 5. Insert the message
  const { data: insertedMessage, error: messageError } = await supabaseAdmin
    .from('chat_messages')
    .insert({
      session_id: sessionId,
      company_id: companyId,
      user_id: userId,
      chat_id_normalized: chatId,
      phone_number: phoneNumber,
      message_body: messageBody,
      message_type: (msg.type === 'ptt' || msg.type === 'voice') ? 'audio' : (msg.type || 'text'),
      message_id_normalized: msg.id,
      direction: isOutbound ? 'outbound' : 'inbound',
      sender_type: isOutbound ? 'human' : 'contact',
      status: isOutbound ? 'sent' : 'received',
      read: false,
      message_ts: messageTs,
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
      media_mime_type: mediaMimeType || null,
      media_filename: mediaFilename || null,
    })
    .select('id')
    .single();

  if (messageError) throw messageError;

  // 5a. Download, store, and extract media content BEFORE AI triggers
  // This must complete so the AI has access to images, transcripts, and document text
  if (insertedMessage && mediaMimeType) {
    try {
      if (mediaLink) {
        await processMedia(insertedMessage.id, mediaLink, companyId, channelId, mediaMimeType, mediaFilename, msg.type);
      } else if (mediaBuffer) {
        await processMediaFromBuffer(insertedMessage.id, mediaBuffer, companyId, channelId, mediaMimeType, mediaFilename, msg.type);
      }
    } catch (err) {
      console.error('Media processing error:', err);
    }
  }

  // 5b. Update session metadata
  const { data: currentSession } = await supabaseAdmin
    .from('chat_sessions')
    .select('snoozed_until')
    .eq('id', sessionId)
    .single();

  const sessionUpdate: Record<string, unknown> = {
    contact_id: contactId,
    last_message: messageBody,
    last_message_at: messageTs,
    last_message_direction: isOutbound ? 'outbound' : 'inbound',
    last_message_sender: isOutbound ? 'human' : 'contact',
    updated_at: new Date().toISOString(),
  };

  // Only update contact_name from inbound messages — outbound msg.from_name is our own name
  if (!isOutbound && msg.from_name) {
    sessionUpdate.contact_name = msg.from_name;
  }

  if (currentSession?.snoozed_until) {
    sessionUpdate.snoozed_until = null;
  }

  await supabaseAdmin
    .from('chat_sessions')
    .update(sessionUpdate)
    .eq('id', sessionId);

  // 6. Outbound messages (sent by the human from their phone) are fully stored — no AI needed
  if (isOutbound) return;

  // Check message allowance (billing limits + balance check) before triggering AI
  let allowance;
  try {
    allowance = await checkMessageAllowance(companyId);
  } catch (err) {
    console.error('Message allowance check error:', err);
    // On check failure, allow AI to respond (fail open to avoid blocking messages on billing errors)
    allowance = { allowed: true, isOverLimit: false, overageMessageCents: 0, autoTopupEnabled: false, autoTopupThresholdCents: 0 };
  }

  if (!allowance.allowed) {
    // AI is paused due to billing limits — skip response silently
    return;
  }

  // 7. Check if AI should respond and generate reply
  try {
    const aiResult = await shouldAIRespond(companyId, sessionId);
    if (aiResult.action === 'respond') {
      generateAndSendAIReply(companyId, sessionId, aiResult.context)
        .then(async () => {
          // If we're consuming from the balance (over plan limit), deduct and maybe auto top-up
          if (allowance.isOverLimit && allowance.overageMessageCents > 0) {
            try {
              const newBalance = await deductOverageBalance(companyId, allowance.overageMessageCents);
              if (
                allowance.autoTopupEnabled &&
                allowance.autoTopupThresholdCents > 0 &&
                newBalance < allowance.autoTopupThresholdCents
              ) {
                triggerAutoTopup(companyId).catch((err) => {
                  console.error('Auto top-up error:', err);
                });
              }
            } catch (err) {
              console.error('Balance deduction error:', err);
            }
          }
        })
        .catch((err) => {
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

/**
 * Downloads media from Whapi, stores in Supabase Storage, and extracts
 * text content (transcripts for audio, text for documents) for AI use.
 * Returns once storage and extraction are complete.
 */
async function processMedia(
  messageId: string,
  whapiLink: string,
  companyId: string,
  channelId: number,
  mimeType: string,
  filename: string | undefined,
  messageType: string,
): Promise<void> {
  // 1. Download from Whapi and upload to Supabase Storage
  const storagePath = await downloadAndStore(whapiLink, companyId, channelId, messageId, mimeType, filename);
  if (!storagePath) return;

  const updateFields: Record<string, unknown> = { media_storage_path: storagePath };

  // 2. Extract content for AI based on message type
  if (messageType === 'audio' || messageType === 'ptt' || messageType === 'voice') {
    const transcript = await extractAudioTranscript(storagePath, mimeType);
    if (transcript) {
      // Store transcript for AI only — don't overwrite message_body
      // so the frontend shows the audio player, not text
      updateFields.media_transcript = transcript;
    }
  } else if (messageType === 'document') {
    const extractedText = await extractDocumentText(storagePath, mimeType, filename);
    if (extractedText) {
      updateFields.media_extracted_text = extractedText;
    }
  }
  // Images and videos: no server-side extraction needed — Claude Vision handles these directly

  // 3. Update the message record
  await supabaseAdmin
    .from('chat_messages')
    .update(updateFields)
    .eq('id', messageId);
}

/**
 * Stores an already-downloaded media buffer in Supabase Storage and extracts
 * text content (transcripts for audio, text for documents) for AI use.
 * Used when Whapi doesn't provide a download link and we fetch binary directly.
 */
async function processMediaFromBuffer(
  messageId: string,
  buffer: Buffer,
  companyId: string,
  channelId: number,
  mimeType: string,
  filename: string | undefined,
  messageType: string,
): Promise<void> {
  const storagePath = await storeBuffer(buffer, companyId, channelId, messageId, mimeType, filename);
  if (!storagePath) return;

  const updateFields: Record<string, unknown> = { media_storage_path: storagePath };

  if (messageType === 'audio' || messageType === 'ptt' || messageType === 'voice') {
    const transcript = await extractAudioTranscript(storagePath, mimeType);
    if (transcript) {
      updateFields.media_transcript = transcript;
    }
  } else if (messageType === 'document') {
    const extractedText = await extractDocumentText(storagePath, mimeType, filename);
    if (extractedText) {
      updateFields.media_extracted_text = extractedText;
    }
  }

  await supabaseAdmin
    .from('chat_messages')
    .update(updateFields)
    .eq('id', messageId);
}

/**
 * Fetches a contact's WhatsApp profile picture and stores it in the contacts table.
 * Skips if the contact already has a fresh profile picture URL (within 7 days).
 */
async function fetchAndStoreProfilePicture(
  contactId: string,
  phoneNumber: string,
  channelId: number
): Promise<void> {
  const { data: contact } = await supabaseAdmin
    .from('contacts')
    .select('profile_picture_url, updated_at')
    .eq('id', contactId)
    .single();

  if (contact?.profile_picture_url) {
    const updatedAt = new Date(contact.updated_at).getTime();
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    if (updatedAt > sevenDaysAgo) return;
  }

  const { data: channel } = await supabaseAdmin
    .from('whatsapp_channels')
    .select('channel_token')
    .eq('id', channelId)
    .single();

  if (!channel?.channel_token) return;

  const profile = await getContactProfile(channel.channel_token, phoneNumber);
  if (!profile) return;

  const pictureUrl = profile.icon_full || profile.icon || null;
  if (!pictureUrl) return;

  await supabaseAdmin
    .from('contacts')
    .update({ profile_picture_url: pictureUrl, updated_at: new Date().toISOString() })
    .eq('id', contactId);
}
