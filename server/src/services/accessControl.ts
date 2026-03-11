import { supabaseAdmin } from '../config/supabase.js';

/**
 * Determines whether a user can access a specific channel.
 * Returns the effective access level ('edit' | 'view') or null if no access.
 */
export async function getChannelAccess(
  userId: string,
  channelId: number,
  companyId: string
): Promise<'edit' | 'view' | null> {
  // 1. Fetch channel
  const { data: channel } = await supabaseAdmin
    .from('whatsapp_channels')
    .select('user_id, sharing_mode, company_id')
    .eq('id', channelId)
    .single();

  if (!channel) return null;

  // Must be in the same company
  if (channel.company_id !== companyId) return null;

  // Channel owner always has edit access
  if (channel.user_id === userId) return 'edit';

  // Check sharing mode
  if (channel.sharing_mode === 'private') return null;

  if (channel.sharing_mode === 'all_members') {
    // Any company member gets edit access (backward compatible)
    return 'edit';
  }

  if (channel.sharing_mode === 'specific_users') {
    const { data: access } = await supabaseAdmin
      .from('channel_access')
      .select('access_level')
      .eq('channel_id', channelId)
      .eq('user_id', userId)
      .single();

    return (access?.access_level as 'edit' | 'view') || null;
  }

  return null;
}

/**
 * Determines whether a user can access a specific conversation.
 * Returns the effective access level ('edit' | 'view') or null if no access.
 *
 * Access is the most restrictive of channel access and conversation access.
 */
export async function getConversationAccess(
  userId: string,
  sessionId: string,
  companyId: string
): Promise<'edit' | 'view' | null> {
  // 1. Fetch session with its channel info
  const { data: session } = await supabaseAdmin
    .from('chat_sessions')
    .select('channel_id, company_id')
    .eq('id', sessionId)
    .single();

  if (!session || session.company_id !== companyId) return null;

  // 2. Check channel access first
  const channelAccess = await getChannelAccess(userId, session.channel_id, companyId);
  if (!channelAccess) return null;

  // 3. Fetch channel to check conversation visibility setting
  const { data: channel } = await supabaseAdmin
    .from('whatsapp_channels')
    .select('user_id, default_conversation_visibility')
    .eq('id', session.channel_id)
    .single();

  if (!channel) return null;

  // Channel owner always has full access
  if (channel.user_id === userId) return 'edit';

  // If all conversations are visible, use channel access level
  if (channel.default_conversation_visibility === 'all') return channelAccess;

  // owner_only mode: check conversation_access table
  const { data: convAccess } = await supabaseAdmin
    .from('conversation_access')
    .select('access_level')
    .eq('session_id', sessionId)
    .or(`user_id.eq.${userId},user_id.is.null`)
    .order('user_id', { ascending: false, nullsFirst: false }) // prefer specific user over NULL
    .limit(1)
    .single();

  if (!convAccess) return null;

  // Effective access is the most restrictive of channel and conversation access
  const convLevel = convAccess.access_level as 'edit' | 'view';
  if (channelAccess === 'view' || convLevel === 'view') return 'view';
  return 'edit';
}

/**
 * Determines whether a user can access a specific contact.
 * Returns the effective access level ('edit' | 'view') or null if no access.
 */
export async function getContactAccess(
  userId: string,
  contactId: string,
  companyId: string
): Promise<'edit' | 'view' | null> {
  const { data: contact } = await supabaseAdmin
    .from('contacts')
    .select('owner_id, sharing_mode, company_id')
    .eq('id', contactId)
    .single();

  if (!contact || contact.company_id !== companyId) return null;

  // Contact owner always has edit access
  if (contact.owner_id === userId) return 'edit';

  if (contact.sharing_mode === 'private') return null;

  if (contact.sharing_mode === 'all_members') return 'edit';

  if (contact.sharing_mode === 'specific_users') {
    const { data: access } = await supabaseAdmin
      .from('contact_access')
      .select('access_level')
      .eq('contact_id', contactId)
      .eq('user_id', userId)
      .single();

    return (access?.access_level as 'edit' | 'view') || null;
  }

  return null;
}

/**
 * Returns an array of channel IDs that a user can access.
 * Used for filtering conversations and messages.
 */
export async function getAccessibleChannelIds(
  userId: string,
  companyId: string
): Promise<number[]> {
  const [
    { data: ownedChannels },
    { data: allMemberChannels },
    { data: specificAccess },
  ] = await Promise.all([
    supabaseAdmin
      .from('whatsapp_channels')
      .select('id')
      .eq('company_id', companyId)
      .eq('user_id', userId),
    supabaseAdmin
      .from('whatsapp_channels')
      .select('id')
      .eq('company_id', companyId)
      .eq('sharing_mode', 'all_members')
      .neq('user_id', userId),
    supabaseAdmin
      .from('channel_access')
      .select('channel_id')
      .eq('user_id', userId),
  ]);

  const ownedIds = (ownedChannels || []).map((c) => c.id);
  const allMemberIds = (allMemberChannels || []).map((c) => c.id);
  const specificIds = (specificAccess || []).map((a) => a.channel_id);

  // Combine and deduplicate
  const allIds = [...new Set([...ownedIds, ...allMemberIds, ...specificIds])];
  return allIds;
}

/**
 * Returns an array of conversation IDs that a user can access,
 * taking into account channel access AND conversation-level visibility.
 *
 * This is the main filtering function for the conversations list.
 * Returns null if the user can see ALL conversations (no filtering needed),
 * or an array of specific session IDs they can see.
 */
export async function getAccessibleSessionFilter(
  userId: string,
  companyId: string
): Promise<{ mode: 'all' } | { mode: 'filtered'; channelIds: number[]; extraSessionIds: string[] }> {
  const accessibleChannelIds = await getAccessibleChannelIds(userId, companyId);

  if (accessibleChannelIds.length === 0) {
    return { mode: 'filtered', channelIds: [], extraSessionIds: [] };
  }

  // Check which of these channels have owner_only conversation visibility
  // and the user is NOT the owner
  const [
    { data: ownerOnlyChannels },
    { count: companyChannelCount },
  ] = await Promise.all([
    supabaseAdmin
      .from('whatsapp_channels')
      .select('id')
      .in('id', accessibleChannelIds)
      .eq('default_conversation_visibility', 'owner_only')
      .neq('user_id', userId),
    supabaseAdmin
      .from('whatsapp_channels')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId),
  ]);

  const ownerOnlyIds = (ownerOnlyChannels || []).map((c) => c.id);

  // Channels where the user sees ALL conversations (either owner or visibility=all)
  const fullAccessChannelIds = accessibleChannelIds.filter(
    (id) => !ownerOnlyIds.includes(id)
  );

  if (ownerOnlyIds.length === 0) {
    // User sees all conversations in all their accessible channels
    // Check if this is ALL company channels
    if (companyChannelCount === accessibleChannelIds.length) {
      return { mode: 'all' };
    }

    return { mode: 'filtered', channelIds: fullAccessChannelIds, extraSessionIds: [] };
  }

  // For owner_only channels, get specifically granted conversation IDs
  const { data: grantedConversations } = await supabaseAdmin
    .from('conversation_access')
    .select('session_id, chat_sessions!inner(channel_id)')
    .or(`user_id.eq.${userId},user_id.is.null`)
    .in('chat_sessions.channel_id', ownerOnlyIds);

  const extraSessionIds = (grantedConversations || []).map((g) => g.session_id);

  return {
    mode: 'filtered',
    channelIds: fullAccessChannelIds,
    extraSessionIds,
  };
}

/**
 * Ensures a user has conversation_access when they are assigned to a conversation.
 * If the channel has owner_only visibility, auto-creates a conversation_access entry.
 */
export async function ensureConversationAccessOnAssign(
  sessionId: string,
  assignedUserId: string,
  grantedByUserId: string
): Promise<void> {
  // Check if the channel uses owner_only visibility
  const { data: session } = await supabaseAdmin
    .from('chat_sessions')
    .select('channel_id')
    .eq('id', sessionId)
    .single();

  if (!session) return;

  const { data: channel } = await supabaseAdmin
    .from('whatsapp_channels')
    .select('default_conversation_visibility, user_id')
    .eq('id', session.channel_id)
    .single();

  if (!channel) return;

  // If the assigned user is the channel owner, no need for explicit access
  if (channel.user_id === assignedUserId) return;

  // If conversations are visible to all, no need for explicit access
  if (channel.default_conversation_visibility === 'all') return;

  // Auto-grant edit access to the assigned user
  await supabaseAdmin
    .from('conversation_access')
    .upsert(
      {
        session_id: sessionId,
        user_id: assignedUserId,
        access_level: 'edit',
        granted_by: grantedByUserId,
      },
      { onConflict: 'session_id,user_id' }
    );
}
