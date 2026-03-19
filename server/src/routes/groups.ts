import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { getGroupInfo, listGroups } from '../services/whapi.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// ── Static routes FIRST (before any /:id parameterized routes) ──

// GET /groups — List all group chats for the company
router.get('/', async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    // Fetch groups with channel name join and criteria count
    const { data: groups, error } = await supabaseAdmin
      .from('group_chats')
      .select('*, channels(channel_name)')
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
    let globalCriteriaCount = 0;
    for (const c of criteriaCounts || []) {
      if (c.group_chat_id) {
        countMap.set(c.group_chat_id, (countMap.get(c.group_chat_id) || 0) + 1);
      } else {
        globalCriteriaCount++;
      }
    }

    const enriched = (groups || []).map((g: any) => ({
      ...g,
      channel_name: g.channels?.channel_name ?? null,
      channels: undefined,
      criteria_count: (countMap.get(g.id) || 0) + globalCriteriaCount,
    }));

    // Backfill group names for any groups missing them (non-blocking)
    const unnamed = (groups || []).filter((g: any) => !g.group_name);
    if (unnamed.length > 0) {
      // Get channel tokens for the unnamed groups
      const channelIds = [...new Set(unnamed.map((g: any) => g.channel_id))];
      const { data: channels } = await supabaseAdmin
        .from('channels')
        .select('id, channel_token')
        .in('id', channelIds);

      const tokenMap = new Map((channels || []).map((c: any) => [c.id, c.channel_token]));

      // Fetch names from Whapi and update DB + response in parallel
      await Promise.allSettled(
        unnamed.map(async (g: any) => {
          const token = tokenMap.get(g.channel_id);
          if (!token) return;
          const info = await getGroupInfo(token, g.group_jid);
          if (info?.name) {
            await supabaseAdmin
              .from('group_chats')
              .update({ group_name: info.name, updated_at: new Date().toISOString() })
              .eq('id', g.id);
            // Update the response object so the name appears on this request too
            const match = enriched.find((e: any) => e.id === g.id);
            if (match) match.group_name = info.name;
          }
        })
      );
    }

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
      rule_group_id,
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
        rule_group_id: rule_group_id || null,
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

// POST /groups/sync — Sync groups from Whapi for all connected channels
router.post('/sync', async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    const { data: channels, error: chErr } = await supabaseAdmin
      .from('channels')
      .select('id, channel_token')
      .eq('company_id', companyId)
      .eq('channel_status', 'connected');

    if (chErr) throw chErr;
    if (!channels || channels.length === 0) {
      return res.json({ groups: [], new_count: 0, errors: [] });
    }

    const allGroups: any[] = [];
    const errors: Array<{ channel_id: number; error: string }> = [];

    const results = await Promise.allSettled(
      channels.map(async (ch) => {
        const groups = await listGroups(ch.channel_token);
        return { channel: ch, groups };
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { channel, groups } = result.value;
        for (const g of groups) {
          allGroups.push({
            company_id: companyId,
            channel_id: channel.id,
            group_jid: g.id,
            group_name: g.name || null,
          });
        }
      } else {
        errors.push({
          channel_id: 0,
          error: result.reason?.message || 'Unknown error',
        });
      }
    }

    let newCount = 0;
    if (allGroups.length > 0) {
      const { data: existing } = await supabaseAdmin
        .from('group_chats')
        .select('group_jid, channel_id')
        .eq('company_id', companyId);

      const existingSet = new Set(
        (existing || []).map((e: any) => `${e.channel_id}:${e.group_jid}`)
      );

      const newGroups = allGroups.filter(
        (g) => !existingSet.has(`${g.channel_id}:${g.group_jid}`)
      );

      if (newGroups.length > 0) {
        const { error: insertErr } = await supabaseAdmin
          .from('group_chats')
          .insert(newGroups);
        if (insertErr) throw insertErr;
        newCount = newGroups.length;
      }

      const namesToUpdate = allGroups.filter(
        (g) => g.group_name && existingSet.has(`${g.channel_id}:${g.group_jid}`)
      );
      for (const g of namesToUpdate) {
        await supabaseAdmin
          .from('group_chats')
          .update({ group_name: g.group_name, updated_at: new Date().toISOString() })
          .eq('company_id', companyId)
          .eq('channel_id', g.channel_id)
          .eq('group_jid', g.group_jid)
          .is('group_name', null);
      }
    }

    const { data: groups, error: fetchErr } = await supabaseAdmin
      .from('group_chats')
      .select('*, channels(channel_name)')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (fetchErr) throw fetchErr;

    const enriched = (groups || []).map((g: any) => ({
      ...g,
      channel_name: g.channels?.channel_name ?? null,
      channels: undefined,
    }));

    res.json({ groups: enriched, new_count: newCount, errors });
  } catch (err) {
    next(err);
  }
});

// GET /groups/all-criteria — List ALL criteria for the company (global + group-specific)
router.get('/all-criteria', async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    const { data, error } = await supabaseAdmin
      .from('group_criteria')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ criteria: data || [] });
  } catch (err) {
    next(err);
  }
});

// GET /groups/all-matches — Cross-group matched messages
router.get('/all-matches', async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { limit = '50', offset = '0', group_id, criteria_id } = req.query;

    let query = supabaseAdmin
      .from('group_criteria_matches')
      .select('*, group_chat_messages (*)', { count: 'exact' })
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (group_id && typeof group_id === 'string') {
      const { data: msgIds } = await supabaseAdmin
        .from('group_chat_messages')
        .select('id')
        .eq('group_chat_id', group_id)
        .eq('company_id', companyId);

      const ids = (msgIds || []).map((m: any) => m.id);
      if (ids.length === 0) {
        return res.json({ matches: [], count: 0 });
      }
      query = query.in('group_chat_message_id', ids);
    }

    const { data: matches, error, count } = await query;
    if (error) throw error;

    let result = matches || [];
    if (criteria_id && typeof criteria_id === 'string') {
      result = result.filter((m: any) =>
        m.criteria_ids && m.criteria_ids.includes(criteria_id)
      );
    }

    res.json({ matches: result, count });
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
    const { limit = '50', offset = '0' } = req.query;

    const { data: messages, error, count } = await supabaseAdmin
      .from('group_chat_messages')
      .select('*', { count: 'exact' })
      .eq('group_chat_id', id)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) throw error;
    res.json({ messages: messages || [], count });
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

    // Step 1: get message IDs belonging to this group
    // (PostgREST doesn't support filtering on embedded join columns via .eq(),
    //  so we do a two-step query to correctly scope matches to this group)
    const { data: msgIds } = await supabaseAdmin
      .from('group_chat_messages')
      .select('id')
      .eq('group_chat_id', id)
      .eq('company_id', companyId);

    const messageIds = (msgIds || []).map((m: any) => m.id);

    if (messageIds.length === 0) {
      return res.json({ matches: [], count: 0 });
    }

    // Step 2: get matches for those message IDs, with embedded message data
    const { data: matches, error, count } = await supabaseAdmin
      .from('group_criteria_matches')
      .select('*, group_chat_messages (*)', { count: 'exact' })
      .eq('company_id', companyId)
      .in('group_chat_message_id', messageIds)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) throw error;
    res.json({ matches: matches || [], count });
  } catch (err) {
    next(err);
  }
});

export default router;
