import { supabaseAdmin } from '../config/supabase.js';

interface AutoAssignResult {
  assignedTo: string | null;
  ruleName: string | null;
}

/**
 * Determine who to assign a new conversation to based on the channel's auto-assign rule.
 * Returns null if no rule applies or no members are available.
 */
export async function autoAssignConversation(
  companyId: string,
  channelId: number,
  contactTags: string[]
): Promise<AutoAssignResult> {
  // Find applicable rule: channel-specific first, then company-wide fallback
  const { data: rule } = await supabaseAdmin
    .from('auto_assign_rules')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .or(`channel_id.eq.${channelId},channel_id.is.null`)
    .order('channel_id', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (!rule) return { assignedTo: null, ruleName: null };

  // Get available members for this rule
  const { data: members } = await supabaseAdmin
    .from('auto_assign_members')
    .select('*')
    .eq('rule_id', rule.id)
    .eq('is_available', true);

  if (!members || members.length === 0) return { assignedTo: null, ruleName: null };

  let assignedUserId: string | null = null;

  switch (rule.strategy) {
    case 'round_robin':
      assignedUserId = roundRobin(members);
      break;
    case 'least_busy':
      assignedUserId = await leastBusy(members, companyId);
      break;
    case 'tag_based':
      assignedUserId = await tagBased(members, contactTags, rule.config);
      break;
  }

  if (assignedUserId) {
    // Update last_assigned_at for round-robin tracking
    await supabaseAdmin
      .from('auto_assign_members')
      .update({ last_assigned_at: new Date().toISOString() })
      .eq('rule_id', rule.id)
      .eq('user_id', assignedUserId);
  }

  return { assignedTo: assignedUserId, ruleName: rule.strategy };
}

/**
 * Round-robin: assign to the available member who was assigned longest ago (or never).
 */
function roundRobin(
  members: { user_id: string; last_assigned_at: string | null }[]
): string | null {
  // Sort: null (never assigned) first, then oldest last_assigned_at
  const sorted = [...members].sort((a, b) => {
    if (!a.last_assigned_at && !b.last_assigned_at) return 0;
    if (!a.last_assigned_at) return -1;
    if (!b.last_assigned_at) return 1;
    return new Date(a.last_assigned_at).getTime() - new Date(b.last_assigned_at).getTime();
  });
  return sorted[0]?.user_id ?? null;
}

/**
 * Least-busy: assign to the available member with the fewest open conversations.
 */
async function leastBusy(
  members: { user_id: string }[],
  companyId: string
): Promise<string | null> {
  const userIds = members.map((m) => m.user_id);

  // Count open conversations per member
  const { data: counts } = await supabaseAdmin
    .from('chat_sessions')
    .select('assigned_to')
    .eq('company_id', companyId)
    .in('assigned_to', userIds)
    .in('status', ['open', 'pending']);

  const countMap = new Map<string, number>();
  for (const uid of userIds) countMap.set(uid, 0);
  for (const row of counts || []) {
    if (row.assigned_to) {
      countMap.set(row.assigned_to, (countMap.get(row.assigned_to) || 0) + 1);
    }
  }

  // Find member with fewest open conversations
  let minCount = Infinity;
  let minUser: string | null = null;
  for (const [userId, count] of countMap) {
    if (count < minCount) {
      minCount = count;
      minUser = userId;
    }
  }
  return minUser;
}

/**
 * Tag-based: match contact tags to configured routes.
 * Falls back to round-robin if no tag matches.
 *
 * config.tag_routes: Array<{ tag: string; user_id: string }>
 * config.fallback_strategy: 'round_robin' | 'least_busy' (defaults to 'round_robin')
 */
async function tagBased(
  members: { user_id: string; last_assigned_at: string | null }[],
  contactTags: string[],
  config: { tag_routes?: { tag: string; user_id: string }[]; fallback_strategy?: string }
): Promise<string | null> {
  const routes = config.tag_routes || [];
  const availableUserIds = new Set(members.map((m) => m.user_id));

  // Check each contact tag against routes
  for (const contactTag of contactTags) {
    const route = routes.find((r) => r.tag.toLowerCase() === contactTag.toLowerCase());
    if (route && availableUserIds.has(route.user_id)) {
      return route.user_id;
    }
  }

  // Fallback to round-robin
  return roundRobin(members);
}
