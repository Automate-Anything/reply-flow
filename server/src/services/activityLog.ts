import { supabaseAdmin } from '../config/supabase.js';

type ActivityAction =
  | 'created'
  | 'edited'
  | 'tag_added'
  | 'tag_removed'
  | 'list_added'
  | 'list_removed'
  | 'imported'
  | 'merged';

export async function logContactActivity(params: {
  contactId: string;
  companyId: string;
  userId: string;
  action: ActivityAction;
  metadata?: Record<string, unknown>;
}) {
  await supabaseAdmin.from('contact_activity_log').insert({
    contact_id: params.contactId,
    company_id: params.companyId,
    user_id: params.userId,
    action: params.action,
    metadata: params.metadata || {},
  });
}

export async function logContactActivitiesBulk(
  entries: {
    contactId: string;
    companyId: string;
    userId: string;
    action: ActivityAction;
    metadata?: Record<string, unknown>;
  }[]
) {
  if (entries.length === 0) return;
  const rows = entries.map((e) => ({
    contact_id: e.contactId,
    company_id: e.companyId,
    user_id: e.userId,
    action: e.action,
    metadata: e.metadata || {},
  }));
  await supabaseAdmin.from('contact_activity_log').insert(rows);
}
