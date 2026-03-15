import { Router } from 'express';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';
import { logContactActivity, logContactActivitiesBulk } from '../services/activityLog.js';

// Simple Jaro-Winkler similarity for in-app name comparison
function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;

  const matchWindow = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

function validateAndFormatPhone(phone: string): { e164: string } | { error: string } {
  const parsed = parsePhoneNumberFromString(phone);
  if (!parsed || !parsed.isValid()) {
    return { error: 'Invalid phone number. Please include a valid country code and number.' };
  }
  // Store without '+' prefix — Whapi expects bare international digits (e.g. 14155552671)
  // and incoming WhatsApp messages arrive in the same format.
  return { e164: parsed.format('E.164').replace(/^\+/, '') };
}

const router = Router();
router.use(requireAuth);

// List contacts with search and filters
router.get('/', requirePermission('contacts', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const {
      search, limit = '50', offset = '0',
      tags, listId, company, city, country,
      createdAfter, createdBefore,
      sortBy = 'updated_at', sortOrder = 'desc',
      ids,
    } = req.query;

    // If filtering by list, pre-fetch contact IDs from junction table
    let listContactIds: string[] | null = null;
    if (listId) {
      const { data: members } = await supabaseAdmin
        .from('contact_list_members')
        .select('contact_id')
        .eq('list_id', String(listId));
      listContactIds = (members || []).map((m) => m.contact_id);
      if (listContactIds.length === 0) {
        res.json({ contacts: [], count: 0 });
        return;
      }
    }

    // Parse custom field filters: cf[fieldDefId]=value
    const customFieldFilters: { defId: string; value: string }[] = [];
    for (const key of Object.keys(req.query)) {
      const match = key.match(/^cf\[(.+)\]$/);
      if (match && req.query[key]) {
        customFieldFilters.push({ defId: match[1], value: String(req.query[key]) });
      }
    }

    // Pre-fetch contact IDs matching all custom field filters (AND between fields)
    let cfContactIds: string[] | null = null;
    if (customFieldFilters.length > 0) {
      let candidateIds: string[] | null = listContactIds;

      for (const cf of customFieldFilters) {
        let cfQuery = supabaseAdmin
          .from('custom_field_values')
          .select('contact_id')
          .eq('field_definition_id', cf.defId);

        if (candidateIds) cfQuery = cfQuery.in('contact_id', candidateIds);

        const values = cf.value.split(',').map((v) => v.trim()).filter(Boolean);
        if (values.length > 1) {
          cfQuery = cfQuery.in('value', values);
        } else {
          cfQuery = cfQuery.ilike('value', `%${values[0]}%`);
        }

        const { data: matches } = await cfQuery;
        candidateIds = (matches || []).map((m) => m.contact_id);
        if (candidateIds.length === 0) {
          res.json({ contacts: [], count: 0 });
          return;
        }
      }
      cfContactIds = candidateIds;
    }

    // Determine which contacts this user can access
    // 1. Contacts they own
    // 2. Contacts shared with all_members
    // 3. Contacts shared with specific_users where they have access
    const userId = req.userId!;

    // Get IDs of contacts shared specifically with this user
    const { data: specificContactAccess } = await supabaseAdmin
      .from('contact_access')
      .select('contact_id')
      .eq('user_id', userId);

    const specificContactIds = (specificContactAccess || []).map((a) => a.contact_id);

    let query = supabaseAdmin
      .from('contacts')
      .select('*', { count: 'exact' })
      .eq('company_id', companyId)
      .eq('is_deleted', false);

    // Apply access filter: owner OR sharing_mode=all_members OR specific access
    if (specificContactIds.length > 0) {
      query = query.or(
        `owner_id.eq.${userId},sharing_mode.eq.all_members,id.in.(${specificContactIds.join(',')})`
      );
    } else {
      query = query.or(`owner_id.eq.${userId},sharing_mode.eq.all_members`);
    }

    if (cfContactIds) {
      query = query.in('id', cfContactIds);
    } else if (listContactIds) {
      query = query.in('id', listContactIds);
    }

    if (ids) {
      const requestedIds = String(ids)
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
      if (requestedIds.length === 0) {
        res.json({ contacts: [], count: 0 });
        return;
      }
      query = query.in('id', requestedIds);
    }

    if (tags) {
      const tagArray = String(tags).split(',').map((t) => t.trim()).filter(Boolean);
      if (tagArray.length > 0) {
        query = query.overlaps('tags', tagArray);
      }
    }

    if (company) query = query.ilike('company', `%${company}%`);
    if (city) query = query.ilike('address_city', `%${city}%`);
    if (country) query = query.ilike('address_country', `%${country}%`);
    if (createdAfter) query = query.gte('created_at', String(createdAfter));
    if (createdBefore) query = query.lte('created_at', String(createdBefore));

    if (search) {
      query = query.or(
        `first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone_number.ilike.%${search}%,email.ilike.%${search}%,company.ilike.%${search}%,whatsapp_name.ilike.%${search}%`
      );
    }

    // Sort
    const validSortColumns: Record<string, string> = {
      updated_at: 'updated_at',
      created_at: 'created_at',
      company: 'company',
      name: 'first_name',
    };
    const col = validSortColumns[String(sortBy)] || 'updated_at';
    query = query.order(col, { ascending: sortOrder === 'asc' });

    query = query.range(Number(offset), Number(offset) + Number(limit) - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({ contacts: data || [], count });
  } catch (err) {
    next(err);
  }
});

// Bulk actions on contacts — must be before /:contactId routes
router.post('/bulk', requirePermission('contacts', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { contactIds, action, value } = req.body;

    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      res.status(400).json({ error: 'contactIds array is required' });
      return;
    }

    if (contactIds.length > 100) {
      res.status(400).json({ error: 'Maximum 100 contacts per bulk operation' });
      return;
    }

    // Verify all contacts belong to company
    const { data: validContacts } = await supabaseAdmin
      .from('contacts')
      .select('id')
      .in('id', contactIds)
      .eq('company_id', companyId)
      .eq('is_deleted', false);

    const validIds = (validContacts || []).map((c) => c.id);
    if (validIds.length === 0) {
      res.status(404).json({ error: 'No valid contacts found' });
      return;
    }

    switch (action) {
      case 'delete':
        await supabaseAdmin
          .from('contacts')
          .update({ is_deleted: true, updated_at: new Date().toISOString() })
          .in('id', validIds);
        break;

      case 'tag_add':
        await supabaseAdmin.rpc('bulk_add_tag', { p_contact_ids: validIds, p_tag: value });
        break;

      case 'tag_remove':
        await supabaseAdmin.rpc('bulk_remove_tag', { p_contact_ids: validIds, p_tag: value });
        break;

      case 'list_add': {
        const addRows = validIds.map((cid) => ({
          list_id: value,
          contact_id: cid,
          added_by: req.userId,
        }));
        await supabaseAdmin
          .from('contact_list_members')
          .upsert(addRows, { onConflict: 'list_id,contact_id' });
        break;
      }

      case 'list_remove':
        await supabaseAdmin
          .from('contact_list_members')
          .delete()
          .in('contact_id', validIds)
          .eq('list_id', value);
        break;

      default:
        res.status(400).json({ error: 'Invalid action' });
        return;
    }

    // Log activity for bulk actions
    if (['tag_add', 'tag_remove', 'list_add', 'list_remove'].includes(action)) {
      const actionMap: Record<string, 'tag_added' | 'tag_removed' | 'list_added' | 'list_removed'> = {
        tag_add: 'tag_added',
        tag_remove: 'tag_removed',
        list_add: 'list_added',
        list_remove: 'list_removed',
      };
      const metadataMap: Record<string, Record<string, unknown>> = {
        tag_add: { tag: value },
        tag_remove: { tag: value },
        list_add: { list_id: value },
        list_remove: { list_id: value },
      };
      const logAction = actionMap[action as string];
      if (logAction) {
        await logContactActivitiesBulk(
          validIds.map((cid) => ({
            contactId: cid,
            companyId,
            userId: req.userId!,
            action: logAction,
            metadata: metadataMap[action as string],
          }))
        );
      }
    }

    res.json({ updated: validIds.length });
  } catch (err) {
    next(err);
  }
});

// ── Duplicate detection ────────────────────────────────────────────────

// Company-wide duplicate scan
router.get('/duplicates', requirePermission('contacts', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    const { data, error } = await supabaseAdmin.rpc('find_duplicate_contacts', {
      p_company_id: companyId,
    });
    if (error) throw error;

    if (!data || data.length === 0) {
      res.json({ groups: [] });
      return;
    }

    // Collect all unique contact IDs
    const contactIdSet = new Set<string>();
    for (const row of data) {
      contactIdSet.add(row.contact_id_1);
      contactIdSet.add(row.contact_id_2);
    }

    // Fetch contact details
    const { data: contacts } = await supabaseAdmin
      .from('contacts')
      .select('*')
      .in('id', Array.from(contactIdSet));
    const contactMap = new Map((contacts || []).map((c) => [c.id, c]));

    // Group pairs into groups using union-find
    const parent = new Map<string, string>();
    const find = (id: string): string => {
      if (!parent.has(id)) parent.set(id, id);
      if (parent.get(id) !== id) parent.set(id, find(parent.get(id)!));
      return parent.get(id)!;
    };
    const union = (a: string, b: string) => {
      parent.set(find(a), find(b));
    };

    // Best match info per pair
    const pairInfo = new Map<string, { matchType: string; confidence: number }>();
    for (const row of data) {
      union(row.contact_id_1, row.contact_id_2);
      const key = [row.contact_id_1, row.contact_id_2].sort().join(':');
      const existing = pairInfo.get(key);
      if (!existing || row.confidence > existing.confidence) {
        pairInfo.set(key, { matchType: row.match_type, confidence: row.confidence });
      }
    }

    // Build groups
    const groupMap = new Map<string, Set<string>>();
    for (const id of contactIdSet) {
      const root = find(id);
      if (!groupMap.has(root)) groupMap.set(root, new Set());
      groupMap.get(root)!.add(id);
    }

    const groups = Array.from(groupMap.values())
      .filter((s) => s.size > 1)
      .map((ids) => {
        const groupContacts = Array.from(ids).map((id) => contactMap.get(id)).filter(Boolean);
        // Find best match info for this group
        let bestConfidence = 0;
        let bestMatchType = 'name';
        for (const row of data) {
          if (ids.has(row.contact_id_1) && ids.has(row.contact_id_2)) {
            if (row.confidence > bestConfidence) {
              bestConfidence = row.confidence;
              bestMatchType = row.match_type;
            }
          }
        }
        return { contacts: groupContacts, matchType: bestMatchType, confidence: bestConfidence };
      })
      .sort((a, b) => b.confidence - a.confidence);

    res.json({ groups });
  } catch (err) {
    next(err);
  }
});

// ── Merge contacts ─────────────────────────────────────────────────────

router.post(
  '/merge',
  requirePermission('contacts', 'edit'),
  requirePermission('contacts', 'delete'),
  async (req, res, next) => {
    try {
      const companyId = req.companyId!;
      const userId = req.userId!;
      const { keepContactId, mergeContactId, resolvedFields } = req.body;

      if (!keepContactId || !mergeContactId) {
        res.status(400).json({ error: 'keepContactId and mergeContactId are required' });
        return;
      }

      // Validate both contacts
      const { data: contacts } = await supabaseAdmin
        .from('contacts')
        .select('*')
        .in('id', [keepContactId, mergeContactId])
        .eq('company_id', companyId)
        .eq('is_deleted', false);

      if (!contacts || contacts.length !== 2) {
        res.status(404).json({ error: 'One or both contacts not found' });
        return;
      }

      const keepContact = contacts.find((c) => c.id === keepContactId)!;
      const mergeContact = contacts.find((c) => c.id === mergeContactId)!;

      // 1. Update kept contact with resolved fields
      const mergedTags = [...new Set([
        ...(resolvedFields.tags || keepContact.tags || []),
        ...(mergeContact.tags || []),
      ])];

      const updateData: Record<string, unknown> = {
        ...resolvedFields,
        tags: mergedTags,
        updated_at: new Date().toISOString(),
      };
      delete updateData.id;
      delete updateData.company_id;
      delete updateData.created_by;
      delete updateData.created_at;
      delete updateData.is_deleted;
      delete updateData.merged_into;

      const { data: updatedContact, error: updateError } = await supabaseAdmin
        .from('contacts')
        .update(updateData)
        .eq('id', keepContactId)
        .select()
        .single();

      if (updateError) throw updateError;

      // 2. Transfer notes (unified in conversation_notes)
      await supabaseAdmin
        .from('conversation_notes')
        .update({ contact_id: keepContactId })
        .eq('contact_id', mergeContactId);

      // 3. Transfer contact_list_members (upsert to avoid dupes)
      const { data: mergeListMembers } = await supabaseAdmin
        .from('contact_list_members')
        .select('list_id, added_by')
        .eq('contact_id', mergeContactId);

      if (mergeListMembers && mergeListMembers.length > 0) {
        const rows = mergeListMembers.map((m) => ({
          list_id: m.list_id,
          contact_id: keepContactId,
          added_by: m.added_by,
        }));
        await supabaseAdmin
          .from('contact_list_members')
          .upsert(rows, { onConflict: 'list_id,contact_id' });
        await supabaseAdmin
          .from('contact_list_members')
          .delete()
          .eq('contact_id', mergeContactId);
      }

      // 4. Transfer custom_field_values (only for fields not already on kept contact)
      const { data: keepCfv } = await supabaseAdmin
        .from('custom_field_values')
        .select('field_definition_id')
        .eq('contact_id', keepContactId);
      const keepFieldIds = new Set((keepCfv || []).map((v) => v.field_definition_id));

      const { data: mergeCfv } = await supabaseAdmin
        .from('custom_field_values')
        .select('*')
        .eq('contact_id', mergeContactId);

      if (mergeCfv && mergeCfv.length > 0) {
        const toTransfer = mergeCfv.filter((v) => !keepFieldIds.has(v.field_definition_id));
        if (toTransfer.length > 0) {
          const rows = toTransfer.map((v) => ({
            contact_id: keepContactId,
            field_definition_id: v.field_definition_id,
            value: v.value,
            value_json: v.value_json,
          }));
          await supabaseAdmin.from('custom_field_values').insert(rows);
        }
        // Delete merged contact's custom field values
        await supabaseAdmin
          .from('custom_field_values')
          .delete()
          .eq('contact_id', mergeContactId);
      }

      // 5. Soft-delete merged contact
      await supabaseAdmin
        .from('contacts')
        .update({
          is_deleted: true,
          merged_into: keepContactId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', mergeContactId);

      // 6. Log activity
      const mergeName = [mergeContact.first_name, mergeContact.last_name]
        .filter(Boolean).join(' ') || mergeContact.phone_number;
      await logContactActivity({
        contactId: keepContactId,
        companyId,
        userId,
        action: 'merged',
        metadata: {
          merged_contact_id: mergeContactId,
          merged_contact_name: mergeName,
          merged_contact_phone: mergeContact.phone_number,
        },
      });

      res.json({ contact: updatedContact });
    } catch (err) {
      next(err);
    }
  }
);

// Get single contact
router.get('/:contactId', requirePermission('contacts', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { contactId } = req.params;

    const { getContactAccess } = await import('../services/accessControl.js');
    const access = await getContactAccess(req.userId!, String(contactId), companyId);
    if (!access) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('contacts')
      .select('*')
      .eq('id', contactId)
      .eq('company_id', companyId)
      .eq('is_deleted', false)
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    // Fetch custom field values with definitions
    const { data: customValues } = await supabaseAdmin
      .from('custom_field_values')
      .select('*, field_definition:field_definition_id(id, name, field_type, options)')
      .eq('contact_id', contactId);

    // Fetch list memberships
    const { data: listMembers } = await supabaseAdmin
      .from('contact_list_members')
      .select('list_id')
      .eq('contact_id', contactId);
    const list_ids = (listMembers || []).map((m) => m.list_id);

    res.json({ contact: data, custom_field_values: customValues || [], list_ids });
  } catch (err) {
    next(err);
  }
});

// Create contact
router.post('/', requirePermission('contacts', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const {
      phone_number, first_name, last_name, email, company, notes, tags,
      address_street, address_city, address_state, address_postal_code, address_country,
      custom_field_values, list_ids,
    } = req.body;

    if (!phone_number) {
      res.status(400).json({ error: 'phone_number is required' });
      return;
    }

    const phoneResult = validateAndFormatPhone(phone_number);
    if ('error' in phoneResult) {
      res.status(400).json({ error: phoneResult.error });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('contacts')
      .insert({
        company_id: companyId,
        user_id: req.userId,
        owner_id: req.userId,
        phone_number: phoneResult.e164,
        first_name: first_name || null,
        last_name: last_name || null,
        email: email || null,
        company: company || null,
        notes: notes || null,
        tags: tags || [],
        address_street: address_street || null,
        address_city: address_city || null,
        address_state: address_state || null,
        address_postal_code: address_postal_code || null,
        address_country: address_country || null,
      })
      .select()
      .single();

    if (error) throw error;

    // Insert custom field values if provided
    if (Array.isArray(custom_field_values) && custom_field_values.length > 0) {
      const rows = custom_field_values
        .filter((cfv: { field_definition_id: string; value?: string; value_json?: unknown }) => cfv.value || cfv.value_json)
        .map((cfv: { field_definition_id: string; value?: string; value_json?: unknown }) => ({
          contact_id: data.id,
          field_definition_id: cfv.field_definition_id,
          value: cfv.value || null,
          value_json: cfv.value_json || null,
        }));
      if (rows.length > 0) {
        await supabaseAdmin.from('custom_field_values').insert(rows);
      }
    }

    // Add to lists if provided
    if (Array.isArray(list_ids) && list_ids.length > 0) {
      await supabaseAdmin
        .from('contact_list_members')
        .upsert(
          (list_ids as string[]).map((listId) => ({ list_id: listId, contact_id: data.id, added_by: req.userId })),
          { onConflict: 'list_id,contact_id' }
        );
    }

    // Log activity
    await logContactActivity({
      contactId: data.id,
      companyId,
      userId: req.userId!,
      action: 'created',
    });

    res.json({ contact: data });
  } catch (err) {
    next(err);
  }
});

// Update contact
router.put('/:contactId', requirePermission('contacts', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const contactId = req.params.contactId as string;
    const {
      first_name, last_name, email, company, notes, tags, phone_number,
      address_street, address_city, address_state, address_postal_code, address_country,
      custom_field_values, list_ids,
    } = req.body;

    // Fetch old values for change tracking
    const { data: oldContact } = await supabaseAdmin
      .from('contacts')
      .select('*')
      .eq('id', contactId)
      .eq('company_id', companyId)
      .single();

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (first_name !== undefined) updates.first_name = first_name;
    if (last_name !== undefined) updates.last_name = last_name;
    if (email !== undefined) updates.email = email;
    if (company !== undefined) updates.company = company;
    if (notes !== undefined) updates.notes = notes;
    if (tags !== undefined) updates.tags = tags;
    if (address_street !== undefined) updates.address_street = address_street;
    if (address_city !== undefined) updates.address_city = address_city;
    if (address_state !== undefined) updates.address_state = address_state;
    if (address_postal_code !== undefined) updates.address_postal_code = address_postal_code;
    if (address_country !== undefined) updates.address_country = address_country;
    if (phone_number !== undefined) {
      const phoneResult = validateAndFormatPhone(phone_number);
      if ('error' in phoneResult) {
        res.status(400).json({ error: phoneResult.error });
        return;
      }
      updates.phone_number = phoneResult.e164;
    }

    const { data, error } = await supabaseAdmin
      .from('contacts')
      .update(updates)
      .eq('id', contactId)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) throw error;

    // Upsert custom field values if provided
    if (Array.isArray(custom_field_values)) {
      for (const cfv of custom_field_values as { field_definition_id: string; value?: string; value_json?: unknown }[]) {
        if (cfv.value || cfv.value_json) {
          await supabaseAdmin
            .from('custom_field_values')
            .upsert(
              {
                contact_id: contactId,
                field_definition_id: cfv.field_definition_id,
                value: cfv.value || null,
                value_json: cfv.value_json || null,
              },
              { onConflict: 'contact_id,field_definition_id' }
            );
        } else {
          // If value is empty, delete the row
          await supabaseAdmin
            .from('custom_field_values')
            .delete()
            .eq('contact_id', contactId)
            .eq('field_definition_id', cfv.field_definition_id);
        }
      }
    }

    // Sync list memberships if provided
    if (Array.isArray(list_ids)) {
      const { data: currentMembers } = await supabaseAdmin
        .from('contact_list_members')
        .select('list_id')
        .eq('contact_id', contactId);
      const currentIds = new Set((currentMembers || []).map((m) => m.list_id));
      const desiredIds = new Set(list_ids as string[]);

      // Add to new lists
      const toAdd = [...desiredIds].filter((id) => !currentIds.has(id));
      if (toAdd.length > 0) {
        await supabaseAdmin
          .from('contact_list_members')
          .upsert(
            toAdd.map((listId) => ({ list_id: listId, contact_id: contactId, added_by: req.userId })),
            { onConflict: 'list_id,contact_id' }
          );
      }

      // Remove from old lists
      const toRemove = [...currentIds].filter((id) => !desiredIds.has(id));
      if (toRemove.length > 0) {
        await supabaseAdmin
          .from('contact_list_members')
          .delete()
          .eq('contact_id', contactId)
          .in('list_id', toRemove);
      }
    }

    // Log edit activity with changed fields
    if (oldContact) {
      const trackedFields = [
        'first_name', 'last_name', 'email', 'company', 'notes', 'phone_number',
        'address_street', 'address_city', 'address_state', 'address_postal_code', 'address_country',
      ];
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const field of trackedFields) {
        if (updates[field] !== undefined && updates[field] !== oldContact[field]) {
          changes[field] = { from: oldContact[field], to: updates[field] };
        }
      }
      // Track tag changes
      if (updates.tags !== undefined) {
        const oldTags = (oldContact.tags || []).sort().join(',');
        const newTags = (updates.tags as string[]).sort().join(',');
        if (oldTags !== newTags) {
          changes.tags = { from: oldContact.tags, to: updates.tags };
        }
      }
      if (Object.keys(changes).length > 0) {
        await logContactActivity({
          contactId,
          companyId,
          userId: req.userId!,
          action: 'edited',
          metadata: { changes },
        });
      }
    }

    res.json({ contact: data });
  } catch (err) {
    next(err);
  }
});

// Soft delete contact
router.delete('/:contactId', requirePermission('contacts', 'delete'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { contactId } = req.params;

    await supabaseAdmin
      .from('contacts')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', contactId)
      .eq('company_id', companyId);

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// Get potential duplicates for a single contact
router.get('/:contactId/duplicates', requirePermission('contacts', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { contactId } = req.params;

    const { data: contact } = await supabaseAdmin
      .from('contacts')
      .select('*')
      .eq('id', contactId)
      .eq('company_id', companyId)
      .eq('is_deleted', false)
      .single();

    if (!contact) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    const duplicates: { contact: unknown; matchType: string; confidence: number }[] = [];

    // Check email match
    if (contact.email) {
      const { data: emailMatches } = await supabaseAdmin
        .from('contacts')
        .select('*')
        .eq('company_id', companyId)
        .eq('email', contact.email)
        .eq('is_deleted', false)
        .neq('id', contactId);

      for (const match of emailMatches || []) {
        duplicates.push({ contact: match, matchType: 'email', confidence: 0.9 });
      }
    }

    // Check name similarity (only if contact has a first name)
    if (contact.first_name) {
      const fullName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim();
      const { data: nameMatches } = await supabaseAdmin
        .from('contacts')
        .select('*')
        .eq('company_id', companyId)
        .eq('is_deleted', false)
        .neq('id', contactId)
        .not('first_name', 'is', null);

      for (const match of nameMatches || []) {
        // Skip if already found as email match
        if (duplicates.some((d) => (d.contact as { id: string }).id === match.id)) continue;
        const matchName = `${match.first_name || ''} ${match.last_name || ''}`.trim();
        // Simple similarity check — compare lowercase normalized
        const sim = jaroWinkler(fullName.toLowerCase(), matchName.toLowerCase());
        if (sim > 0.85) {
          duplicates.push({ contact: match, matchType: 'name', confidence: sim });
        }
      }
    }

    duplicates.sort((a, b) => b.confidence - a.confidence);
    res.json({ duplicates });
  } catch (err) {
    next(err);
  }
});

// Get activity timeline for a contact
router.get('/:contactId/activity', requirePermission('contacts', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { contactId } = req.params;
    const { limit = '20', before } = req.query;
    const lim = Number(limit);

    // Get contact's phone number for message query
    const { data: contact } = await supabaseAdmin
      .from('contacts')
      .select('phone_number')
      .eq('id', contactId)
      .eq('company_id', companyId)
      .single();

    if (!contact) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    // Query all three sources in parallel
    let activityQuery = supabaseAdmin
      .from('contact_activity_log')
      .select('*')
      .eq('contact_id', contactId)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(lim);

    let notesQuery = supabaseAdmin
      .from('conversation_notes')
      .select('*, author:created_by(id, full_name, avatar_url)')
      .eq('contact_id', contactId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(lim);

    let messagesQuery = supabaseAdmin
      .from('chat_messages')
      .select('*')
      .eq('company_id', companyId)
      .eq('phone_number', contact.phone_number)
      .order('created_at', { ascending: false })
      .limit(lim);

    if (before) {
      activityQuery = activityQuery.lt('created_at', String(before));
      notesQuery = notesQuery.lt('created_at', String(before));
      messagesQuery = messagesQuery.lt('created_at', String(before));
    }

    const [activityRes, notesRes, messagesRes] = await Promise.all([
      activityQuery,
      notesQuery,
      messagesQuery,
    ]);

    // Normalize into unified events
    const events = [
      ...(activityRes.data || []).map((a) => ({
        type: 'activity' as const,
        event: a.action as string,
        timestamp: a.created_at as string,
        data: a,
      })),
      ...(notesRes.data || []).map((n) => ({
        type: 'note' as const,
        event: 'note_added',
        timestamp: n.created_at as string,
        data: n,
      })),
      ...(messagesRes.data || []).map((m) => ({
        type: 'message' as const,
        event: m.direction === 'inbound' ? 'message_received' : 'message_sent',
        timestamp: m.created_at as string,
        data: m,
      })),
    ];

    // Sort by timestamp desc, trim to limit
    events.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    const limited = events.slice(0, lim);
    const hasMore = events.length > lim;

    res.json({ events: limited, hasMore });
  } catch (err) {
    next(err);
  }
});

// Get session history for a contact
router.get('/:contactId/sessions', requirePermission('contacts', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { contactId } = req.params;

    const { data: sessions, error } = await supabaseAdmin
      .from('chat_sessions')
      .select('id, status, created_at, ended_at, last_message, last_message_at, channel_id')
      .eq('company_id', companyId)
      .eq('contact_id', contactId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!sessions || sessions.length === 0) {
      res.json({ sessions: [] });
      return;
    }

    // Get message counts per session in one query
    const sessionIds = sessions.map((s) => s.id);
    const { data: messageCounts } = await supabaseAdmin
      .from('chat_messages')
      .select('session_id')
      .in('session_id', sessionIds);

    const countMap: Record<string, number> = {};
    for (const row of messageCounts || []) {
      countMap[row.session_id] = (countMap[row.session_id] || 0) + 1;
    }

    // Get channel names for sessions that have a channel_id
    const channelIds = [...new Set(sessions.map((s) => s.channel_id).filter(Boolean))] as string[];
    const channelNameMap: Record<string, string> = {};
    if (channelIds.length > 0) {
      const { data: channels } = await supabaseAdmin
        .from('whatsapp_channels')
        .select('id, display_name')
        .in('id', channelIds);
      for (const ch of channels || []) {
        channelNameMap[ch.id] = ch.display_name;
      }
    }

    // Get memory counts per session
    const { data: memories } = await supabaseAdmin
      .from('contact_memories')
      .select('session_id')
      .eq('company_id', companyId)
      .eq('contact_id', contactId)
      .eq('is_active', true)
      .in('session_id', sessionIds);

    const memoryCountMap: Record<string, number> = {};
    for (const row of memories || []) {
      if (row.session_id) {
        memoryCountMap[row.session_id] = (memoryCountMap[row.session_id] || 0) + 1;
      }
    }

    const enriched = sessions.map((s) => ({
      ...s,
      message_count: countMap[s.id] || 0,
      channel_name: s.channel_id ? channelNameMap[s.channel_id] || null : null,
      memory_count: memoryCountMap[s.id] || 0,
    }));

    res.json({ sessions: enriched });
  } catch (err) {
    next(err);
  }
});

// Get AI-extracted memories for a contact
router.get('/:contactId/memories', requirePermission('contacts', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { contactId } = req.params;

    const { data, error } = await supabaseAdmin
      .from('contact_memories')
      .select('id, memory_type, content, session_id, is_active, created_at')
      .eq('company_id', companyId)
      .eq('contact_id', contactId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ memories: data || [] });
  } catch (err) {
    next(err);
  }
});

// Update a contact memory (deactivate or edit content)
router.patch('/:contactId/memories/:memoryId', requirePermission('contacts', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { memoryId } = req.params;
    const { is_active, content } = req.body;

    const updates: Record<string, unknown> = {};
    if (is_active !== undefined) updates.is_active = is_active;
    if (content !== undefined) updates.content = content;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const { error } = await supabaseAdmin
      .from('contact_memories')
      .update(updates)
      .eq('id', memoryId)
      .eq('company_id', companyId);

    if (error) throw error;
    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// Get message history for a contact
router.get('/:contactId/messages', requirePermission('contacts', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { contactId } = req.params;
    const { limit = '50', before } = req.query;

    // Get contact's phone number
    const { data: contact } = await supabaseAdmin
      .from('contacts')
      .select('phone_number')
      .eq('id', contactId)
      .eq('company_id', companyId)
      .single();

    if (!contact) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    let query = supabaseAdmin
      .from('chat_messages')
      .select('*')
      .eq('company_id', companyId)
      .eq('phone_number', contact.phone_number)
      .order('created_at', { ascending: false })
      .limit(Number(limit));

    if (before) {
      query = query.lt('created_at', String(before));
    }

    const { data: messages, error } = await query;
    if (error) throw error;

    res.json({ messages: (messages || []).reverse() });
  } catch (err) {
    next(err);
  }
});

export default router;
