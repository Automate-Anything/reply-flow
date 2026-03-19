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
import { processAndEmbedEntry, isEmbeddingsAvailable, searchKnowledgeBase, backfillExistingEntries, generateEmbedding } from '../services/embeddings.js';
import { classifyQuery } from '../services/queryClassifier.js';
import { sseWrite } from '../services/pipelineEvents.js';
import type { PipelineEvent, PipelineProgressCallback } from '../services/pipelineEvents.js';
import { sendHandoffNotification } from '../services/handoffNotifier.js';
import { streamSuggestion } from '../services/suggestion.js';
import { suggestionLimiter } from '../middleware/rateLimit.js';
import { z } from 'zod';

const suggestSchema = z.object({
  sessionId: z.string().uuid(),
  mode: z.enum(['generate', 'complete', 'rewrite']),
  existingText: z.string().optional(),
});

const router = Router();
router.use(requireAuth);

// Multer: memory storage, 1GB limit, accept all text-based files
// Content classifier determines processing strategy per file type
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024 },
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
// PROMPT PREVIEW (debug mode — build prompt without sending)
// ────────────────────────────────────────────────

router.post('/preview-prompt', requirePermission('ai_settings', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { profile_data, agentId, matched_scenario } = req.body as {
      profile_data?: ProfileData;
      agentId?: string;
      matched_scenario?: string | null;
    };

    // Resolve profile data
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

    // Load KB entries for context
    let kbData: KBEntry[] = [];
    const { data: kbEntries } = await supabaseAdmin
      .from('knowledge_base_entries')
      .select('id, title, content, knowledge_base_id')
      .eq('company_id', companyId)
      .limit(20);
    kbData = (kbEntries || []) as KBEntry[];

    // Build prompt with section tracking
    const sections: { name: string; content: string }[] = [];
    const onSection = (section: { name: string; content: string }) => {
      sections.push(section);
    };

    const hasScenarios = !!(resolvedProfileData.response_flow?.scenarios?.length);
    let systemPrompt: string;

    if (hasScenarios && matched_scenario !== undefined) {
      systemPrompt = await buildScenarioResponsePrompt(
        resolvedProfileData, kbData, matched_scenario ?? null, undefined, onSection,
      );
    } else {
      systemPrompt = await buildSystemPrompt(resolvedProfileData, kbData, undefined, onSection);
    }

    res.json({ sections, systemPrompt, kbEntryCount: kbData.length });
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
    const { profile_data, message, agentId, include_debug } = req.body as {
      profile_data?: ProfileData;
      message: string;
      agentId?: string;
      include_debug?: boolean;
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

    // Load relevant KB entries via smart search (or fall back to loading all)
    let kbData: KBEntry[] = [];
    if (isEmbeddingsAvailable()) {
      const qc = classifyQuery(message.trim());
      const searchResults = await searchKnowledgeBase(companyId, message.trim(), {
        retrievalMethod: qc.method,
        vectorWeight: qc.vectorWeight,
        ftsWeight: qc.ftsWeight,
      });
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

    // Track prompt sections when debug is requested
    const promptSections: { name: string; content: string }[] = [];
    const onSection = include_debug
      ? (section: { name: string; content: string }) => { promptSections.push(section); }
      : undefined;

    if (hasScenarios) {
      // Step 1: Classify with Haiku
      const classification = await classifyMessage(resolvedProfileData, testMessages);
      matched_scenario = classification.scenario_label;
      confidence = classification.confidence;

      const matchedScenario = matched_scenario
        ? resolvedProfileData.response_flow?.scenarios?.find((scenario) => scenario.label === matched_scenario)
        : null;

      // Step 2: Build targeted response prompt
      systemPrompt = await buildScenarioResponsePrompt(
        resolvedProfileData, kbData, matched_scenario, undefined, onSection,
      );

      if (matchedScenario?.do_not_respond) {
        const result: Record<string, unknown> = {
          matched_scenario,
          confidence,
          response: '',
          suppressed: true,
        };

        if (include_debug) {
          result.debug = {
            promptSections,
            systemPrompt,
            tokens: { input: 0, output: 0 },
            responseTimeMs: 0,
            model: 'suppressed',
            stopReason: 'scenario_do_not_respond',
            kbEntriesUsed: kbData.length,
          };
        }

        res.json(result);
        return;
      }
    } else {
      // Legacy path
      systemPrompt = await buildSystemPrompt(resolvedProfileData, kbData, undefined, onSection);
    }

    // Step 3: Generate response with Sonnet
    const startTime = Date.now();
    const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: systemPrompt,
      messages: testMessages,
    });
    const responseTimeMs = Date.now() - startTime;

    const responseText = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    const result: Record<string, unknown> = { matched_scenario, confidence, response: responseText };

    if (include_debug) {
      result.debug = {
        promptSections,
        systemPrompt,
        tokens: { input: response.usage?.input_tokens, output: response.usage?.output_tokens },
        responseTimeMs,
        model: response.model,
        stopReason: response.stop_reason,
        kbEntriesUsed: kbData.length,
      };
    }

    res.json(result);
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
      data.embedding_status = 'completed';
    }

    res.json({ entry: data });
  } catch (err) {
    next(err);
  }
});

// ── SSE streaming text entry (debug mode) ─────────
router.post('/kbs/:kbId/entries/stream', requirePermission('knowledge_base', 'create'), async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const onProgress: PipelineProgressCallback = (event: PipelineEvent) => {
    sseWrite(res, event);
  };

  try {
    const companyId = req.companyId!;
    const kbId = req.params.kbId as string;
    const { title, content } = req.body as { title: string; content: string };

    if (!title || !content) {
      sseWrite(res, { step: 'error', status: 'error', error: 'Title and content are required', timestamp: Date.now() });
      res.end();
      return;
    }

    sseWrite(res, { step: 'cleaning', status: 'started', timestamp: Date.now() });
    const cleanedContent = cleanText(content);
    sseWrite(res, { step: 'cleaning', status: 'completed', data: { cleanedLength: cleanedContent.length }, timestamp: Date.now() });

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

    if (isEmbeddingsAvailable() && data) {
      await processAndEmbedEntry(data.id, cleanedContent, kbId, companyId, title, null, 'text', undefined, undefined, onProgress);
      data.embedding_status = 'completed';
    }

    sseWrite(res, { step: 'complete', status: 'completed', data: { entry: data }, timestamp: Date.now() });
  } catch (err) {
    sseWrite(res, { step: 'error', status: 'error', error: String(err), timestamp: Date.now() });
  } finally {
    res.end();
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
    let processed;
    try {
      processed = await processDocument(file.buffer, file.originalname, file.mimetype);
    } catch (docErr: any) {
      console.error('[upload] Document processing failed:', docErr);
      res.status(400).json({ error: `Failed to process file: ${docErr.message || 'Unknown error'}` });
      return;
    }

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

    // Generate chunks and embeddings from structured text (content-aware)
    if (isEmbeddingsAvailable() && data) {
      await processAndEmbedEntry(
        data.id,
        processed.structuredText,
        kbId,
        companyId,
        title,
        file.originalname,
        processed.metadata.sourceType,
        processed.metadata.contentType,
        processed.metadata.strategy,
      );
      data.embedding_status = 'completed';
    }

    res.json({ entry: data, warnings: processed.warnings });
  } catch (err) {
    next(err);
  }
});

// ── SSE streaming file upload (debug mode) ────────
router.post('/kbs/:kbId/entries/upload/stream', requirePermission('knowledge_base', 'create'), upload.single('file'), async (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const onProgress: PipelineProgressCallback = (event: PipelineEvent) => {
    sseWrite(res, event);
  };

  try {
    const companyId = req.companyId!;
    const kbId = req.params.kbId as string;
    const file = req.file;

    if (!file) {
      sseWrite(res, { step: 'error', status: 'error', error: 'No file uploaded', timestamp: Date.now() });
      res.end();
      return;
    }

    // Process document with progress streaming (classification + extraction events emitted by processDocument)
    const processed = await processDocument(file.buffer, file.originalname, file.mimetype, onProgress);

    // Emit cleaning step (cleaning is done within extraction, but we show it separately for visibility)
    sseWrite(res, { step: 'cleaning', status: 'started', timestamp: Date.now() });
    sseWrite(res, {
      step: 'cleaning', status: 'completed',
      data: {
        cleanedLength: processed.cleanedText.length,
        structuredLength: processed.structuredText.length,
        warningCount: processed.warnings.length,
        warningTexts: processed.warnings,
        metadata: processed.metadata,
      },
      timestamp: Date.now(),
    });

    if (!processed.cleanedText.trim()) {
      sseWrite(res, { step: 'error', status: 'error', error: 'Could not extract text from file', timestamp: Date.now() });
      res.end();
      return;
    }

    // Upload file to Supabase Storage
    const storagePath = `${companyId}/kb/${Date.now()}_${file.originalname}`;
    const { error: storageError } = await supabaseAdmin.storage
      .from('knowledge-base')
      .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });

    if (storageError) console.error('Storage upload error:', storageError);

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

    // Generate chunks and embeddings with progress streaming
    if (isEmbeddingsAvailable() && data) {
      await processAndEmbedEntry(
        data.id, processed.structuredText, kbId, companyId, title,
        file.originalname, processed.metadata.sourceType,
        processed.metadata.contentType, processed.metadata.strategy,
        onProgress,
      );
      data.embedding_status = 'completed';
    }

    sseWrite(res, { step: 'complete', status: 'completed', data: { entry: data, warnings: processed.warnings }, timestamp: Date.now() });
  } catch (err) {
    sseWrite(res, { step: 'error', status: 'error', error: String(err), timestamp: Date.now() });
  } finally {
    res.end();
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

// Update a single chunk's content (auto re-embeds)
router.put('/kbs/:kbId/entries/:entryId/chunks/:chunkId', requirePermission('knowledge_base', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const entryId = req.params.entryId as string;
    const chunkId = req.params.chunkId as string;
    const { content } = req.body as { content?: string };

    if (!content?.trim()) {
      res.status(400).json({ error: 'Content is required' });
      return;
    }

    // Verify chunk belongs to this entry and company
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('kb_chunks')
      .select('id')
      .eq('id', chunkId)
      .eq('entry_id', entryId)
      .eq('company_id', companyId)
      .single();

    if (fetchErr || !existing) {
      res.status(404).json({ error: 'Chunk not found' });
      return;
    }

    const trimmedContent = content.trim();

    // Try to re-embed the updated content
    let reembedded = false;
    let newEmbedding: number[] | null = null;
    if (isEmbeddingsAvailable()) {
      try {
        newEmbedding = await generateEmbedding(trimmedContent);
        reembedded = true;
      } catch (err) {
        console.warn('Failed to re-embed chunk, saving content only:', err);
      }
    }

    // Build update payload
    const updatePayload: Record<string, unknown> = { content: trimmedContent };
    if (newEmbedding) {
      updatePayload.embedding = JSON.stringify(newEmbedding);
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('kb_chunks')
      .update(updatePayload)
      .eq('id', chunkId)
      .select('id, chunk_index, content, metadata, created_at')
      .single();

    if (updateErr) throw updateErr;
    res.json({ chunk: updated, reembedded });
  } catch (err) {
    next(err);
  }
});

// Delete a single chunk and re-index remaining chunks
router.delete('/kbs/:kbId/entries/:entryId/chunks/:chunkId', requirePermission('knowledge_base', 'delete'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const entryId = req.params.entryId as string;
    const chunkId = req.params.chunkId as string;

    // Verify chunk belongs to this entry and company
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('kb_chunks')
      .select('id')
      .eq('id', chunkId)
      .eq('entry_id', entryId)
      .eq('company_id', companyId)
      .single();

    if (fetchErr || !existing) {
      res.status(404).json({ error: 'Chunk not found' });
      return;
    }

    // Delete the chunk
    const { error: deleteErr } = await supabaseAdmin
      .from('kb_chunks')
      .delete()
      .eq('id', chunkId);

    if (deleteErr) throw deleteErr;

    // Re-index remaining chunks to keep sequential ordering
    const { data: remaining, error: remainErr } = await supabaseAdmin
      .from('kb_chunks')
      .select('id, metadata')
      .eq('entry_id', entryId)
      .eq('company_id', companyId)
      .order('chunk_index', { ascending: true });

    if (remainErr) throw remainErr;

    const total = remaining?.length || 0;
    if (remaining && remaining.length > 0) {
      for (let i = 0; i < remaining.length; i++) {
        const chunk = remaining[i];
        const meta = (chunk.metadata || {}) as Record<string, unknown>;
        await supabaseAdmin
          .from('kb_chunks')
          .update({
            chunk_index: i,
            metadata: { ...meta, chunkIndex: i, totalChunks: total },
          })
          .eq('id', chunk.id);
      }
    }

    res.json({ success: true, remainingChunks: total });
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

// ── Search helpers ───────────────────────────────

/** Extract a snippet centered around the best keyword match instead of taking the first N chars */
function extractSnippet(content: string, queryWords: string[], maxLen: number): string {
  if (!queryWords.length) return content.slice(0, maxLen);

  const lower = content.toLowerCase();
  let bestPos = -1;
  let bestWord = '';

  // Find the first occurrence of any query word
  for (const word of queryWords) {
    const pos = lower.indexOf(word);
    if (pos !== -1 && (bestPos === -1 || pos < bestPos)) {
      bestPos = pos;
      bestWord = word;
    }
  }

  // No keyword found — fall back to beginning
  if (bestPos === -1) return content.slice(0, maxLen);

  // Center the snippet around the match with some leading context
  const leadContext = 80; // chars of context before the match
  const start = Math.max(0, bestPos - leadContext);
  let snippet = content.slice(start, start + maxLen);

  // Clean up: don't start/end mid-word
  if (start > 0) {
    const firstSpace = snippet.indexOf(' ');
    if (firstSpace > 0 && firstSpace < 20) {
      snippet = '...' + snippet.slice(firstSpace + 1);
    } else {
      snippet = '...' + snippet;
    }
  }
  if (start + maxLen < content.length) {
    const lastSpace = snippet.lastIndexOf(' ');
    if (lastSpace > snippet.length - 20) {
      snippet = snippet.slice(0, lastSpace) + '...';
    } else {
      snippet = snippet + '...';
    }
  }

  return snippet;
}

/**
 * Filter out search results that are clearly irrelevant.
 * When some results have strong keyword matches and others don't,
 * the non-matching results are usually noise (RRF scores are too
 * compressed with k=60 to differentiate on score alone).
 */
function filterIrrelevantResults<T extends { rrfScore: number; vectorRank: number; ftsRank: number }>(results: T[]): T[] {
  if (results.length <= 1) return results;

  // Check if any results have strong keyword matches (low ftsRank)
  const hasKeywordMatches = results.some((r) => r.ftsRank > 0 && r.ftsRank <= 10);
  if (!hasKeywordMatches) return results; // Pure vector — can't differentiate further

  // When keyword matches exist, keep results that either:
  // 1. Have a keyword match (ftsRank ≤ 10), OR
  // 2. Are a strong vector match (vectorRank ≤ 2)
  return results.filter((r) =>
    (r.ftsRank > 0 && r.ftsRank <= 10) || (r.vectorRank > 0 && r.vectorRank <= 2)
  );
}

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

    const classification = classifyQuery(query.trim());

    const results = await searchKnowledgeBase(companyId, query.trim(), {
      knowledgeBaseIds: knowledge_base_ids,
      matchCount: 10,
      retrievalMethod: classification.method,
      vectorWeight: classification.vectorWeight,
      ftsWeight: classification.ftsWeight,
    });

    // Filter out clearly irrelevant results based on score gap from top result
    const filteredResults = filterIrrelevantResults(results);

    // Extract keyword-based snippets so the preview shows the matching text
    // instead of the first N chars (which may not contain the match)
    const queryWords = query.trim().toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const resultsWithSnippets = filteredResults.map((r) => ({
      ...r,
      snippet: extractSnippet(r.content, queryWords, 300),
    }));

    // Generate AI explanations for why each chunk was selected
    let finalResults = resultsWithSnippets;
    if (resultsWithSnippets.length > 0 && env.ANTHROPIC_API_KEY) {
      try {
        const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
        const chunksForPrompt = resultsWithSnippets.map((r, i) => `[Chunk ${i + 1}]: ${r.content.slice(0, 500)}`).join('\n\n');
        const response = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: `You are analyzing knowledge base search results. The user searched for: "${query.trim()}"

The search method used was ${classification.method.toUpperCase()} (${classification.reasoning}).

Here are the chunks returned:

${chunksForPrompt}

For each chunk, write a brief 1-sentence explanation of why it's relevant to the query. Focus on the semantic connection between the query and the chunk content.

Respond as a JSON array of strings, one per chunk. Example: ["Directly answers the question about...", "Contains related context about..."]
Return ONLY the JSON array, no other text.`,
          }],
        });
        const text = response.content[0].type === 'text' ? response.content[0].text : '';
        const reasons: string[] = JSON.parse(text);
        finalResults = resultsWithSnippets.map((r, i) => ({
          ...r,
          relevanceReason: reasons[i] || null,
        }));
      } catch (err) {
        console.warn('Failed to generate relevance explanations:', err);
      }
    }

    res.json({ results: finalResults, queryClassification: { method: classification.method, reasoning: classification.reasoning } });
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
          schedule_configured: false,
          ai_schedule: null,
      outside_hours_message: null,
      default_language: 'en',
      business_hours: null,
      response_mode: 'live',
      test_contact_ids: [],
      excluded_contact_ids: [],
      auto_reply_enabled: false,
      auto_reply_message: null,
      auto_reply_trigger: 'outside_hours',
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
      default_language, agent_id, response_mode, test_contact_ids, excluded_contact_ids,
      auto_reply_enabled, auto_reply_message, auto_reply_trigger,
    } = req.body;

    const { data: channel } = await supabaseAdmin
      .from('channels')
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
    if (schedule_mode !== undefined || ai_schedule !== undefined || outside_hours_message !== undefined) {
      updates.schedule_configured = true;
    }
    if (default_language !== undefined) updates.default_language = default_language;
    if (agent_id !== undefined) updates.agent_id = agent_id;
    if (response_mode !== undefined) updates.response_mode = response_mode;
    if (test_contact_ids !== undefined) updates.test_contact_ids = test_contact_ids;
    if (excluded_contact_ids !== undefined) updates.excluded_contact_ids = excluded_contact_ids;
    if (auto_reply_enabled !== undefined) updates.auto_reply_enabled = auto_reply_enabled;
    if (auto_reply_message !== undefined) updates.auto_reply_message = auto_reply_message;
    if (auto_reply_trigger !== undefined) {
      const validTriggers = ['outside_hours', 'all_unavailable'];
      if (!validTriggers.includes(auto_reply_trigger)) {
        res.status(400).json({ error: `Invalid auto_reply_trigger. Must be one of: ${validTriggers.join(', ')}` });
        return;
      }
      updates.auto_reply_trigger = auto_reply_trigger;
    }

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

    // Notify assignee or channel owner (skip self-notification)
    sendHandoffNotification(
      companyId,
      sessionId as string,
      'AI manually paused',
      req.userId,
    ).catch((err) => console.error('Handoff notification error:', err));

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

// ── AI Suggestion (streaming SSE) ─────────────────────

router.post(
  '/suggest',
  requirePermission('messages', 'create'),
  suggestionLimiter,
  async (req, res) => {
    const parsed = suggestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      return;
    }

    const { sessionId, mode, existingText } = parsed.data;

    await streamSuggestion(
      req.companyId!,
      sessionId,
      req.userId!,
      existingText,
      mode,
      res,
    );
  },
);

export default router;
