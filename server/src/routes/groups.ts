import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();

// ── Static routes FIRST (before any /:id parameterized routes) ──

// GET /groups — List all group chats for the company
router.get('/', async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    // Fetch groups with channel name join and criteria count
    const { data: groups, error } = await supabaseAdmin
      .from('group_chats')
      .select('*, whatsapp_channels(channel_name)')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Get criteria counts per group
    const { data: criteriaCounts } = await supabaseAdmin
      .from('group_criteria')
      .select('group_chat_id')
      .eq('company_id', companyId)
      .eq('is_enabled', true);

    const countMap = new Map<string, number>();
    for (const c of criteriaCounts || []) {
      if (c.group_chat_id) {
        countMap.set(c.group_chat_id, (countMap.get(c.group_chat_id) || 0) + 1);
      }
    }

    const enriched = (groups || []).map((g: any) => ({
      ...g,
      channel_name: g.whatsapp_channels?.channel_name ?? null,
      whatsapp_channels: undefined,
      criteria_count: countMap.get(g.id) || 0,
    }));

    res.json({ groups: enriched });
  } catch (err) {
    next(err);
  }
});

// GET /groups/global-criteria — List all global criteria
router.get('/global-criteria', async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    const { data, error } = await supabaseAdmin
      .from('group_criteria')
      .select('*')
      .eq('company_id', companyId)
      .is('group_chat_id', null)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ criteria: data || [] });
  } catch (err) {
    next(err);
  }
});

// POST /groups/criteria — Create a new criteria
router.post('/criteria', async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const {
      group_chat_id,
      name,
      match_type,
      keyword_config,
      ai_description,
      notify_user_ids,
      is_enabled,
    } = req.body;

    const { data, error } = await supabaseAdmin
      .from('group_criteria')
      .insert({
        company_id: companyId,
        group_chat_id: group_chat_id || null,
        name,
        match_type,
        keyword_config: keyword_config || {},
        ai_description: ai_description || null,
        notify_user_ids: notify_user_ids || [],
        is_enabled: is_enabled ?? true,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

// PATCH /groups/criteria/:id — Update a criteria
router.patch('/criteria/:id', async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { id } = req.params;
    const {
      name,
      match_type,
      keyword_config,
      ai_description,
      notify_user_ids,
      is_enabled,
    } = req.body;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (match_type !== undefined) updates.match_type = match_type;
    if (keyword_config !== undefined) updates.keyword_config = keyword_config;
    if (ai_description !== undefined) updates.ai_description = ai_description;
    if (notify_user_ids !== undefined) updates.notify_user_ids = notify_user_ids;
    if (is_enabled !== undefined) updates.is_enabled = is_enabled;

    const { data, error } = await supabaseAdmin
      .from('group_criteria')
      .update(updates)
      .eq('id', id)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// DELETE /groups/criteria/:id — Delete a criteria
router.delete('/criteria/:id', async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from('group_criteria')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId);

    if (error) throw error;
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ── Parameterized /:id routes LAST ─────────────────────────

// PATCH /groups/:id — Update group (toggle monitoring, etc.)
router.patch('/:id', async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { id } = req.params;
    const { monitoring_enabled, group_name } = req.body;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof monitoring_enabled === 'boolean') updates.monitoring_enabled = monitoring_enabled;
    if (typeof group_name === 'string') updates.group_name = group_name;

    const { data, error } = await supabaseAdmin
      .from('group_chats')
      .update(updates)
      .eq('id', id)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /groups/:id/messages — Get messages for a group (paginated)
router.get('/:id/messages', async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { id } = req.params;
    const { limit = '50', offset = '0', matched_only } = req.query;

    let query = supabaseAdmin
      .from('group_chat_messages')
      .select('*', { count: 'exact' })
      .eq('group_chat_id', id)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    const { data: messages, error, count } = await query;
    if (error) throw error;

    // If matched_only, filter to messages that have criteria matches
    let result = messages || [];
    if (matched_only === 'true') {
      const messageIds = result.map((m) => m.id);
      if (messageIds.length > 0) {
        const { data: matches } = await supabaseAdmin
          .from('group_criteria_matches')
          .select('group_chat_message_id, criteria_ids')
          .in('group_chat_message_id', messageIds);

        const matchedSet = new Set((matches || []).map((m) => m.group_chat_message_id));
        result = result.filter((m) => matchedSet.has(m.id));
      }
    }

    res.json({ messages: result, count });
  } catch (err) {
    next(err);
  }
});

// GET /groups/:id/criteria — List criteria for a specific group
router.get('/:id/criteria', async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { id } = req.params;

    const { data, error } = await supabaseAdmin
      .from('group_criteria')
      .select('*')
      .eq('company_id', companyId)
      .eq('group_chat_id', id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ criteria: data || [] });
  } catch (err) {
    next(err);
  }
});

// GET /groups/:id/matches — Get criteria match log for a group
router.get('/:id/matches', async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { id } = req.params;
    const { limit = '50', offset = '0' } = req.query;

    const { data: matches, error, count } = await supabaseAdmin
      .from('group_criteria_matches')
      .select(`
        *,
        group_chat_messages!inner (*)
      `, { count: 'exact' })
      .eq('company_id', companyId)
      .eq('group_chat_messages.group_chat_id', id)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) throw error;
    res.json({ matches: matches || [], count });
  } catch (err) {
    next(err);
  }
});

export default router;
