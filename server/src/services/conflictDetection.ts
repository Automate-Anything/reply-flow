// server/src/services/conflictDetection.ts
import { supabaseAdmin } from '../config/supabase.js';
import { getChannelAccess, AccessLevel } from './permissionResolver.js';

export interface PermissionConflict {
  userId: string;
  userName: string;
  sessionIds: string[];
  currentChannelLevel: AccessLevel;
  conversationOverrides: Array<{
    sessionId: string;
    accessLevel: AccessLevel;
  }>;
}

export interface ConflictResolution {
  userId: string;
  action: 'keep' | 'remove';
}

/**
 * Detect which users will lose channel access and have active conversation overrides.
 * Called BEFORE applying channel permission changes.
 *
 * @param channelId - The channel being modified
 * @param companyId - Company scope
 * @param usersLosingAccess - User IDs that will have null/no_access after the change
 */
export async function detectConflicts(
  channelId: number,
  companyId: string,
  usersLosingAccess: string[]
): Promise<PermissionConflict[]> {
  if (usersLosingAccess.length === 0) return [];

  // Get all sessions in this channel
  const { data: sessions } = await supabaseAdmin
    .from('chat_sessions')
    .select('id')
    .eq('channel_id', channelId)
    .is('deleted_at', null);

  if (!sessions || sessions.length === 0) return [];

  const sessionIds = sessions.map((s) => s.id);

  // Find conversation overrides for the affected users (not no_access — those are already blocks)
  const { data: overrides } = await supabaseAdmin
    .from('conversation_permissions')
    .select('session_id, user_id, access_level, user:user_id(full_name)')
    .in('session_id', sessionIds)
    .in('user_id', usersLosingAccess)
    .neq('access_level', 'no_access');

  if (!overrides || overrides.length === 0) return [];

  // Group by user
  const byUser = new Map<string, PermissionConflict>();

  for (const o of overrides) {
    if (!o.user_id) continue;

    let conflict = byUser.get(o.user_id);
    if (!conflict) {
      conflict = {
        userId: o.user_id,
        userName: (o.user as any)?.full_name || 'Unknown',
        sessionIds: [],
        currentChannelLevel: 'reply', // Will be resolved below
        conversationOverrides: [],
      };
      byUser.set(o.user_id, conflict);
    }

    conflict.sessionIds.push(o.session_id);
    conflict.conversationOverrides.push({
      sessionId: o.session_id,
      accessLevel: o.access_level as AccessLevel,
    });
  }

  // Resolve current channel access for each affected user
  for (const conflict of byUser.values()) {
    const access = await getChannelAccess(conflict.userId, channelId, companyId);
    conflict.currentChannelLevel = access || 'no_access';
  }

  return Array.from(byUser.values());
}

/**
 * Compute which users will lose channel access given a proposed change.
 * Compares current permissions with proposed new state.
 */
export async function computeUsersLosingAccess(
  channelId: number,
  companyId: string,
  proposedChange: {
    removeAllMembersRow?: boolean;
    removeUserIds?: string[];
    addNoAccessUserIds?: string[];
  }
): Promise<string[]> {
  const losingAccess: string[] = [];

  // Users being explicitly removed
  if (proposedChange.removeUserIds) {
    losingAccess.push(...proposedChange.removeUserIds);
  }

  // Users getting explicit no_access
  if (proposedChange.addNoAccessUserIds) {
    losingAccess.push(...proposedChange.addNoAccessUserIds);
  }

  // If removing all-members row, find all company members who don't have
  // individual channel_permissions entries
  if (proposedChange.removeAllMembersRow) {
    const { data: companyMembers } = await supabaseAdmin
      .from('company_members')
      .select('user_id')
      .eq('company_id', companyId);

    const { data: individualPerms } = await supabaseAdmin
      .from('channel_permissions')
      .select('user_id')
      .eq('channel_id', channelId)
      .not('user_id', 'is', null);

    // Channel owner
    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('user_id')
      .eq('id', channelId)
      .single();

    const hasIndividualPerm = new Set(individualPerms?.map((p) => p.user_id) || []);
    const ownerId = channel?.user_id;

    for (const member of companyMembers || []) {
      if (member.user_id !== ownerId && !hasIndividualPerm.has(member.user_id)) {
        losingAccess.push(member.user_id);
      }
    }
  }

  return [...new Set(losingAccess)]; // Deduplicate
}

/**
 * Apply conflict resolutions atomically.
 * For 'keep' users: add them to channel with 'view' (minimum access).
 * For 'remove' users: delete their conversation overrides.
 */
export async function applyConflictResolutions(
  channelId: number,
  companyId: string,
  grantedBy: string,
  resolutions: ConflictResolution[]
): Promise<void> {
  const keepUsers = resolutions.filter((r) => r.action === 'keep');
  const removeUsers = resolutions.filter((r) => r.action === 'remove');

  // Get session IDs for this channel
  const { data: sessions } = await supabaseAdmin
    .from('chat_sessions')
    .select('id')
    .eq('channel_id', channelId)
    .is('deleted_at', null);

  const sessionIds = sessions?.map((s) => s.id) || [];

  // For 'keep' users: upsert channel_permissions with 'view'
  for (const user of keepUsers) {
    await supabaseAdmin
      .from('channel_permissions')
      .upsert(
        {
          channel_id: channelId,
          user_id: user.userId,
          access_level: 'view',
          granted_by: grantedBy,
          company_id: companyId,
        },
        { onConflict: 'channel_id,user_id' }
      );
  }

  // For 'remove' users: delete their conversation overrides in this channel
  if (removeUsers.length > 0 && sessionIds.length > 0) {
    const removeUserIds = removeUsers.map((r) => r.userId);
    await supabaseAdmin
      .from('conversation_permissions')
      .delete()
      .in('session_id', sessionIds)
      .in('user_id', removeUserIds);
  }
}
