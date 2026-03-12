import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';
import * as whapi from '../services/whapi.js';
import { getSignedUrl, downloadAndStore, storeBuffer } from '../services/mediaStorage.js';

const router = Router();
router.use(requireAuth);

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
      .from('whatsapp_channels')
      .select('channel_token')
      .eq('id', session.channel_id)
      .eq('channel_status', 'connected')
      .single();

    if (!channel) {
      res.status(400).json({ error: 'No connected WhatsApp channel for this conversation' });
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

    // Send via Whapi
    const chatId = session.chat_id.includes('@')
      ? session.chat_id
      : `${session.chat_id}@s.whatsapp.net`;

    const result = await whapi.sendTextMessage(channel.channel_token, chatId, body, whapiQuotedId);
    console.log('[send] whapi result:', JSON.stringify(result));

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
        message_id_normalized: (result as Record<string, unknown> & { message?: { id?: string } })?.message?.id || (result as Record<string, string>)?.message_id || null,
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
    await supabaseAdmin
      .from('chat_sessions')
      .update({
        last_message: body,
        last_message_at: now,
        last_message_direction: 'outbound',
        last_message_sender: 'human',
        updated_at: now,
        draft_message: null,
      })
      .eq('id', sessionId)
      .or(`last_message_at.is.null,last_message_at.lte.${now}`);

    res.json({ message });
  } catch (err) {
    next(err);
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
      .from('whatsapp_channels')
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
    .from('whatsapp_channels')
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
        .from('whatsapp_channels')
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
