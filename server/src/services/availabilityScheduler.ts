import { supabaseAdmin } from '../config/supabase.js';
import { isWithinSchedule, type BusinessHours } from './ai.js';

const POLL_INTERVAL_MS = 60_000; // 1 minute

export function startAvailabilityScheduler() {
  console.log('Availability scheduler started (polling every 60s)');
  evaluateAvailability().catch(err => console.error('Initial availability check failed:', err));
  setInterval(() => {
    evaluateAvailability().catch(err => console.error('Availability scheduler error:', err));
  }, POLL_INTERVAL_MS);
}

async function evaluateAvailability() {
  // 1. Fetch all users with hours_control_availability = true AND personal_hours IS NOT NULL
  const { data: users, error } = await supabaseAdmin
    .from('users')
    .select('id, timezone, personal_hours, availability_override_until, company_id')
    .eq('hours_control_availability', true)
    .not('personal_hours', 'is', null);

  if (error || !users?.length) return;

  // 2. Batch fetch company timezones
  const companyIds = [...new Set(users.map(u => u.company_id).filter(Boolean))];
  const { data: companies } = await supabaseAdmin
    .from('companies')
    .select('id, timezone')
    .in('id', companyIds);
  const companyTzMap = new Map((companies || []).map(c => [c.id, c.timezone]));

  // 3. Fetch all holidays for these companies
  const { data: holidays } = await supabaseAdmin
    .from('holidays')
    .select('company_id, user_id, scope, date, recurring')
    .in('company_id', companyIds);

  const now = new Date();

  for (const user of users) {
    try {
      // Skip if manual override is active
      if (user.availability_override_until) {
        const overrideUntil = new Date(user.availability_override_until);
        if (now < overrideUntil) continue;
        // Override expired — clear it
        await supabaseAdmin
          .from('users')
          .update({ availability_override_until: null })
          .eq('id', user.id);
      }

      const tz = user.timezone || companyTzMap.get(user.company_id) || 'UTC';

      // Check if today is a holiday for this user
      const isHoliday = checkIsHoliday(holidays || [], user.id, user.company_id, tz, now);

      let shouldBeAvailable: boolean;
      if (isHoliday) {
        shouldBeAvailable = false;
      } else {
        shouldBeAvailable = isWithinSchedule(user.personal_hours as BusinessHours, tz);
      }

      // Update all auto_assign_members rows for this user
      await supabaseAdmin
        .from('auto_assign_members')
        .update({ is_available: shouldBeAvailable })
        .eq('user_id', user.id);
    } catch (err) {
      console.error(`Availability check failed for user ${user.id}:`, err);
    }
  }
}

function checkIsHoliday(
  holidays: Array<{ company_id: string; user_id: string | null; scope: string; date: string; recurring: boolean }>,
  userId: string,
  companyId: string,
  tz: string,
  now: Date
): boolean {
  // Get today's date in user's timezone (YYYY-MM-DD format)
  const todayDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
  const todayMMDD = todayDate.slice(5); // "MM-DD"

  for (const h of holidays) {
    if (h.company_id !== companyId) continue;
    // User holidays: must match this user
    if (h.scope === 'user' && h.user_id !== userId) continue;

    if (h.recurring) {
      if (h.date.slice(5) === todayMMDD) return true;
    } else {
      if (h.date === todayDate) return true;
    }
  }
  return false;
}
