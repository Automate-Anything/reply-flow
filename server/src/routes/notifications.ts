import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(requireAuth);

// List notifications for current user (paginated, newest first)
router.get('/', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { limit = '30', offset = '0', unread_only } = req.query;

    let query = supabaseAdmin
      .from('notifications')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (unread_only === 'true') {
      query = query.eq('is_read', false);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    // Also get unread count
    const { count: unreadCount } = await supabaseAdmin
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    res.json({ notifications: data || [], count, unread_count: unreadCount || 0 });
  } catch (err) {
    next(err);
  }
});

// Mark single notification as read
router.patch('/:notificationId/read', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { notificationId } = req.params;

    await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId)
      .eq('user_id', userId);

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// Mark all notifications as read
router.patch('/read-all', async (req, res, next) => {
  try {
    const userId = req.userId!;

    await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// Get notification preferences
router.get('/preferences', async (req, res, next) => {
  try {
    const userId = req.userId!;

    const { data } = await supabaseAdmin
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    const defaults = {
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

    res.json({ preferences: (data?.preferences as Record<string, boolean>) || defaults });
  } catch (err) {
    next(err);
  }
});

// Update notification preferences
router.put('/preferences', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { preferences } = req.body;

    const { data, error } = await supabaseAdmin
      .from('notification_preferences')
      .upsert(
        { user_id: userId, preferences, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      )
      .select()
      .single();

    if (error) throw error;
    res.json({ preferences: data.preferences });
  } catch (err) {
    next(err);
  }
});

export default router;
