import { supabaseAdmin } from '../config/supabase.js';
import { evaluateGroupCriteria } from './groupCriteriaService.js';
import type { GroupChat, GroupChatMessage } from '../types/index.js';
import type { WhapiIncomingMessage } from '../types/webhook.js';

export async function processGroupMessage(
  msg: WhapiIncomingMessage,
  companyId: string,
  channelId: string
): Promise<void> {
  const groupJid = msg.chat_id;

  // 1. Look up or auto-create the group
  let { data: group } = await supabaseAdmin
    .from('group_chats')
    .select('*')
    .eq('channel_id', channelId)
    .eq('group_jid', groupJid)
    .single();

  if (!group) {
    // Auto-create with monitoring disabled
    const { data: newGroup, error } = await supabaseAdmin
      .from('group_chats')
      .insert({
        company_id: companyId,
        channel_id: channelId,
        group_jid: groupJid,
        group_name: null, // Will be updated when metadata is available
        monitoring_enabled: false,
      })
      .select()
      .single();

    if (error) {
      console.error('[group] Failed to auto-create group:', error);
      return;
    }
    group = newGroup;
  }

  // 2. If monitoring is disabled, stop here
  if (!group.monitoring_enabled) return;

  // 3. Store the message
  const messageBody = msg.text?.body ?? null;
  const senderPhone = msg.from ?? null;
  const senderName = msg.from_name ?? null;
  const messageType = msg.type ?? 'text';

  const { data: storedMessage, error: msgError } = await supabaseAdmin
    .from('group_chat_messages')
    .upsert(
      {
        company_id: companyId,
        group_chat_id: group.id,
        whatsapp_message_id: msg.id,
        sender_phone: senderPhone,
        sender_name: senderName,
        message_body: messageBody,
        message_type: messageType,
        metadata: msg,
      },
      { onConflict: 'group_chat_id,whatsapp_message_id' }
    )
    .select()
    .single();

  if (msgError) {
    console.error('[group] Failed to store group message:', msgError);
    return;
  }

  // 4. Evaluate criteria (only for text messages with content)
  if (messageBody && messageType === 'text') {
    await evaluateGroupCriteria(storedMessage as GroupChatMessage, group as GroupChat);
  }
}
