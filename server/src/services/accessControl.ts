import { supabaseAdmin } from '../config/supabase.js';

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
