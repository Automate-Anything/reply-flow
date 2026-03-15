import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(requireAuth);

// GET /api/team/availability — team availability dashboard data
router.get('/', async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    // Fetch company members with user data and role name
    const { data: members, error: membersError } = await supabaseAdmin
      .from('company_members')
      .select('user_id, role:roles(name), user:user_id(full_name, email, avatar_url, timezone, personal_hours, hours_control_availability)')
      .eq('company_id', companyId);

    if (membersError) throw membersError;

    // Collect all user_ids
    const userIds = (members || []).map((m) => m.user_id);

    // Fetch auto_assign_members for availability status
    const { data: assignMembers } = await supabaseAdmin
      .from('auto_assign_members')
      .select('user_id, is_available')
      .in('user_id', userIds.length > 0 ? userIds : ['__none__']);

    // Build a map of user_id -> is_available (available if no memberships or all are available)
    const availabilityMap = new Map<string, boolean>();
    if (assignMembers) {
      const grouped = new Map<string, boolean[]>();
      for (const am of assignMembers) {
        if (!grouped.has(am.user_id)) grouped.set(am.user_id, []);
        grouped.get(am.user_id)!.push(am.is_available);
      }
      for (const [uid, statuses] of grouped) {
        availabilityMap.set(uid, statuses.every((s) => s));
      }
    }

    // Fetch company timezone
    const { data: companyData } = await supabaseAdmin
      .from('companies')
      .select('timezone')
      .eq('id', companyId)
      .single();

    const companyTimezone = companyData?.timezone || 'UTC';

    // Build response
    const result = (members || []).map((m) => {
      const user = m.user as unknown as Record<string, unknown> | null;
      const role = m.role as unknown as { name: string } | null;
      const userId = m.user_id as string;

      return {
        user_id: userId,
        full_name: (user?.full_name as string) || null,
        email: (user?.email as string) || null,
        avatar_url: (user?.avatar_url as string) || null,
        role: role?.name || null,
        timezone: (user?.timezone as string) || companyTimezone,
        personal_hours: user?.personal_hours ?? null,
        hours_controlled: Boolean(user?.hours_control_availability),
        is_available: availabilityMap.has(userId) ? availabilityMap.get(userId)! : true,
      };
    });

    res.json({ members: result, company_timezone: companyTimezone });
  } catch (err) {
    next(err);
  }
});

export default router;
