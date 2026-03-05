import { Router } from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { buildSystemPrompt, buildScenarioResponsePrompt } from '../services/promptBuilder.js';
import type { ProfileData, KBEntry } from '../services/promptBuilder.js';
import { classifyMessage } from '../services/ai.js';
import { processDocument, cleanText } from '../services/documentProcessor.js';
import { processAndEmbedEntry, isEmbeddingsAvailable, searchKnowledgeBase, backfillExistingEntries } from '../services/embeddings.js';

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
    const { profile_data, message, agentId } = req.body as {
      profile_data?: ProfileData;
      message: string;
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

    // Load relevant KB entries via semantic search (or fall back to loading all)
    let kbData: KBEntry[] = [];
    if (isEmbeddingsAvailable()) {
      const searchResults = await searchKnowledgeBase(companyId, message.trim());
      if (searchResults.length > 0) {
        kbData = searchResults.map((r) => ({
          title: (r.metadata?.sourceEntryTitle as string) || 'Knowledge Base',
          content: r.content,
          knowledge_base_id: r.knowledgeBaseId,
        }));
      }
    }
    if (kbData.length === 0) {
      const { data: kbEntries } = await supabaseAdmin
        .from('knowledge_base_entries')
        .select('id, title, content, knowledge_base_id')
        .eq('company_id', companyId);
      kbData = (kbEntries || []) as KBEntry[];
    }

    const hasScenarios = !!(resolvedProfileData.response_flow?.scenarios?.length);
    const testMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: message.trim() },
    ];

    let matched_scenario: string | null = null;
    let confidence: 'high' | 'medium' | 'low' | null = null;
    let systemPrompt: string;

    if (hasScenarios) {
      // Step 1: Classify with Haiku
      const classification = await classifyMessage(resolvedProfileData, testMessages);
      matched_scenario = classification.scenario_label;
      confidence = classification.confidence;

      // Step 2: Build targeted response prompt
      systemPrompt = await buildScenarioResponsePrompt(
        resolvedProfileData, kbData, matched_scenario,
      );
    } else {
      // Legacy path
      systemPrompt = await buildSystemPrompt(resolvedProfileData, kbData);
    }

    // Step 3: Generate response with Sonnet
    const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: systemPrompt,
      messages: testMessages,
    });

    const responseText = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    res.json({ matched_scenario, confidence, response: responseText });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// KNOWLEDGE BASE ROUTES
// ────────────────────────────────────────────────

// List all knowledge bases for the company (with entry counts)
router.get('/kbs', requirePermission('knowledge_base', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    const { data, error } = await supabaseAdmin
      .from('knowledge_bases')
      .select('*, knowledge_base_entries(count)')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const knowledgeBases = (data || []).map((kb: Record<string, unknown>) => {
      const entries = kb.knowledge_base_entries as Array<{ count: number }> | undefined;
      return {
        id: kb.id,
        name: kb.name,
        description: kb.description,
        entry_count: entries?.[0]?.count ?? 0,
        created_at: kb.created_at,
        updated_at: kb.updated_at,
      };
    });

    res.json({ knowledge_bases: knowledgeBases });
  } catch (err) {
    next(err);
  }
});

// Create a knowledge base
router.post('/kbs', requirePermission('knowledge_base', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { name, description } = req.body;

    if (!name?.trim()) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('knowledge_bases')
      .insert({
        company_id: companyId,
        created_by: req.userId,
        name: name.trim(),
        description: description?.trim() || null,
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ knowledge_base: { ...data, entry_count: 0 } });
  } catch (err) {
    next(err);
  }
});

// Update a knowledge base
router.put('/kbs/:kbId', requirePermission('knowledge_base', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { kbId } = req.params;
    const { name, description } = req.body;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description?.trim() || null;

    const { data, error } = await supabaseAdmin
      .from('knowledge_bases')
      .update(updates)
      .eq('id', kbId)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) throw error;
    res.json({ knowledge_base: data });
  } catch (err) {
    next(err);
  }
});

// Delete a knowledge base (cascade deletes entries)
router.delete('/kbs/:kbId', requirePermission('knowledge_base', 'delete'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { kbId } = req.params;

    // Delete file storage for any file entries in this KB
    const { data: fileEntries } = await supabaseAdmin
      .from('knowledge_base_entries')
      .select('file_url')
      .eq('knowledge_base_id', kbId)
      .eq('company_id', companyId)
      .not('file_url', 'is', null);

    if (fileEntries && fileEntries.length > 0) {
      const filePaths = fileEntries.map((e) => e.file_url).filter(Boolean) as string[];
      if (filePaths.length > 0) {
        await supabaseAdmin.storage.from('knowledge-base').remove(filePaths);
      }
    }

    const { error } = await supabaseAdmin
      .from('knowledge_bases')
      .delete()
      .eq('id', kbId)
      .eq('company_id', companyId);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// KB ENTRY ROUTES (scoped under a knowledge base)
// ────────────────────────────────────────────────

// List entries in a knowledge base (with chunk counts)
router.get('/kbs/:kbId/entries', requirePermission('knowledge_base', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const kbId = req.params.kbId as string;

    const { data, error } = await supabaseAdmin
      .from('knowledge_base_entries')
      .select('*')
      .eq('knowledge_base_id', kbId)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const entries = data || [];

    // Batch-fetch chunk counts for all entries
    if (entries.length > 0) {
      const entryIds = entries.map((e: { id: string }) => e.id);
      const { data: chunks } = await supabaseAdmin
        .from('kb_chunks')
        .select('entry_id')
        .in('entry_id', entryIds);

      if (chunks) {
        const countMap = new Map<string, number>();
        for (const chunk of chunks) {
          countMap.set(chunk.entry_id, (countMap.get(chunk.entry_id) || 0) + 1);
        }
        for (const entry of entries) {
          (entry as Record<string, unknown>).chunk_count = countMap.get(entry.id) || 0;
        }
      }
    }

    res.json({ entries });
  } catch (err) {
    next(err);
  }
});

// List all entries flat (for prompt builder / scenario picker)
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

// Add text entry to a knowledge base
router.post('/kbs/:kbId/entries', requirePermission('knowledge_base', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const kbId = req.params.kbId as string;
    const { title, content } = req.body as { title: string; content: string };

    if (!title || !content) {
      res.status(400).json({ error: 'Title and content are required' });
      return;
    }

    const cleanedContent = cleanText(content);

    const { data, error } = await supabaseAdmin
      .from('knowledge_base_entries')
      .insert({
        company_id: companyId,
        created_by: req.userId,
        knowledge_base_id: kbId,
        title,
        content: cleanedContent,
        source_type: 'text',
      })
      .select()
      .single();

    if (error) throw error;

    // Generate chunks and embeddings synchronously
    if (isEmbeddingsAvailable() && data) {
      await processAndEmbedEntry(data.id, cleanedContent, kbId, companyId, title, null, 'text');
    }

    res.json({ entry: data });
  } catch (err) {
    next(err);
  }
});

// Upload file entry to a knowledge base
router.post('/kbs/:kbId/entries/upload', requirePermission('knowledge_base', 'create'), upload.single('file'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const kbId = req.params.kbId as string;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    // Process document: extract, clean, structure, extract metadata
    const processed = await processDocument(file.buffer, file.originalname, file.mimetype);

    if (!processed.cleanedText.trim()) {
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
    const title = (req.body.title as string) || file.originalname.replace(/\.[^.]+$/, '');

    const { data, error } = await supabaseAdmin
      .from('knowledge_base_entries')
      .insert({
        company_id: companyId,
        created_by: req.userId,
        knowledge_base_id: kbId,
        title,
        content: processed.cleanedText,
        source_type: 'file',
        file_name: file.originalname,
        file_url: fileUrl,
      })
      .select()
      .single();

    if (error) throw error;

    // Generate chunks and embeddings from structured text (preserves headings)
    if (isEmbeddingsAvailable() && data) {
      await processAndEmbedEntry(
        data.id,
        processed.structuredText,
        kbId,
        companyId,
        title,
        file.originalname,
        processed.metadata.sourceType,
      );
    }

    res.json({ entry: data, warnings: processed.warnings });
  } catch (err) {
    next(err);
  }
});

// Update an entry in a knowledge base
router.put('/kbs/:kbId/entries/:entryId', requirePermission('knowledge_base', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const kbId = req.params.kbId as string;
    const entryId = req.params.entryId as string;
    const { title, content } = req.body as { title?: string; content?: string };

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = cleanText(content);

    const { data, error } = await supabaseAdmin
      .from('knowledge_base_entries')
      .update(updates)
      .eq('id', entryId)
      .eq('knowledge_base_id', kbId)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) throw error;

    // Re-chunk and re-embed if content was updated
    if (content !== undefined && isEmbeddingsAvailable() && data) {
      await processAndEmbedEntry(
        entryId,
        cleanText(content),
        kbId,
        companyId,
        data.title,
        data.file_name ?? null,
        data.source_type || 'text',
      );
    }

    res.json({ entry: data });
  } catch (err) {
    next(err);
  }
});

// Delete an entry from a knowledge base
router.delete('/kbs/:kbId/entries/:entryId', requirePermission('knowledge_base', 'delete'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { kbId, entryId } = req.params;

    const { data: entry } = await supabaseAdmin
      .from('knowledge_base_entries')
      .select('file_url')
      .eq('id', entryId)
      .eq('knowledge_base_id', kbId)
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
      .eq('knowledge_base_id', kbId)
      .eq('company_id', companyId);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// CHUNK & SEARCH ROUTES
// ────────────────────────────────────────────────

// Get chunks for a specific entry
router.get('/kbs/:kbId/entries/:entryId/chunks', requirePermission('knowledge_base', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const entryId = req.params.entryId as string;

    const { data, error } = await supabaseAdmin
      .from('kb_chunks')
      .select('id, chunk_index, content, metadata, created_at')
      .eq('entry_id', entryId)
      .eq('company_id', companyId)
      .order('chunk_index', { ascending: true });

    if (error) throw error;
    res.json({ chunks: data || [] });
  } catch (err) {
    next(err);
  }
});

// Re-embed a specific entry
router.post('/kbs/:kbId/entries/:entryId/reembed', requirePermission('knowledge_base', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const kbId = req.params.kbId as string;
    const entryId = req.params.entryId as string;

    if (!isEmbeddingsAvailable()) {
      res.status(503).json({ error: 'Embeddings not configured' });
      return;
    }

    const { data: entry, error } = await supabaseAdmin
      .from('knowledge_base_entries')
      .select('id, title, content, file_name, source_type')
      .eq('id', entryId)
      .eq('knowledge_base_id', kbId)
      .eq('company_id', companyId)
      .single();

    if (error || !entry) {
      res.status(404).json({ error: 'Entry not found' });
      return;
    }

    await processAndEmbedEntry(
      entry.id,
      cleanText(entry.content),
      kbId,
      companyId,
      entry.title,
      entry.file_name ?? null,
      entry.source_type || 'text',
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Test search against the knowledge base
router.post('/kb/search', requirePermission('knowledge_base', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { query, knowledge_base_ids } = req.body as { query: string; knowledge_base_ids?: string[] };

    if (!query?.trim()) {
      res.status(400).json({ error: 'Query is required' });
      return;
    }

    if (!isEmbeddingsAvailable()) {
      res.status(503).json({ error: 'Embeddings not configured' });
      return;
    }

    const results = await searchKnowledgeBase(companyId, query.trim(), {
      knowledgeBaseIds: knowledge_base_ids,
      matchCount: 10,
    });

    res.json({ results });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// EMBEDDINGS BACKFILL
// ────────────────────────────────────────────────

// Backfill embeddings for all existing entries that don't have them yet
router.post('/backfill-embeddings', requirePermission('knowledge_base', 'edit'), async (req, res, next) => {
  try {
    if (!isEmbeddingsAvailable()) {
      res.status(503).json({ error: 'Embeddings not configured (missing OPENAI_API_KEY)' });
      return;
    }

    const result = await backfillExistingEntries();
    res.json({ message: 'Backfill completed', ...result });
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
      default_language, agent_id,
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
