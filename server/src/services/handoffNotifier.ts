import { supabaseAdmin } from '../config/supabase.js';
import { createNotification } from './notificationService.js';

/**
 * Sends a handoff notification to the right person:
 * - If the conversation is assigned → notify the assignee
 * - If unassigned → notify the channel owner
 *
 * Skips notification if the triggering user is the same as the target.
 */
export async function sendHandoffNotification(
  companyId: string,
  sessionId: string,
  reason?: string,
  triggeredByUserId?: string,
): Promise<void> {
  // Get session details: assigned_to, channel_id, contact info
  const { data: session } = await supabaseAdmin
    .from('chat_sessions')
    .select('assigned_to, channel_id, contact_name, phone_number')
    .eq('id', sessionId)
    .eq('company_id', companyId)
    .single();

  if (!session) return;

  const contactName = session.contact_name || session.phone_number || 'Unknown';
  let targetUserId: string | null = session.assigned_to;

  // If no one is assigned, fall back to the channel owner
  if (!targetUserId && session.channel_id) {
    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('user_id')
      .eq('id', session.channel_id)
      .eq('company_id', companyId)
      .single();

    targetUserId = channel?.user_id || null;
  }

  if (!targetUserId) return;

  // Don't notify the user who triggered the handoff
  if (triggeredByUserId && targetUserId === triggeredByUserId) return;

  const body = reason
    ? `Conversation with ${contactName} needs attention: ${reason}`
    : `Conversation with ${contactName} needs human attention`;

  await createNotification({
    companyId,
    userId: targetUserId,
    type: 'handoff',
    title: 'Human handoff',
    body,
    data: { conversation_id: sessionId, contact_name: contactName },
  });
}
