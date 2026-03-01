import { Router } from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { buildSystemPrompt } from '../services/promptBuilder.js';
import type { ProfileData, KBEntry } from '../services/promptBuilder.js';

const router = Router();
router.use(requireAuth);

// Multer: memory storage, 10MB limit, accept pdf/docx/txt
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, DOCX, and TXT files are allowed'));
    }
  },
});

// ────────────────────────────────────────────────
// COMPANY AI PROFILE ROUTES (default template for new channels)
// ────────────────────────────────────────────────

// Get AI profile template for the company
router.get('/profile', requirePermission('ai_settings', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    const { data, error } = await supabaseAdmin
      .from('company_ai_profiles')
      .select('*')
      .eq('company_id', companyId)
      .single();

    if (error && error.code === 'PGRST116') {
      res.json({
        profile: {
          is_enabled: false,
          profile_data: {},
          max_tokens: 500,
          schedule_mode: 'always_on',
          ai_schedule: null,
          outside_hours_message: null,
        },
      });
      return;
    }

    if (error) throw error;
    res.json({ profile: data });
  } catch (err) {
    next(err);
  }
});

// Upsert AI profile for the company
router.put('/profile', requirePermission('ai_settings', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { is_enabled, profile_data, max_tokens, schedule_mode, ai_schedule, outside_hours_message } = req.body;

    const updates: Record<string, unknown> = {
      company_id: companyId,
      created_by: req.userId,
      updated_at: new Date().toISOString(),
    };
    if (is_enabled !== undefined) updates.is_enabled = is_enabled;
    if (profile_data !== undefined) updates.profile_data = profile_data;
    if (max_tokens !== undefined) updates.max_tokens = max_tokens;
    if (schedule_mode !== undefined) updates.schedule_mode = schedule_mode;
    if (ai_schedule !== undefined) updates.ai_schedule = ai_schedule;
    if (outside_hours_message !== undefined) updates.outside_hours_message = outside_hours_message;

    const { data, error } = await supabaseAdmin
      .from('company_ai_profiles')
      .upsert(updates, { onConflict: 'company_id' })
      .select()
      .single();

    if (error) throw error;
    res.json({ profile: data });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// TEST REPLY (dry-run AI classification + response)
// ────────────────────────────────────────────────

router.post('/test-reply', requirePermission('ai_settings', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { profile_data, message, channelId, agentId } = req.body as {
      profile_data?: ProfileData;
      message: string;
      channelId?: number;
      agentId?: string;
    };

    if (!message?.trim()) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    if (!env.ANTHROPIC_API_KEY) {
      res.status(503).json({ error: 'AI not configured' });
      return;
    }

    // Resolve profile_data: prefer agentId lookup, then client-sent profile_data
    let resolvedProfileData: ProfileData = profile_data || {};
    if (agentId) {
      const { data: agent } = await supabaseAdmin
        .from('ai_agents')
        .select('profile_data')
        .eq('id', agentId)
        .eq('company_id', companyId)
        .single();
      if (agent) {
        resolvedProfileData = (agent.profile_data || {}) as ProfileData;
      }
    }

    // Load KB entries for the channel (if provided)
    const { data: assignedKB } = channelId
      ? await supabaseAdmin
          .from('channel_kb_assignments')
          .select('entry_id')
          .eq('channel_id', channelId)
      : { data: null };

    let kbData: KBEntry[] = [];
    if (assignedKB && assignedKB.length > 0) {
      const entryIds = assignedKB.map((a) => a.entry_id);
      const { data: kbEntries } = await supabaseAdmin
        .from('knowledge_base_entries')
        .select('title, content')
        .in('id', entryIds);
      kbData = (kbEntries || []) as KBEntry[];
    } else {
      const { data: kbEntries } = await supabaseAdmin
        .from('knowledge_base_entries')
        .select('title, content')
        .eq('company_id', companyId);
      kbData = (kbEntries || []) as KBEntry[];
    }

    // Build system prompt with classification instruction
    const basePrompt = buildSystemPrompt(resolvedProfileData, kbData);
    const classificationInstruction = resolvedProfileData.response_flow?.scenarios?.length
      ? '\n\nIMPORTANT: Before your response, output on its own line which scenario you matched using the format [SCENARIO: Name] or [SCENARIO: none] if no scenario matched. Then provide your normal response on the next line.'
      : '';
    const systemPrompt = basePrompt + classificationInstruction;

    const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: message.trim() }],
    });

    const fullReply = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    // Parse [SCENARIO: ...] prefix
    let matched_scenario: string | null = null;
    let responseText = fullReply;

    const scenarioMatch = fullReply.match(/^\[SCENARIO:\s*(.+?)\]\s*\n?/);
    if (scenarioMatch) {
      const scenarioName = scenarioMatch[1].trim();
      matched_scenario = scenarioName.toLowerCase() === 'none' ? null : scenarioName;
      responseText = fullReply.slice(scenarioMatch[0].length).trim();
    }

    res.json({ matched_scenario, response: responseText });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// KNOWLEDGE BASE ROUTES (company-level)
// ────────────────────────────────────────────────

// List KB entries for the company
router.get('/kb', requirePermission('knowledge_base', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    const { data, error } = await supabaseAdmin
      .from('knowledge_base_entries')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ entries: data || [] });
  } catch (err) {
    next(err);
  }
});

// Add text KB entry to the company
router.post('/kb', requirePermission('knowledge_base', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { title, content } = req.body;

    if (!title || !content) {
      res.status(400).json({ error: 'Title and content are required' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('knowledge_base_entries')
      .insert({
        company_id: companyId,
        created_by: req.userId,
        title,
        content,
        source_type: 'text',
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ entry: data });
  } catch (err) {
    next(err);
  }
});

// Upload file KB entry to the company
router.post('/kb/upload', requirePermission('knowledge_base', 'create'), upload.single('file'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    // Extract text from file
    let extractedText = '';
    const ext = file.originalname.split('.').pop()?.toLowerCase();

    if (file.mimetype === 'text/plain' || ext === 'txt') {
      extractedText = file.buffer.toString('utf-8');
    } else if (file.mimetype === 'application/pdf' || ext === 'pdf') {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(file.buffer) });
      const result = await parser.getText();
      extractedText = result.text;
      await parser.destroy();
    } else if (
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      ext === 'docx'
    ) {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      extractedText = result.value;
    }

    if (!extractedText.trim()) {
      res.status(400).json({ error: 'Could not extract text from file' });
      return;
    }

    // Upload file to Supabase Storage
    const storagePath = `${companyId}/kb/${Date.now()}_${file.originalname}`;
    const { error: storageError } = await supabaseAdmin.storage
      .from('knowledge-base')
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (storageError) {
      console.error('Storage upload error:', storageError);
    }

    const fileUrl = storageError ? null : storagePath;
    const title = req.body.title || file.originalname.replace(/\.[^.]+$/, '');

    const { data, error } = await supabaseAdmin
      .from('knowledge_base_entries')
      .insert({
        company_id: companyId,
        created_by: req.userId,
        title,
        content: extractedText,
        source_type: 'file',
        file_name: file.originalname,
        file_url: fileUrl,
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ entry: data });
  } catch (err) {
    next(err);
  }
});

// Update a KB entry
router.put('/kb/entry/:entryId', requirePermission('knowledge_base', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { entryId } = req.params;
    const { title, content } = req.body;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = content;

    const { data, error } = await supabaseAdmin
      .from('knowledge_base_entries')
      .update(updates)
      .eq('id', entryId)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) throw error;
    res.json({ entry: data });
  } catch (err) {
    next(err);
  }
});

// Delete a KB entry
router.delete('/kb/entry/:entryId', requirePermission('knowledge_base', 'delete'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { entryId } = req.params;

    const { data: entry } = await supabaseAdmin
      .from('knowledge_base_entries')
      .select('file_url')
      .eq('id', entryId)
      .eq('company_id', companyId)
      .single();

    if (!entry) {
      res.status(404).json({ error: 'Entry not found' });
      return;
    }

    if (entry.file_url) {
      await supabaseAdmin.storage
        .from('knowledge-base')
        .remove([entry.file_url]);
    }

    const { error } = await supabaseAdmin
      .from('knowledge_base_entries')
      .delete()
      .eq('id', entryId)
      .eq('company_id', companyId);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// CHANNEL AGENT SETTINGS ROUTES
// ────────────────────────────────────────────────

// Get per-channel agent settings
router.get('/channel-settings/:channelId', requirePermission('ai_settings', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const channelId = Number(req.params.channelId);

    const { data, error } = await supabaseAdmin
      .from('channel_agent_settings')
      .select('*')
      .eq('channel_id', channelId)
      .eq('company_id', companyId)
      .single();

    if (error && error.code === 'PGRST116') {
      res.json({
        settings: {
          is_enabled: true,
          custom_instructions: null,
          profile_data: {},
          max_tokens: 500,
          schedule_mode: 'always_on',
          ai_schedule: null,
          outside_hours_message: null,
          default_language: 'en',
          business_hours: null,
        },
      });
      return;
    }

    if (error) throw error;
    res.json({ settings: data });
  } catch (err) {
    next(err);
  }
});

// Upsert per-channel agent settings
router.put('/channel-settings/:channelId', requirePermission('ai_settings', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const channelId = Number(req.params.channelId);
    const {
      is_enabled, custom_instructions,
      profile_data, max_tokens, schedule_mode, ai_schedule, outside_hours_message,
      default_language, business_hours, agent_id,
    } = req.body;

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

    const updates: Record<string, unknown> = {
      channel_id: channelId,
      company_id: companyId,
      updated_at: new Date().toISOString(),
    };
    if (is_enabled !== undefined) updates.is_enabled = is_enabled;
    if (custom_instructions !== undefined) updates.custom_instructions = custom_instructions;
    if (profile_data !== undefined) updates.profile_data = profile_data;
    if (max_tokens !== undefined) updates.max_tokens = max_tokens;
    if (schedule_mode !== undefined) updates.schedule_mode = schedule_mode;
    if (ai_schedule !== undefined) updates.ai_schedule = ai_schedule;
    if (outside_hours_message !== undefined) updates.outside_hours_message = outside_hours_message;
    if (default_language !== undefined) updates.default_language = default_language;
    if (business_hours !== undefined) updates.business_hours = business_hours;
    if (agent_id !== undefined) updates.agent_id = agent_id;

    const { data, error } = await supabaseAdmin
      .from('channel_agent_settings')
      .upsert(updates, { onConflict: 'channel_id' })
      .select()
      .single();

    if (error) throw error;
    res.json({ settings: data });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// KB ASSIGNMENT ROUTES
// ────────────────────────────────────────────────

// Get KB assignments for a channel
router.get('/kb-assignments/:channelId', requirePermission('knowledge_base', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const channelId = Number(req.params.channelId);

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

    const { data, error } = await supabaseAdmin
      .from('channel_kb_assignments')
      .select('entry_id')
      .eq('channel_id', channelId);

    if (error) throw error;
    res.json({ assigned_entry_ids: (data || []).map((r) => r.entry_id) });
  } catch (err) {
    next(err);
  }
});

// Set KB assignments for a channel (replace all)
router.put('/kb-assignments/:channelId', requirePermission('knowledge_base', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const channelId = Number(req.params.channelId);
    const { entryIds } = req.body as { entryIds: string[] };

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

    // Delete all existing assignments
    await supabaseAdmin
      .from('channel_kb_assignments')
      .delete()
      .eq('channel_id', channelId);

    // Insert new assignments
    if (entryIds && entryIds.length > 0) {
      const rows = entryIds.map((entryId) => ({
        channel_id: channelId,
        entry_id: entryId,
      }));

      const { error } = await supabaseAdmin
        .from('channel_kb_assignments')
        .insert(rows);

      if (error) throw error;
    }

    res.json({ assigned_entry_ids: entryIds || [] });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// CONVERSATION AI CONTROL (pause/resume)
// ────────────────────────────────────────────────

// Pause AI for a conversation (human takeover)
router.post('/pause/:sessionId', requirePermission('conversations', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { sessionId } = req.params;
    const { duration_minutes } = req.body;

    const updates: Record<string, unknown> = {
      human_takeover: true,
      updated_at: new Date().toISOString(),
    };

    if (duration_minutes) {
      const resumeAt = new Date(Date.now() + duration_minutes * 60_000);
      updates.auto_resume_at = resumeAt.toISOString();
    } else {
      updates.auto_resume_at = null;
    }

    await supabaseAdmin
      .from('chat_sessions')
      .update(updates)
      .eq('id', sessionId)
      .eq('company_id', companyId);

    res.json({ status: 'paused' });
  } catch (err) {
    next(err);
  }
});

// Resume AI for a conversation
router.post('/resume/:sessionId', requirePermission('conversations', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { sessionId } = req.params;

    await supabaseAdmin
      .from('chat_sessions')
      .update({
        human_takeover: false,
        auto_resume_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .eq('company_id', companyId);

    res.json({ status: 'resumed' });
  } catch (err) {
    next(err);
  }
});

export default router;
