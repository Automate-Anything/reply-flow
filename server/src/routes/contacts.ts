import { Router } from 'express';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

function validateAndFormatPhone(phone: string): { e164: string } | { error: string } {
  const parsed = parsePhoneNumberFromString(phone);
  if (!parsed || !parsed.isValid()) {
    return { error: 'Invalid phone number. Please include a valid country code and number.' };
  }
  return { e164: parsed.format('E.164') };
}

const router = Router();
router.use(requireAuth);

// List contacts with search
router.get('/', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { search, limit = '50', offset = '0' } = req.query;

    let query = supabaseAdmin
      .from('contacts')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .eq('is_deleted', false)
      .order('updated_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (search) {
      query = query.or(
        `first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone_number.ilike.%${search}%,email.ilike.%${search}%,company.ilike.%${search}%,whatsapp_name.ilike.%${search}%`
      );
    }

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({ contacts: data || [], count });
  } catch (err) {
    next(err);
  }
});

// Get single contact
router.get('/:contactId', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { contactId } = req.params;

    const { data, error } = await supabaseAdmin
      .from('contacts')
      .select('*')
      .eq('id', contactId)
      .eq('user_id', userId)
      .eq('is_deleted', false)
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    res.json({ contact: data });
  } catch (err) {
    next(err);
  }
});

// Create contact
router.post('/', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { phone_number, first_name, last_name, email, company, notes, tags } = req.body;

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
        user_id: userId,
        phone_number: phoneResult.e164,
        first_name: first_name || null,
        last_name: last_name || null,
        email: email || null,
        company: company || null,
        notes: notes || null,
        tags: tags || [],
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ contact: data });
  } catch (err) {
    next(err);
  }
});

// Update contact
router.put('/:contactId', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { contactId } = req.params;
    const { first_name, last_name, email, company, notes, tags, phone_number } = req.body;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (first_name !== undefined) updates.first_name = first_name;
    if (last_name !== undefined) updates.last_name = last_name;
    if (email !== undefined) updates.email = email;
    if (company !== undefined) updates.company = company;
    if (notes !== undefined) updates.notes = notes;
    if (tags !== undefined) updates.tags = tags;
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
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    res.json({ contact: data });
  } catch (err) {
    next(err);
  }
});

// Soft delete contact
router.delete('/:contactId', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { contactId } = req.params;

    await supabaseAdmin
      .from('contacts')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', contactId)
      .eq('user_id', userId);

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// Get message history for a contact
router.get('/:contactId/messages', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { contactId } = req.params;
    const { limit = '50', before } = req.query;

    // Get contact's phone number
    const { data: contact } = await supabaseAdmin
      .from('contacts')
      .select('phone_number')
      .eq('id', contactId)
      .eq('user_id', userId)
      .single();

    if (!contact) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    let query = supabaseAdmin
      .from('chat_messages')
      .select('*')
      .eq('user_id', userId)
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
