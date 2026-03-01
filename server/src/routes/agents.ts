import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(requireAuth);

// List all agents for the company
router.get('/', requirePermission('ai_settings', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    const { data, error } = await supabaseAdmin
      .from('ai_agents')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Count channels assigned to each agent
    const agentIds = (data || []).map((a) => a.id);
    let channelCounts: Record<string, number> = {};

    if (agentIds.length > 0) {
      const { data: assignments } = await supabaseAdmin
        .from('channel_agent_settings')
        .select('agent_id')
        .in('agent_id', agentIds);

      if (assignments) {
        for (const row of assignments) {
          if (row.agent_id) {
            channelCounts[row.agent_id] = (channelCounts[row.agent_id] || 0) + 1;
          }
        }
      }
    }

    const agents = (data || []).map((agent) => ({
      ...agent,
      channel_count: channelCounts[agent.id] || 0,
    }));

    res.json({ agents });
  } catch (err) {
    next(err);
  }
});

// Create a new agent
router.post('/', requirePermission('ai_settings', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { name, profile_data } = req.body;

    const { data, error } = await supabaseAdmin
      .from('ai_agents')
      .insert({
        company_id: companyId,
        name: name || 'New Agent',
        profile_data: profile_data || {},
        created_by: req.userId,
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ agent: { ...data, channel_count: 0 } });
  } catch (err) {
    next(err);
  }
});

// Get a single agent
router.get('/:agentId', requirePermission('ai_settings', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { agentId } = req.params;

    const { data, error } = await supabaseAdmin
      .from('ai_agents')
      .select('*')
      .eq('id', agentId)
      .eq('company_id', companyId)
      .single();

    if (error && error.code === 'PGRST116') {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    if (error) throw error;

    // Count channels assigned
    const { count } = await supabaseAdmin
      .from('channel_agent_settings')
      .select('*', { count: 'exact', head: true })
      .eq('agent_id', agentId);

    res.json({ agent: { ...data, channel_count: count || 0 } });
  } catch (err) {
    next(err);
  }
});

// Update an agent
router.put('/:agentId', requirePermission('ai_settings', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { agentId } = req.params;
    const { name, profile_data } = req.body;

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (name !== undefined) updates.name = name;
    if (profile_data !== undefined) updates.profile_data = profile_data;

    const { data, error } = await supabaseAdmin
      .from('ai_agents')
      .update(updates)
      .eq('id', agentId)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) throw error;
    res.json({ agent: data });
  } catch (err) {
    next(err);
  }
});

// Delete an agent
router.delete('/:agentId', requirePermission('ai_settings', 'delete'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { agentId } = req.params;

    const { error } = await supabaseAdmin
      .from('ai_agents')
      .delete()
      .eq('id', agentId)
      .eq('company_id', companyId);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
