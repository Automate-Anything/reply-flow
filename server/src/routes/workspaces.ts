import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(requireAuth);

// List company workspaces (with channel count and AI profile status)
router.get('/', requirePermission('workspaces', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    const { data: workspaces, error } = await supabaseAdmin
      .from('workspaces')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Fetch channel counts and AI profile status for each workspace
    const enriched = await Promise.all(
      (workspaces || []).map(async (ws) => {
        const [channelsRes, profileRes] = await Promise.all([
          supabaseAdmin
            .from('whatsapp_channels')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', ws.id),
          supabaseAdmin
            .from('workspace_ai_profiles')
            .select('is_enabled')
            .eq('workspace_id', ws.id)
            .single(),
        ]);

        return {
          ...ws,
          channel_count: channelsRes.count || 0,
          ai_enabled: profileRes.data?.is_enabled ?? false,
        };
      })
    );

    res.json({ workspaces: enriched });
  } catch (err) {
    next(err);
  }
});

// Create workspace
router.post('/', requirePermission('workspaces', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { name, description } = req.body;

    if (!name?.trim()) {
      res.status(400).json({ error: 'Workspace name is required' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('workspaces')
      .insert({
        company_id: companyId,
        name: name.trim(),
        description: description?.trim() || null,
        created_by: req.userId,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: 'A workspace with this name already exists' });
        return;
      }
      throw error;
    }

    res.json({ workspace: data });
  } catch (err) {
    next(err);
  }
});

// Get workspace details (with channels, AI profile, KB entries)
router.get('/:workspaceId', requirePermission('workspaces', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { workspaceId } = req.params;

    const { data: workspace, error } = await supabaseAdmin
      .from('workspaces')
      .select('*')
      .eq('id', workspaceId)
      .eq('company_id', companyId)
      .single();

    if (error || !workspace) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    // Fetch channels assigned to this workspace
    const { data: channels } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('id, channel_id, channel_name, channel_status, phone_number, webhook_registered, created_at')
      .eq('workspace_id', workspaceId)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    // Fetch AI profile
    const { data: profile } = await supabaseAdmin
      .from('workspace_ai_profiles')
      .select('*')
      .eq('workspace_id', workspaceId)
      .single();

    res.json({
      workspace,
      channels: channels || [],
      profile: profile || { is_enabled: false, profile_data: {}, max_tokens: 500 },
    });
  } catch (err) {
    next(err);
  }
});

// Update workspace
router.put('/:workspaceId', requirePermission('workspaces', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { workspaceId } = req.params;
    const { name, description, default_language, business_hours } = req.body;

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description?.trim() || null;
    if (default_language !== undefined) updates.default_language = default_language;
    if (business_hours !== undefined) updates.business_hours = business_hours;

    const { data, error } = await supabaseAdmin
      .from('workspaces')
      .update(updates)
      .eq('id', workspaceId)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: 'A workspace with this name already exists' });
        return;
      }
      throw error;
    }

    res.json({ workspace: data });
  } catch (err) {
    next(err);
  }
});

// Delete workspace (blocked if channels still exist)
router.delete('/:workspaceId', requirePermission('workspaces', 'delete'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { workspaceId } = req.params;

    // Check for existing channels — can't delete workspace with channels
    const { count } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('company_id', companyId);

    if (count && count > 0) {
      res.status(409).json({ error: 'Cannot delete workspace with existing channels. Remove all channels first.' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('workspaces')
      .delete()
      .eq('id', workspaceId)
      .eq('company_id', companyId);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Assign a channel to a workspace
router.post('/:workspaceId/channels', requirePermission('workspaces', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { workspaceId } = req.params;
    const { channelId } = req.body;

    if (!channelId) {
      res.status(400).json({ error: 'channelId is required' });
      return;
    }

    // Verify workspace belongs to company
    const { data: workspace } = await supabaseAdmin
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .eq('company_id', companyId)
      .single();

    if (!workspace) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    // Verify channel belongs to company
    const { data: channel } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('id')
      .eq('id', channelId)
      .eq('company_id', companyId)
      .single();

    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    // Assign channel to workspace
    const { error } = await supabaseAdmin
      .from('whatsapp_channels')
      .update({ workspace_id: workspaceId })
      .eq('id', channelId)
      .eq('company_id', companyId);

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
