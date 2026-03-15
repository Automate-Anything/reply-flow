// server/src/services/permissionResolver.ts
import { supabaseAdmin } from '../config/supabase.js';

export type AccessLevel = 'no_access' | 'view' | 'reply' | 'manage';

const LEVEL_ORDER: Record<AccessLevel, number> = {
  no_access: 0,
  view: 1,
  reply: 2,
  manage: 3,
};

export function isAtLeast(level: AccessLevel, minimum: AccessLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minimum];
}

/**
 * Resolve a user's access level on a channel.
 * Owner always gets 'manage'. Specific user entry beats all-members entry.
 */
export async function getChannelAccess(
  userId: string,
  channelId: number,
  companyId: string
): Promise<AccessLevel | null> {
  // Check if user is channel owner
  const { data: channel } = await supabaseAdmin
    .from('whatsapp_channels')
    .select('user_id')
    .eq('id', channelId)
    .eq('company_id', companyId)
    .single();

  if (!channel) return null;
  if (channel.user_id === userId) return 'manage';

  // Look for user-specific entry first, then fall back to all-members (NULL)
  const { data: perms } = await supabaseAdmin
    .from('channel_permissions')
    .select('user_id, access_level')
    .eq('channel_id', channelId)
    .or(`user_id.eq.${userId},user_id.is.null`)
    .order('user_id', { ascending: false, nullsFirst: false });

  if (!perms || perms.length === 0) return null;

  // First non-null match is user-specific; otherwise use the NULL (all-members) row
  const specific = perms.find((p) => p.user_id === userId);
  const allMembers = perms.find((p) => p.user_id === null);

  if (specific) return specific.access_level as AccessLevel;
  if (allMembers) return allMembers.access_level as AccessLevel;
  return null;
}

/**
 * Resolve a user's access level on a conversation.
 * Owner always gets 'manage'. Override replaces channel level (not most-restrictive).
 * Channel is the gateway — null/no_access at channel blocks everything.
 *
 * Signature matches old API (userId, sessionId, companyId) so callers don't need changes.
 * channelId is optional — if not provided, it's looked up from the session.
 */
export async function getConversationAccess(
  userId: string,
  sessionId: string,
  companyId: string,
  channelId?: number
): Promise<AccessLevel | null> {
  // Look up channelId if not provided
  let resolvedChannelId: number;
  if (channelId) {
    resolvedChannelId = channelId;
  } else {
    const { data: session } = await supabaseAdmin
      .from('chat_sessions')
      .select('channel_id')
      .eq('id', sessionId)
      .single();
    if (!session?.channel_id) return null;
    resolvedChannelId = session.channel_id;
  }

  // Owner check — always manage on every conversation
  const { data: channel } = await supabaseAdmin
    .from('whatsapp_channels')
    .select('user_id')
    .eq('id', resolvedChannelId)
    .eq('company_id', companyId)
    .single();

  if (!channel) return null;
  if (channel.user_id === userId) return 'manage';

  // Channel gateway
  const channelAccess = await getChannelAccess(userId, resolvedChannelId, companyId);
  if (!channelAccess) return null;
  if (channelAccess === 'no_access') return 'no_access';

  // Look for conversation-level override (specific user beats NULL)
  const { data: convPerms } = await supabaseAdmin
    .from('conversation_permissions')
    .select('user_id, access_level')
    .eq('session_id', sessionId)
    .or(`user_id.eq.${userId},user_id.is.null`)
    .order('user_id', { ascending: false, nullsFirst: false });

  if (!convPerms || convPerms.length === 0) return channelAccess; // Inherit

  const specific = convPerms.find((p) => p.user_id === userId);
  const allUsers = convPerms.find((p) => p.user_id === null);

  if (specific) return specific.access_level as AccessLevel;
  if (allUsers) return allUsers.access_level as AccessLevel;
  return channelAccess; // Inherit
}

/**
 * Get all channel IDs a user can access (not null, not no_access).
 */
export async function getAccessibleChannelIds(
  userId: string,
  companyId: string
): Promise<number[]> {
  // Run all four queries concurrently for performance (hot path)
  const [
    { data: owned },
    { data: allMember },
    { data: specific },
    { data: blocked },
  ] = await Promise.all([
    // Channels user owns
    supabaseAdmin
      .from('whatsapp_channels')
      .select('id')
      .eq('company_id', companyId)
      .eq('user_id', userId),
    // Channels with all-members access (NULL user_id, not no_access)
    supabaseAdmin
      .from('channel_permissions')
      .select('channel_id')
      .eq('company_id', companyId)
      .is('user_id', null)
      .neq('access_level', 'no_access'),
    // Channels with specific user access (not no_access)
    supabaseAdmin
      .from('channel_permissions')
      .select('channel_id')
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .neq('access_level', 'no_access'),
    // Channels where user has explicit no_access
    supabaseAdmin
      .from('channel_permissions')
      .select('channel_id')
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .eq('access_level', 'no_access'),
  ]);

  const ids = new Set<number>();
  owned?.forEach((c) => ids.add(c.id));
  allMember?.forEach((c) => ids.add(c.channel_id));
  specific?.forEach((c) => ids.add(c.channel_id));

  // But don't remove owned channels (owner always has access)
  const ownedIds = new Set(owned?.map((c) => c.id) || []);
  blocked?.forEach((b) => {
    if (!ownedIds.has(b.channel_id)) {
      ids.delete(b.channel_id);
    }
  });

  return Array.from(ids);
}

export type SessionFilter = {
  mode: 'all';
} | {
  mode: 'filtered';
  channelIds: number[];
  excludedSessionIds: string[];
};

export interface OverrideMeta {
  sessionId: string;
  escalationCount: number;
  restrictionCount: number;
  escalationNames: string[];
  restrictionNames: string[];
}

/**
 * Get the filter for accessible sessions + override metadata for shield indicators.
 */
export async function getAccessibleSessions(
  userId: string,
  companyId: string
): Promise<{ filter: SessionFilter; }> {
  const channelIds = await getAccessibleChannelIds(userId, companyId);

  if (channelIds.length === 0) {
    return { filter: { mode: 'filtered', channelIds: [], excludedSessionIds: [] } };
  }

  // Find conversations with no_access overrides for this user or all-users
  const { data: noAccessPerms } = await supabaseAdmin
    .from('conversation_permissions')
    .select('session_id, user_id, access_level')
    .in('company_id', [companyId])
    .or(`user_id.eq.${userId},user_id.is.null`)
    .eq('access_level', 'no_access');

  const excludedSessionIds: string[] = [];

  if (noAccessPerms && noAccessPerms.length > 0) {
    // Group by session_id to resolve specific-vs-null priority
    const bySession = new Map<string, typeof noAccessPerms>();
    for (const p of noAccessPerms) {
      const list = bySession.get(p.session_id) || [];
      list.push(p);
      bySession.set(p.session_id, list);
    }

    for (const [sessionId, perms] of bySession) {
      const userSpecific = perms.find((p) => p.user_id === userId);
      const allUsers = perms.find((p) => p.user_id === null);

      if (userSpecific) {
        // User has explicit no_access
        excludedSessionIds.push(sessionId);
      } else if (allUsers) {
        // All-users no_access — check if user has a specific override that reinstates
        const { data: reinstated } = await supabaseAdmin
          .from('conversation_permissions')
          .select('access_level')
          .eq('session_id', sessionId)
          .eq('user_id', userId)
          .neq('access_level', 'no_access')
          .limit(1);

        if (!reinstated || reinstated.length === 0) {
          excludedSessionIds.push(sessionId);
        }
      }
    }
  }

  return {
    filter: { mode: 'filtered', channelIds, excludedSessionIds },
  };
}

/**
 * Get override metadata for a batch of session IDs (for shield indicators).
 * Call this with the session IDs from the current page/batch.
 *
 * NOTE: Escalation/restriction is determined by comparing the conversation override
 * against the channel's all-members default level. This is a simplification — ideally
 * we'd compare against each user's specific channel access, but that requires N lookups.
 * For the shield indicator (which is a summary), the all-members default is a reasonable
 * approximation. The full per-user comparison happens in the conversation access panel.
 */
export async function getOverrideMetadata(
  sessionIds: string[],
  companyId: string
): Promise<OverrideMeta[]> {
  if (sessionIds.length === 0) return [];

  // Get all conversation_permissions for these sessions
  const { data: perms } = await supabaseAdmin
    .from('conversation_permissions')
    .select('session_id, user_id, access_level, user:user_id(full_name)')
    .eq('company_id', companyId)
    .in('session_id', sessionIds);

  if (!perms || perms.length === 0) return [];

  // For each session, we need to know the channel-level access to determine
  // if an override is an escalation or restriction.
  // Get channel info for these sessions
  const { data: sessions } = await supabaseAdmin
    .from('chat_sessions')
    .select('id, channel_id')
    .in('id', sessionIds);

  const sessionChannelMap = new Map<string, number>();
  sessions?.forEach((s) => {
    if (s.channel_id) sessionChannelMap.set(s.id, s.channel_id);
  });

  // Get channel-level defaults (the NULL user_id rows)
  const channelIds = [...new Set(sessionChannelMap.values())];
  const { data: channelDefaults } = await supabaseAdmin
    .from('channel_permissions')
    .select('channel_id, access_level')
    .in('channel_id', channelIds)
    .is('user_id', null);

  const channelDefaultLevel = new Map<number, AccessLevel>();
  channelDefaults?.forEach((cd) => {
    channelDefaultLevel.set(cd.channel_id, cd.access_level as AccessLevel);
  });

  // Group overrides by session
  const bySession = new Map<string, typeof perms>();
  for (const p of perms) {
    const list = bySession.get(p.session_id) || [];
    list.push(p);
    bySession.set(p.session_id, list);
  }

  const result: OverrideMeta[] = [];

  for (const [sessionId, overrides] of bySession) {
    const channelId = sessionChannelMap.get(sessionId);
    const defaultLevel = channelId ? channelDefaultLevel.get(channelId) : undefined;
    const defaultOrder = defaultLevel ? LEVEL_ORDER[defaultLevel] : LEVEL_ORDER.reply;

    let escalationCount = 0;
    let restrictionCount = 0;
    const escalationNames: string[] = [];
    const restrictionNames: string[] = [];

    for (const o of overrides) {
      const overrideOrder = LEVEL_ORDER[o.access_level as AccessLevel];
      const name = (o.user as any)?.full_name || 'All users';

      if (overrideOrder > defaultOrder) {
        escalationCount++;
        escalationNames.push(name);
      } else if (overrideOrder < defaultOrder) {
        restrictionCount++;
        restrictionNames.push(name);
      }
      // Equal = redundant override, don't count
    }

    if (escalationCount > 0 || restrictionCount > 0) {
      result.push({ sessionId, escalationCount, restrictionCount, escalationNames, restrictionNames });
    }
  }

  return result;
}

/**
 * Auto-grant conversation access when a user is assigned.
 * Only creates/upgrades override if user doesn't already have reply+ access.
 */
export async function ensureConversationAccessOnAssign(
  sessionId: string,
  assignedUserId: string,
  grantedByUserId: string,
  companyId: string
): Promise<void> {
  // Get the session's channel
  const { data: session } = await supabaseAdmin
    .from('chat_sessions')
    .select('channel_id')
    .eq('id', sessionId)
    .single();

  if (!session?.channel_id) return;

  // Check if user has channel access
  const channelAccess = await getChannelAccess(assignedUserId, session.channel_id, companyId);
  if (!channelAccess || channelAccess === 'no_access') return; // Can't assign without channel access

  // Check current conversation access — NOTE: correct param order is (userId, sessionId, companyId, channelId?)
  const convAccess = await getConversationAccess(
    assignedUserId, sessionId, companyId, session.channel_id
  );

  // If already reply or manage, no action needed
  if (convAccess && isAtLeast(convAccess, 'reply')) return;

  // Upsert a reply override
  await supabaseAdmin
    .from('conversation_permissions')
    .upsert(
      {
        session_id: sessionId,
        user_id: assignedUserId,
        access_level: 'reply',
        granted_by: grantedByUserId,
        company_id: companyId,
      },
      { onConflict: 'session_id,user_id' }
    );
}
