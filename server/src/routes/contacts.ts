import { Router } from 'express';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';

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

    let query = supabaseAdmin
      .from('contacts')
      .select('*', { count: 'exact' })
      .eq('company_id', companyId)
      .eq('is_deleted', false);

    if (cfContactIds) {
      query = query.in('id', cfContactIds);
    } else if (listContactIds) {
      query = query.in('id', listContactIds);
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

    res.json({ updated: validIds.length });
  } catch (err) {
    next(err);
  }
});

// Get single contact
router.get('/:contactId', requirePermission('contacts', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { contactId } = req.params;

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

    res.json({ contact: data, custom_field_values: customValues || [] });
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
      custom_field_values,
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
        created_by: req.userId,
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

    res.json({ contact: data });
  } catch (err) {
    next(err);
  }
});

// Update contact
router.put('/:contactId', requirePermission('contacts', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { contactId } = req.params;
    const {
      first_name, last_name, email, company, notes, tags, phone_number,
      address_street, address_city, address_state, address_postal_code, address_country,
      custom_field_values,
    } = req.body;

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
      query = query.lt('created_at', before);
    }

    const { data: messages, error } = await query;
    if (error) throw error;

    res.json({ messages: (messages || []).reverse() });
  } catch (err) {
    next(err);
  }
});

export default router;
