import { supabaseAdmin } from '../config/supabase.js';

interface CreateNotificationParams {
  companyId: string;
  userId: string;
  type: string;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
}

const PREFERENCE_DEFAULTS: Record<string, boolean> = {
  assignment: true,
  share: true,
  message_assigned: true,
  message_accessible: false,
  snooze_set: true,
  schedule_set: true,
  schedule_sent: true,
  status_change: true,
  contact_note: true,
};

/**
 * Create a notification for a user, respecting their preferences.
 * Returns without creating if the user has disabled this notification type.
 */
export async function createNotification(params: CreateNotificationParams): Promise<void> {
  const { companyId, userId, type, title, body, data } = params;

  // Check user preferences
  const { data: prefs } = await supabaseAdmin
    .from('notification_preferences')
    .select('preferences')
    .eq('user_id', userId)
    .maybeSingle();

  const userPrefs = (prefs?.preferences as Record<string, boolean> | null) || PREFERENCE_DEFAULTS;
  if (userPrefs[type] === false) return;

  await supabaseAdmin
    .from('notifications')
    .insert({
      company_id: companyId,
      user_id: userId,
      type,
      title,
      body: body || null,
      data: data || {},
    });
}

/**
 * Create notifications for multiple users at once.
 * Checks each user's preferences individually.
 */
export async function createNotificationsForUsers(
  companyId: string,
  userIds: string[],
  type: string,
  title: string,
  body?: string,
  data?: Record<string, unknown>
): Promise<void> {
  if (userIds.length === 0) return;

  // Batch check preferences
  const { data: allPrefs } = await supabaseAdmin
    .from('notification_preferences')
    .select('user_id, preferences')
    .in('user_id', userIds);

  const prefsMap = new Map(
    (allPrefs || []).map((p) => [p.user_id, p.preferences as Record<string, boolean>])
  );

  const rows = userIds
    .filter((uid) => {
      const userPrefs = prefsMap.get(uid) || PREFERENCE_DEFAULTS;
      return userPrefs[type] !== false;
    })
    .map((uid) => ({
      company_id: companyId,
      user_id: uid,
      type,
      title,
      body: body || null,
      data: data || {},
    }));

  if (rows.length > 0) {
    await supabaseAdmin.from('notifications').insert(rows);
  }
}
