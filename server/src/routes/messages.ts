import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';
import * as whapi from '../services/whapi.js';
import { getProvider } from '../services/providers/index.js';
import { getSignedUrl, downloadAndStore, storeBuffer } from '../services/mediaStorage.js';
import { createNotification } from '../services/notificationService.js';
import { convertToOggOpus } from '../services/audioConverter.js';
import { extractAudioTranscript } from '../services/mediaContentExtractor.js';
import {
  checkRateLimit, incrementRateCounter, check24HourWindow,
  checkContentSafety, checkDuplicateContent, hashMessageBody,
  logComplianceMetric, getResponseRateStatus,
} from '../services/complianceUtils.js';

const router = Router();
router.use(requireAuth);

const voiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
}).single('audio');

const sendVoiceSchema = z.object({
  sessionId: z.string().uuid(),
  duration: z.coerce.number().positive().max(900),
});

const retryVoiceSchema = z.object({
  messageId: z.string().uuid(),
});

// Send a message
router.post('/send', requirePermission('messages', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { sessionId, body, quotedMessageId } = req.body;

    if (!sessionId || !body) {
      res.status(400).json({ error: 'sessionId and body are required' });
      return;
    }

    // Get session info (includes channel_id to derive which channel to send through)
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('chat_sessions')
      .select('chat_id, phone_number, channel_id')
      .eq('id', sessionId)
      .eq('company_id', companyId)
      .single();

    if (sessionError || !session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (!session.channel_id) {
      res.status(400).json({ error: 'Conversation is not linked to a channel' });
      return;
    }

    // Get channel token via the session's channel
    const { data: channel } = await supabaseAdmin
      .from('channels')
      .select('channel_token, channel_type')
      .eq('id', session.channel_id)
      .eq('channel_status', 'connected')
      .single();

    if (!channel) {
      res.status(400).json({ error: 'No connected channel for this conversation' });
      return;
    }

    // Resolve quoted message if replying
    let replyMetadata: Record<string, unknown> | null = null;
    let whapiQuotedId: string | undefined;

    if (quotedMessageId) {
      const { data: quotedMsg } = await supabaseAdmin
        .from('chat_messages')
        .select('message_id_normalized, message_body, sender_type, message_type')
        .eq('id', quotedMessageId)
        .eq('company_id', companyId)
        .single();

      if (quotedMsg) {
        whapiQuotedId = quotedMsg.message_id_normalized || undefined;
        replyMetadata = {
          reply: {
            quoted_message_id: quotedMsg.message_id_normalized,
            quoted_content: (quotedMsg.message_body || '').slice(0, 200),
            quoted_sender: quotedMsg.sender_type,
            quoted_type: quotedMsg.message_type,
          },
        };
      }
    }

    // 1. Rate limit check (with response-rate throttle)
    const ct = channel.channel_type || 'whatsapp';
    const responseRate = await getResponseRateStatus(session.channel_id, companyId, ct);
    const effectiveLimit = responseRate.throttled ? 30 : undefined; // 50% of default when throttled
    const rateCheck = checkRateLimit(session.channel_id, companyId, effectiveLimit, ct);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        error: 'rate_limit_exceeded',
        remaining: 0,
        limit: rateCheck.limit,
        resetsAt: rateCheck.resetsAt,
      });
    }

    // 2. 24-hour window check
    const windowCheck = await check24HourWindow(sessionId, ct);
    if (!windowCheck.allowed) {
      return res.status(403).json({
        error: '24h_window_expired',
        message: '24-hour conversation window has expired. Waiting for customer to message.',
        lastInboundAt: windowCheck.lastInboundAt,
      });
    }

    // 3. Content safety (warnings only, don't block)
    const safetyCheck = await checkContentSafety(body, sessionId, ct);

    // 4. Duplicate content check (warning only)
    const dupeCheck = await checkDuplicateContent(session.channel_id, body);
    const duplicateWarning = dupeCheck.isDuplicate
      ? `Same message sent to ${dupeCheck.matchCount}+ contacts in the last hour`
      : undefined;

    // Send via channel provider
    const provider = getProvider(channel.channel_type || 'whatsapp');
    const result = await provider.sendMessage(channel as any, session.chat_id, body, {
      quotedMessageId: whapiQuotedId,
    });
    console.log('[send] provider result:', JSON.stringify(result));

    incrementRateCounter(session.channel_id);
    logComplianceMetric(session.channel_id, companyId, {
      type: 'message_sent',
      path: 'manual',
      hash: hashMessageBody(body),
    });

    // Store in DB
    const outboundMetadata = {
      ...(replyMetadata || {}),
      source: 'app_send',
    };

    const now = new Date().toISOString();
    const { data: message, error: msgError } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        session_id: sessionId,
        company_id: companyId,
        user_id: req.userId,
        chat_id_normalized: session.chat_id,
        phone_number: session.phone_number,
        message_body: body,
        message_type: 'text',
        message_id_normalized: result.messageId || null,
        direction: 'outbound',
        sender_type: 'human',
        status: 'sent',
        read: true,
        message_ts: now,
        metadata: outboundMetadata,
      })
      .select()
      .single();

    if (msgError) throw msgError;

    // Update session — only update last_message if this is the newest message
    // Also mark conversation as read since the user is actively sending a message
    await supabaseAdmin
      .from('chat_sessions')
      .update({
        last_message: body,
        last_message_at: now,
        last_message_direction: 'outbound',
        last_message_sender: 'human',
        updated_at: now,
        draft_message: null,
        marked_unread: false,
        last_read_at: now,
      })
      .eq('id', sessionId)
      .or(`last_message_at.is.null,last_message_at.lte.${now}`);

    // Mark all inbound messages in this session as read
    await supabaseAdmin
      .from('chat_messages')
      .update({ read: true })
      .eq('session_id', sessionId)
      .eq('direction', 'inbound')
      .eq('read', false);

    res.json({
      message,
      compliance: {
        warnings: [...safetyCheck.warnings, ...(duplicateWarning ? [duplicateWarning] : [])],
        remaining: rateCheck.remaining - 1,
        limit: rateCheck.limit,
        resetsAt: rateCheck.resetsAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Send an email message
router.post('/send-email', requirePermission('messages', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { sessionId, htmlBody, textBody, subject, cc, bcc } = req.body;

    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }

    // Look up session
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('chat_sessions')
      .select('id, channel_id, chat_id, phone_number, contact_name')
      .eq('id', sessionId)
      .eq('company_id', companyId)
      .single();

    if (sessionError || !session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (!session.channel_id) {
      res.status(400).json({ error: 'Conversation is not linked to a channel' });
      return;
    }

    // Look up channel
    const { data: channel } = await supabaseAdmin
      .from('channels')
      .select('id, channel_type, channel_token, channel_status, email_address, oauth_access_token, oauth_refresh_token, email_signature')
      .eq('id', session.channel_id)
      .eq('channel_status', 'connected')
      .single();

    if (!channel) {
      res.status(400).json({ error: 'No connected channel for this conversation' });
      return;
    }
    if (channel.channel_type !== 'email') {
      res.status(400).json({ error: 'Not an email channel' });
      return;
    }

    // Get last message for threading (inReplyTo, references)
    const { data: lastMsg } = await supabaseAdmin
      .from('chat_messages')
      .select('metadata')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const lastMeta = lastMsg?.metadata as Record<string, unknown> | null;

    // Send via email provider
    const provider = getProvider('email');
    const result = await provider.sendMessage(channel as any, session.phone_number, htmlBody || '', {
      subject: subject || (lastMeta?.subject as string) || '',
      threadId: session.chat_id, // Gmail threadId
      inReplyTo: (lastMeta?.message_id_header as string) || '',
      references: (lastMeta?.references as string) || '',
      cc: cc || [],
      bcc: bcc || [],
    });

    // Store outbound message
    const now = new Date().toISOString();
    const plainText = textBody || (htmlBody || '').replace(/<[^>]*>/g, '');
    const { data: message, error: msgError } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        session_id: sessionId,
        company_id: companyId,
        user_id: req.userId,
        chat_id_normalized: session.chat_id,
        phone_number: session.phone_number,
        message_body: plainText,
        message_type: 'email',
        message_id_normalized: result.messageId,
        direction: 'outbound',
        sender_type: 'human',
        status: 'sent',
        read: true,
        message_ts: now,
        metadata: { subject, html_body: htmlBody, cc, bcc },
      })
      .select()
      .single();

    if (msgError) throw msgError;

    // Update session
    await supabaseAdmin
      .from('chat_sessions')
      .update({
        last_message: `${subject}: ${(plainText || '').substring(0, 100)}`,
        last_message_at: now,
        last_message_direction: 'outbound',
        last_message_sender: 'human',
        updated_at: now,
        draft_message: null,
        marked_unread: false,
        last_read_at: now,
      })
      .eq('id', sessionId)
      .or(`last_message_at.is.null,last_message_at.lte.${now}`);

    // Mark inbound messages as read
    await supabaseAdmin
      .from('chat_messages')
      .update({ read: true })
      .eq('session_id', sessionId)
      .eq('direction', 'inbound')
      .eq('read', false);

    res.json({ success: true, message, messageId: result.messageId });
  } catch (err) {
    console.error('[messages] send-email error:', err);
    next(err);
  }
});

// Send a voice note
router.post('/send-voice', requirePermission('messages', 'create'), (req, res, next) => {
  voiceUpload(req, res, (err) => {
    if (err) {
      if ((err as any).code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: 'Audio file too large (max 25MB)' });
        return;
      }
      res.status(400).json({ error: 'File upload failed' });
      return;
    }
    next();
  });
}, async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No audio file provided' });
      return;
    }

    const parsed = sendVoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
      return;
    }
    const { sessionId, duration } = parsed.data;
    const companyId = req.companyId!;
    const userId = req.userId!;

    // 1. Look up session to get channel info and chat_id
    const { data: session, error: sessionErr } = await supabaseAdmin
      .from('chat_sessions')
      .select('id, channel_id, phone_number, chat_id')
      .eq('id', sessionId)
      .eq('company_id', companyId)
      .single();

    if (sessionErr || !session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Get channel token
    const { data: channel } = await supabaseAdmin
      .from('channels')
      .select('channel_token')
      .eq('id', session.channel_id)
      .eq('channel_status', 'connected')
      .single();

    if (!channel) {
      res.status(400).json({ error: 'No connected WhatsApp channel for this conversation' });
      return;
    }

    // Format chat_id for Whapi
    const chatId = session.chat_id.includes('@')
      ? session.chat_id
      : `${session.chat_id}@s.whatsapp.net`;

    // 2. Generate message ID
    const messageId = crypto.randomUUID();

    // 3. Convert to OGG/Opus
    const oggBuffer = await convertToOggOpus(file.buffer, messageId, file.mimetype);

    // 4. Upload to Supabase Storage
    const storagePath = await storeBuffer(
      oggBuffer,
      companyId,
      session.channel_id,
      messageId,
      'audio/ogg',
    );

    if (!storagePath) {
      res.status(500).json({ error: 'Failed to store audio file' });
      return;
    }

    // 5. Format duration for message body
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    const now = new Date().toISOString();

    // 6. Send to WhatsApp via Whapi
    let status = 'sent';
    try {
      const signedUrl = await getSignedUrl(storagePath, 300); // 5-min URL for Whapi to download
      if (!signedUrl) throw new Error('Failed to generate signed URL');
      await whapi.sendVoiceMessage(channel.channel_token, chatId, signedUrl);
    } catch (whapiErr) {
      console.error('Whapi voice send failed:', whapiErr);
      status = 'failed';
    }

    // 7. Insert chat_messages row
    const { data: message, error: insertErr } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        id: messageId,
        session_id: sessionId,
        company_id: companyId,
        user_id: userId,
        chat_id_normalized: session.chat_id,
        phone_number: session.phone_number,
        message_body: `[Voice message ${durationStr}]`,
        message_type: 'voice',
        direction: 'outbound',
        sender_type: 'human',
        status,
        read: true,
        message_ts: now,
        media_storage_path: storagePath,
        media_mime_type: 'audio/ogg',
        media_filename: `voice-${messageId}.ogg`,
        metadata: { duration_seconds: duration },
      })
      .select()
      .single();

    if (insertErr) {
      console.error('Failed to insert voice message:', insertErr);
      res.status(500).json({ error: 'Failed to save voice message' });
      return;
    }

    // 8. Update chat_sessions (same pattern as text send route)
    await supabaseAdmin
      .from('chat_sessions')
      .update({
        last_message: '[Voice message]',
        last_message_at: now,
        last_message_direction: 'outbound',
        last_message_sender: 'human',
        updated_at: now,
        draft_message: null,
        marked_unread: false,
        last_read_at: now,
      })
      .eq('id', sessionId)
      .or(`last_message_at.is.null,last_message_at.lte.${now}`);

    // 9. Mark inbound messages as read
    await supabaseAdmin
      .from('chat_messages')
      .update({ read: true })
      .eq('session_id', sessionId)
      .eq('direction', 'inbound')
      .eq('read', false);

    // 10. Async transcription (fire-and-forget)
    extractAudioTranscript(storagePath, 'audio/ogg')
      .then(async (transcript) => {
        if (transcript) {
          await supabaseAdmin
            .from('chat_messages')
            .update({ media_transcript: transcript })
            .eq('id', messageId);
        }
      })
      .catch((err) => console.error('Voice transcription failed:', err));

    res.json({ message });
  } catch (err) {
    console.error('Voice send error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Retry a failed voice message
router.post('/:messageId/retry-voice', requirePermission('messages', 'create'), async (req, res) => {
  try {
    const parsed = retryVoiceSchema.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid message ID' });
      return;
    }
    const { messageId } = parsed.data;
    const companyId = req.companyId!;

    // 1. Look up the failed voice message
    const { data: message, error: msgErr } = await supabaseAdmin
      .from('chat_messages')
      .select('id, session_id, media_storage_path')
      .eq('id', messageId)
      .eq('company_id', companyId)
      .eq('message_type', 'voice')
      .eq('status', 'failed')
      .single();

    if (msgErr || !message) {
      res.status(404).json({ error: 'Failed voice message not found' });
      return;
    }

    // 2. Look up session + channel
    const { data: session } = await supabaseAdmin
      .from('chat_sessions')
      .select('id, channel_id, chat_id')
      .eq('id', message.session_id)
      .single();

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const { data: channel } = await supabaseAdmin
      .from('channels')
      .select('channel_token')
      .eq('id', session.channel_id)
      .eq('channel_status', 'connected')
      .single();

    if (!channel) {
      res.status(400).json({ error: 'No connected WhatsApp channel' });
      return;
    }

    // 3. Generate signed URL for the existing stored file
    const signedUrl = await getSignedUrl(message.media_storage_path, 300);
    if (!signedUrl) {
      res.status(500).json({ error: 'Failed to generate media URL' });
      return;
    }

    // 4. Re-send via Whapi
    const chatId = session.chat_id.includes('@')
      ? session.chat_id
      : `${session.chat_id}@s.whatsapp.net`;
    await whapi.sendVoiceMessage(channel.channel_token, chatId, signedUrl);

    // 5. Update status to sent
    const now = new Date().toISOString();
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('chat_messages')
      .update({ status: 'sent', updated_at: now })
      .eq('id', messageId)
      .select()
      .single();

    if (updateErr) {
      res.status(500).json({ error: 'Failed to update message status' });
      return;
    }

    // 6. Update session
    await supabaseAdmin
      .from('chat_sessions')
      .update({
        last_message: '[Voice message]',
        last_message_at: now,
        last_message_direction: 'outbound',
        last_message_sender: 'human',
        updated_at: now,
        marked_unread: false,
        last_read_at: now,
      })
      .eq('id', message.session_id)
      .or(`last_message_at.is.null,last_message_at.lte.${now}`);

    res.json({ message: updated });
  } catch (err) {
    console.error('Voice retry error:', err);
    res.status(500).json({ error: 'Retry failed' });
  }
});

// Schedule a message for later
router.post('/schedule', requirePermission('messages', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { sessionId, body, scheduledFor } = req.body;

    if (!sessionId || !body || !scheduledFor) {
      res.status(400).json({ error: 'sessionId, body, and scheduledFor are required' });
      return;
    }

    const scheduledDate = new Date(scheduledFor);
    if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
      res.status(400).json({ error: 'scheduledFor must be a valid future timestamp' });
      return;
    }

    // Verify session exists and belongs to this company
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('chat_sessions')
      .select('chat_id, phone_number, channel_id')
      .eq('id', sessionId)
      .eq('company_id', companyId)
      .single();

    if (sessionError || !session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (!session.channel_id) {
      res.status(400).json({ error: 'Conversation is not linked to a channel' });
      return;
    }

    // Store scheduled message (don't send yet)
    const { data: message, error: msgError } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        session_id: sessionId,
        company_id: companyId,
        user_id: req.userId,
        chat_id_normalized: session.chat_id,
        phone_number: session.phone_number,
        message_body: body,
        message_type: 'text',
        direction: 'outbound',
        sender_type: 'human',
        status: 'scheduled',
        scheduled_for: scheduledDate.toISOString(),
        read: true,
        metadata: { source: 'app_send' },
      })
      .select()
      .single();

    if (msgError) throw msgError;

    res.json({ message });

    // Notify the user that a message was scheduled (non-blocking)
    createNotification({
      companyId,
      userId: req.userId!,
      type: 'schedule_set',
      title: 'Message scheduled',
      body: `Scheduled for ${scheduledDate.toLocaleString()}`,
      data: { conversation_id: sessionId },
    }).catch((err) => console.error('Schedule set notification error:', err));
  } catch (err) {
    next(err);
  }
});

// List all scheduled messages for the company
router.get('/scheduled', requirePermission('messages', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    const { data: messages, error } = await supabaseAdmin
      .from('chat_messages')
      .select('*, session:session_id(contact_name, phone_number, assigned_to, status, priority)')
      .eq('company_id', companyId)
      .eq('status', 'scheduled')
      .not('scheduled_for', 'is', null)
      .order('scheduled_for', { ascending: true });

    if (error) throw error;

    res.json({ messages: messages || [] });
  } catch (err) {
    next(err);
  }
});

// Update a scheduled message (body and/or time)
router.patch('/scheduled/:messageId', requirePermission('messages', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { messageId } = req.params;
    const { body, scheduledFor } = req.body;

    if (!body && !scheduledFor) {
      res.status(400).json({ error: 'body or scheduledFor is required' });
      return;
    }

    // Verify the message exists and is still scheduled
    const { data: existing } = await supabaseAdmin
      .from('chat_messages')
      .select('id')
      .eq('id', messageId)
      .eq('company_id', companyId)
      .eq('status', 'scheduled')
      .single();

    if (!existing) {
      res.status(404).json({ error: 'Scheduled message not found' });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (body) updates.message_body = body;
    if (scheduledFor) {
      const scheduledDate = new Date(scheduledFor);
      if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
        res.status(400).json({ error: 'scheduledFor must be a valid future timestamp' });
        return;
      }
      updates.scheduled_for = scheduledDate.toISOString();
    }

    const { data: updated, error } = await supabaseAdmin
      .from('chat_messages')
      .update(updates)
      .eq('id', messageId)
      .select('*, session:session_id(contact_name, phone_number, assigned_to, status, priority)')
      .single();

    if (error) throw error;

    res.json({ message: updated });
  } catch (err) {
    next(err);
  }
});

// Cancel a scheduled message
router.delete('/scheduled/:messageId', requirePermission('messages', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { messageId } = req.params;

    const { data, error } = await supabaseAdmin
      .from('chat_messages')
      .delete()
      .eq('id', messageId)
      .eq('company_id', companyId)
      .eq('status', 'scheduled')
      .select()
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Scheduled message not found' });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── Link preview (OG metadata) ────────────────────────────────────────────────
// IMPORTANT: This must come BEFORE /:messageId routes, otherwise Express
// matches "link-preview" as a messageId parameter.

router.get('/link-preview', async (req, res, next) => {
  try {
    const url = req.query.url as string;
    if (!url) { res.status(400).json({ error: 'url is required' }); return; }

    // Validate URL
    let parsed: URL;
    try {
      parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch {
      res.status(400).json({ error: 'Invalid URL' });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(parsed.href, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LinkPreview/1.0)',
        'Accept': 'text/html',
      },
      redirect: 'follow',
    });
    clearTimeout(timeout);

    if (!response.ok) {
      res.json({ title: null, description: null, image: null, site_name: null, url: parsed.href });
      return;
    }

    // Only read first 50KB to find OG tags
    const reader = response.body?.getReader();
    if (!reader) { res.json({ title: null, description: null, image: null, site_name: null, url: parsed.href }); return; }

    let html = '';
    const decoder = new TextDecoder();
    while (html.length < 50_000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      // Stop once we've passed </head> — OG tags are in <head>
      if (html.includes('</head>')) break;
    }
    reader.cancel().catch(() => {});

    const getMetaContent = (property: string): string | null => {
      // Match both property="..." and name="..."
      const re = new RegExp(
        `<meta[^>]*(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']|<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`,
        'i'
      );
      const m = html.match(re);
      return m?.[1] || m?.[2] || null;
    };

    // Also grab <title> as fallback
    const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || null;

    const ogTitle = getMetaContent('og:title') || getMetaContent('twitter:title') || titleTag;
    const ogDescription = getMetaContent('og:description') || getMetaContent('twitter:description') || getMetaContent('description');
    const ogImage = getMetaContent('og:image') || getMetaContent('twitter:image');
    const ogSiteName = getMetaContent('og:site_name');

    // Cache for 1 hour
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({
      title: ogTitle ? ogTitle.slice(0, 300) : null,
      description: ogDescription ? ogDescription.slice(0, 500) : null,
      image: ogImage || null,
      site_name: ogSiteName || parsed.hostname,
      url: parsed.href,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      res.json({ title: null, description: null, image: null, site_name: null, url: req.query.url });
      return;
    }
    next(err);
  }
});

// ── Get signed URL for media message ─────────────────────────────────────────
router.get('/:messageId/media', requirePermission('messages', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const messageId = req.params.messageId as string;

    const { data: msg } = await supabaseAdmin
      .from('chat_messages')
      .select('media_storage_path, metadata, media_mime_type, media_filename, message_type, message_id_normalized, session_id')
      .eq('id', messageId)
      .eq('company_id', companyId)
      .single();

    if (!msg) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    // If media is already stored, return signed URL
    if (msg.media_storage_path) {
      const signedUrl = await getSignedUrl(msg.media_storage_path);
      if (!signedUrl) {
        res.status(500).json({ error: 'Failed to generate media URL' });
        return;
      }
      res.json({ url: signedUrl });
      return;
    }

    // ── On-demand media resolution ──────────────────────────────────────
    // Look up channel info (needed for all Whapi API calls)
    const { data: session } = await supabaseAdmin
      .from('chat_sessions')
      .select('channel_id')
      .eq('id', msg.session_id)
      .single();

    if (!session) {
      res.status(404).json({ error: 'No media found for this message' });
      return;
    }

    const { data: channel } = await supabaseAdmin
      .from('channels')
      .select('channel_token')
      .eq('id', session.channel_id)
      .single();

    if (!channel?.channel_token) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const rawFilename = msg.media_filename;
    const filename: string | undefined = typeof rawFilename === 'string' ? rawFilename : undefined;

    // Strategy 1: Use media ID from metadata to download binary directly
    const mediaPayload = (msg.metadata as Record<string, unknown>)?.media as Record<string, unknown> | undefined;
    if (mediaPayload) {
      const mediaLink = mediaPayload.link as string | undefined;
      const mediaId = mediaPayload.id as string | undefined;
      const rawMime = (mediaPayload.mime_type as string | undefined) || (typeof msg.media_mime_type === 'string' ? msg.media_mime_type : null);
      const mimeType: string = rawMime || 'audio/ogg';

      // If there's a direct link, download from it
      if (mediaLink) {
        const storagePath = await downloadAndStore(mediaLink, companyId, session.channel_id, messageId, mimeType, filename);
        if (storagePath) {
          await supabaseAdmin.from('chat_messages').update({ media_storage_path: storagePath }).eq('id', messageId);
          const signedUrl = await getSignedUrl(storagePath);
          if (signedUrl) { res.json({ url: signedUrl }); return; }
        }
      }

      // If there's a media ID, download binary directly from Whapi
      if (mediaId) {
        const buffer = await whapi.downloadMediaById(channel.channel_token, mediaId);
        if (buffer) {
          const storagePath = await storeBuffer(buffer, companyId, session.channel_id, messageId, mimeType, filename);
          if (storagePath) {
            await supabaseAdmin.from('chat_messages').update({ media_storage_path: storagePath, media_mime_type: mimeType }).eq('id', messageId);
            const signedUrl = await getSignedUrl(storagePath);
            if (signedUrl) { res.json({ url: signedUrl }); return; }
          }
        }
      }
    }

    // Strategy 2: No metadata — try fetching the message from Whapi by its WhatsApp message ID
    const whapiMsgId = msg.message_id_normalized;
    if (whapiMsgId) {
      const whapiMsg = await whapi.getMessageById(channel.channel_token, typeof whapiMsgId === 'string' ? whapiMsgId : String(whapiMsgId));
      if (whapiMsg?.media) {
        const mimeType = whapiMsg.media.mime_type || (typeof msg.media_mime_type === 'string' ? msg.media_mime_type : null) || 'audio/ogg';

        // Try the direct link first
        if (whapiMsg.media.link) {
          const storagePath = await downloadAndStore(whapiMsg.media.link, companyId, session.channel_id, messageId, mimeType, filename);
          if (storagePath) {
            await supabaseAdmin.from('chat_messages').update({ media_storage_path: storagePath, media_mime_type: mimeType }).eq('id', messageId);
            const signedUrl = await getSignedUrl(storagePath);
            if (signedUrl) { res.json({ url: signedUrl }); return; }
          }
        }

        // Try downloading binary by media ID
        if (whapiMsg.media.id) {
          const buffer = await whapi.downloadMediaById(channel.channel_token, whapiMsg.media.id);
          if (buffer) {
            const storagePath = await storeBuffer(buffer, companyId, session.channel_id, messageId, mimeType, filename);
            if (storagePath) {
              await supabaseAdmin.from('chat_messages').update({ media_storage_path: storagePath, media_mime_type: mimeType }).eq('id', messageId);
              const signedUrl = await getSignedUrl(storagePath);
              if (signedUrl) { res.json({ url: signedUrl }); return; }
            }
          }
        }
      }
    }

    res.status(404).json({ error: 'Could not resolve media' });
  } catch (err) {
    next(err);
  }
});

// ── Helper: look up message + its channel token ──────────────────────────────
async function getMessageWithChannel(messageId: string, companyId: string) {
  const { data: msg } = await supabaseAdmin
    .from('chat_messages')
    .select('id, session_id, message_id_normalized, message_body, message_type, sender_type, is_starred, is_pinned, reactions')
    .eq('id', messageId)
    .eq('company_id', companyId)
    .single();

  if (!msg) return null;

  const { data: session } = await supabaseAdmin
    .from('chat_sessions')
    .select('channel_id')
    .eq('id', msg.session_id)
    .single();

  if (!session?.channel_id) return { msg, channelToken: null };

  const { data: channel } = await supabaseAdmin
    .from('channels')
    .select('channel_token')
    .eq('id', session.channel_id)
    .eq('channel_status', 'connected')
    .single();

  return { msg, channelToken: channel?.channel_token || null };
}

// ── Star message ─────────────────────────────────────────────────────────────
router.post('/:messageId/star', requirePermission('messages', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { messageId } = req.params;

    const result = await getMessageWithChannel(messageId as string, companyId);
    if (!result) { res.status(404).json({ error: 'Message not found' }); return; }

    const newStarred = !result.msg.is_starred;
    const { data: updated, error } = await supabaseAdmin
      .from('chat_messages')
      .update({ is_starred: newStarred })
      .eq('id', messageId)
      .select()
      .single();

    if (error) throw error;

    // Sync to WhatsApp (fire-and-forget)
    if (result.channelToken && result.msg.message_id_normalized) {
      (newStarred
        ? whapi.starMessage(result.channelToken, result.msg.message_id_normalized)
        : whapi.unstarMessage(result.channelToken, result.msg.message_id_normalized)
      ).catch((err) => console.error('Whapi star error:', err.message));
    }

    res.json({ message: updated });
  } catch (err) {
    next(err);
  }
});

// ── Pin message ──────────────────────────────────────────────────────────────
router.post('/:messageId/pin', requirePermission('messages', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { messageId } = req.params;

    const result = await getMessageWithChannel(messageId as string, companyId);
    if (!result) { res.status(404).json({ error: 'Message not found' }); return; }

    const newPinned = !result.msg.is_pinned;
    const { data: updated, error } = await supabaseAdmin
      .from('chat_messages')
      .update({ is_pinned: newPinned })
      .eq('id', messageId)
      .select()
      .single();

    if (error) throw error;

    // Sync to WhatsApp (fire-and-forget)
    if (result.channelToken && result.msg.message_id_normalized) {
      (newPinned
        ? whapi.pinMessage(result.channelToken, result.msg.message_id_normalized)
        : whapi.unpinMessage(result.channelToken, result.msg.message_id_normalized)
      ).catch((err) => console.error('Whapi pin error:', err.message));
    }

    res.json({ message: updated });
  } catch (err) {
    next(err);
  }
});

// ── React to message ─────────────────────────────────────────────────────────
router.post('/:messageId/react', requirePermission('messages', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const userId = req.userId!;
    const { messageId } = req.params;
    const { emoji } = req.body;

    const result = await getMessageWithChannel(messageId as string, companyId);
    if (!result) { res.status(404).json({ error: 'Message not found' }); return; }

    // Update reactions array: remove existing reaction by this user, add new if emoji provided
    // Match both the UUID and 'self' (webhook echoes may have stored 'self' for our reactions)
    const reactions = Array.isArray(result.msg.reactions) ? [...result.msg.reactions] : [];
    const filtered = reactions.filter((r: { user_id: string }) => r.user_id !== userId && r.user_id !== 'self');
    if (emoji) {
      filtered.push({ emoji, user_id: userId });
    }

    const { data: updated, error } = await supabaseAdmin
      .from('chat_messages')
      .update({ reactions: filtered })
      .eq('id', messageId)
      .select()
      .single();

    if (error) throw error;

    // Sync to WhatsApp (fire-and-forget)
    if (result.channelToken && result.msg.message_id_normalized) {
      whapi.reactToMessage(result.channelToken, result.msg.message_id_normalized, emoji || '')
        .catch((err) => console.error('Whapi react error:', err.message));
    }

    res.json({ message: updated });
  } catch (err) {
    next(err);
  }
});

// ── Forward message ──────────────────────────────────────────────────────────
router.post('/:messageId/forward', requirePermission('messages', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { messageId } = req.params;
    const { targetSessionId } = req.body;

    if (!targetSessionId) {
      res.status(400).json({ error: 'targetSessionId is required' });
      return;
    }

    // Get original message
    const { data: originalMsg } = await supabaseAdmin
      .from('chat_messages')
      .select('id, session_id, message_id_normalized, message_body, message_type')
      .eq('id', messageId)
      .eq('company_id', companyId)
      .single();

    if (!originalMsg) { res.status(404).json({ error: 'Message not found' }); return; }

    // Get original message's channel token (for Whapi forward)
    const { data: origSession } = await supabaseAdmin
      .from('chat_sessions')
      .select('channel_id')
      .eq('id', originalMsg.session_id)
      .single();

    // Get target session info
    const { data: targetSession } = await supabaseAdmin
      .from('chat_sessions')
      .select('id, chat_id, phone_number, channel_id')
      .eq('id', targetSessionId)
      .eq('company_id', companyId)
      .single();

    if (!targetSession) { res.status(404).json({ error: 'Target session not found' }); return; }

    // Forward via Whapi (fire-and-forget)
    if (origSession?.channel_id && originalMsg.message_id_normalized) {
      const { data: channel } = await supabaseAdmin
        .from('channels')
        .select('channel_token')
        .eq('id', origSession.channel_id)
        .eq('channel_status', 'connected')
        .single();

      if (channel) {
        const targetChatId = targetSession.chat_id.includes('@')
          ? targetSession.chat_id
          : `${targetSession.chat_id}@s.whatsapp.net`;

        whapi.forwardMessage(channel.channel_token, originalMsg.message_id_normalized, targetChatId)
          .catch((err) => console.error('Whapi forward error:', err.message));
      }
    }

    // Store forwarded message in our DB
    const now = new Date().toISOString();
    const { data: newMsg, error: msgError } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        session_id: targetSessionId,
        company_id: companyId,
        user_id: req.userId,
        chat_id_normalized: targetSession.chat_id,
        phone_number: targetSession.phone_number,
        message_body: originalMsg.message_body,
        message_type: originalMsg.message_type,
        direction: 'outbound',
        sender_type: 'human',
        status: 'sent',
        read: true,
        message_ts: now,
        metadata: {
          source: 'app_send',
          forwarded_from: { session_id: originalMsg.session_id, message_id: originalMsg.id },
        },
      })
      .select()
      .single();

    if (msgError) throw msgError;

    // Update target session — only update last_message if this is the newest message
    await supabaseAdmin
      .from('chat_sessions')
      .update({
        last_message: originalMsg.message_body,
        last_message_at: now,
        last_message_direction: 'outbound',
        last_message_sender: 'human',
        updated_at: now,
      })
      .eq('id', targetSessionId)
      .or(`last_message_at.is.null,last_message_at.lte.${now}`);

    res.json({ message: newMsg });
  } catch (err) {
    next(err);
  }
});

export default router;
