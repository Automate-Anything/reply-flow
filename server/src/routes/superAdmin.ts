import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireSuperAdmin } from '../middleware/superAdmin.js';
import { supabaseAdmin } from '../config/supabase.js';
import { buildSystemPrompt, invalidateTemplateCache } from '../services/promptBuilder.js';
import type { ProfileData, KBEntry } from '../services/promptBuilder.js';
import { invalidateRetrievalSettingsCache } from '../services/retrievalSettings.js';

const router = Router();
router.use(requireAuth);
router.use(requireSuperAdmin);

// ── GET /stats ─────────────────────────────────────
router.get('/stats', async (_req, res, next) => {
  try {
    const [
      { count: usersCount },
      { count: companiesCount },
      { count: agentsCount },
      { count: kbsCount },
      { count: entriesCount },
      { count: chunksCount },
      { data: embeddingRows },
    ] = await Promise.all([
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('companies').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('ai_agents').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('knowledge_bases').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('knowledge_base_entries').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('kb_chunks').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('knowledge_base_entries').select('embedding_status'),
    ]);

    const embeddingCounts: Record<string, number> = {};
    for (const row of embeddingRows || []) {
      const status = row.embedding_status || 'pending';
      embeddingCounts[status] = (embeddingCounts[status] || 0) + 1;
    }
    const embeddingStatus = Object.entries(embeddingCounts).map(([status, count]) => ({ status, count }));

    res.json({
      users: usersCount || 0,
      companies: companiesCount || 0,
      agents: agentsCount || 0,
      knowledge_bases: kbsCount || 0,
      entries: entriesCount || 0,
      chunks: chunksCount || 0,
      embedding_status: embeddingStatus || [],
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /companies ─────────────────────────────────
router.get('/companies', async (req, res, next) => {
  try {
    const search = (req.query.search as string) || '';
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('companies')
      .select('id, name, slug, created_at', { count: 'exact' });

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    const { data: companies, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Get member and agent counts for each company
    const enriched = await Promise.all(
      (companies || []).map(async (company) => {
        const [{ count: memberCount }, { count: agentCount }] = await Promise.all([
          supabaseAdmin.from('company_members').select('*', { count: 'exact', head: true }).eq('company_id', company.id),
          supabaseAdmin.from('ai_agents').select('*', { count: 'exact', head: true }).eq('company_id', company.id),
        ]);
        return { ...company, member_count: memberCount || 0, agent_count: agentCount || 0 };
      })
    );

    res.json({ companies: enriched, total: count || 0, page, limit });
  } catch (err) {
    next(err);
  }
});

// ── GET /prompt-templates ──────────────────────────
router.get('/prompt-templates', async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('prompt_templates')
      .select('*')
      .order('category')
      .order('key');

    if (error) throw error;

    // Group by category
    const grouped: Record<string, typeof data> = {};
    for (const row of data || []) {
      if (!grouped[row.category]) grouped[row.category] = [];
      grouped[row.category].push(row);
    }

    res.json({ templates: grouped });
  } catch (err) {
    next(err);
  }
});

// ── PUT /prompt-templates/:key ─────────────────────
router.put('/prompt-templates/:key', async (req, res, next) => {
  try {
    const { key } = req.params;
    const { content } = req.body;

    if (!content || typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ error: 'content is required and must be non-empty' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('prompt_templates')
      .update({ content: content.trim(), updated_by: req.userId })
      .eq('key', key)
      .select()
      .single();

    if (error) throw error;
    if (!data) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    invalidateTemplateCache();
    res.json({ template: data });
  } catch (err) {
    next(err);
  }
});

// ── POST /prompt-preview ───────────────────────────
router.post('/prompt-preview', async (req, res, next) => {
  try {
    const { profileData, kbEntries } = req.body as {
      profileData: ProfileData;
      kbEntries?: KBEntry[];
    };

    if (!profileData) {
      res.status(400).json({ error: 'profileData is required' });
      return;
    }

    const prompt = await buildSystemPrompt(profileData, kbEntries || []);
    res.json({ prompt, character_count: prompt.length });
  } catch (err) {
    next(err);
  }
});

// ── GET /companies/:companyId/agents ───────────────
router.get('/companies/:companyId/agents', async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { data, error } = await supabaseAdmin
      .from('ai_agents')
      .select('id, name, created_at')
      .eq('company_id', companyId)
      .order('name');

    if (error) throw error;
    res.json({ agents: data || [] });
  } catch (err) {
    next(err);
  }
});

// ── GET /agents/:agentId ───────────────────────────
router.get('/agents/:agentId', async (req, res, next) => {
  try {
    const { agentId } = req.params;
    const { data, error } = await supabaseAdmin
      .from('ai_agents')
      .select('id, name, company_id, profile_data, created_at')
      .eq('id', agentId)
      .single();

    if (error) throw error;
    if (!data) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    res.json({ agent: data });
  } catch (err) {
    next(err);
  }
});

// ── GET /knowledge-bases ───────────────────────────
router.get('/knowledge-bases', async (req, res, next) => {
  try {
    const companyFilter = req.query.companyId as string | undefined;

    let query = supabaseAdmin
      .from('knowledge_bases')
      .select('id, name, description, company_id, created_at, companies(name)');

    if (companyFilter) {
      query = query.eq('company_id', companyFilter);
    }

    const { data: kbs, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;

    // Enrich with entry and chunk counts
    const enriched = await Promise.all(
      (kbs || []).map(async (kb) => {
        const [{ count: entryCount }, { count: chunkCount }] = await Promise.all([
          supabaseAdmin.from('knowledge_base_entries').select('*', { count: 'exact', head: true }).eq('knowledge_base_id', kb.id),
          supabaseAdmin.from('kb_chunks').select('*', { count: 'exact', head: true }).eq('knowledge_base_id', kb.id),
        ]);
        return {
          ...kb,
          company_name: (kb.companies as any)?.name || 'Unknown',
          entry_count: entryCount || 0,
          chunk_count: chunkCount || 0,
        };
      })
    );

    res.json({ knowledge_bases: enriched });
  } catch (err) {
    next(err);
  }
});

// ── GET /knowledge-bases/:kbId/entries ─────────────
router.get('/knowledge-bases/:kbId/entries', async (req, res, next) => {
  try {
    const { kbId } = req.params;

    const { data: entries, error } = await supabaseAdmin
      .from('knowledge_base_entries')
      .select('id, title, content, source_type, file_name, embedding_status, created_at')
      .eq('knowledge_base_id', kbId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Enrich with chunk count per entry, strip full content from response
    const enriched = await Promise.all(
      (entries || []).map(async (entry) => {
        const { count } = await supabaseAdmin
          .from('kb_chunks')
          .select('*', { count: 'exact', head: true })
          .eq('entry_id', entry.id);
        const { content, ...rest } = entry;
        return { ...rest, chunk_count: count || 0, content_length: content?.length || 0 };
      })
    );

    res.json({ entries: enriched });
  } catch (err) {
    next(err);
  }
});

// ── GET /entries/:entryId/pipeline ─────────────────
router.get('/entries/:entryId/pipeline', async (req, res, next) => {
  try {
    const { entryId } = req.params;
    const includeContent = req.query.include_content === 'true';

    // Get entry
    const { data: entry, error: entryErr } = await supabaseAdmin
      .from('knowledge_base_entries')
      .select('id, title, source_type, file_name, content, embedding_status, created_at')
      .eq('id', entryId)
      .single();

    if (entryErr || !entry) {
      res.status(404).json({ error: 'Entry not found' });
      return;
    }

    // Get chunks
    const { data: chunks, error: chunksErr } = await supabaseAdmin
      .from('kb_chunks')
      .select('id, chunk_index, content, metadata, embedding')
      .eq('entry_id', entryId)
      .order('chunk_index');

    if (chunksErr) throw chunksErr;

    const chunkData = (chunks || []).map((c) => ({
      id: c.id,
      chunk_index: c.chunk_index,
      content_preview: c.content?.substring(0, 200) || '',
      content_length: c.content?.length || 0,
      has_embedding: !!c.embedding,
      metadata: c.metadata || {},
      ...(includeContent ? { full_content: c.content || '' } : {}),
    }));

    const chunkSizes = chunkData.map(c => c.content_length);
    const stats = {
      total_chunks: chunkData.length,
      avg_chunk_size: chunkSizes.length > 0 ? Math.round(chunkSizes.reduce((a, b) => a + b, 0) / chunkSizes.length) : 0,
      min_chunk_size: chunkSizes.length > 0 ? Math.min(...chunkSizes) : 0,
      max_chunk_size: chunkSizes.length > 0 ? Math.max(...chunkSizes) : 0,
      chunks_with_embeddings: chunkData.filter(c => c.has_embedding).length,
      chunks_without_embeddings: chunkData.filter(c => !c.has_embedding).length,
    };

    res.json({
      entry: {
        id: entry.id,
        title: entry.title,
        source_type: entry.source_type,
        file_name: entry.file_name,
        content_length: entry.content?.length || 0,
        embedding_status: entry.embedding_status,
        created_at: entry.created_at,
      },
      chunks: chunkData,
      stats,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /entries/:entryId/content ─────────────────
router.get('/entries/:entryId/content', async (req, res, next) => {
  try {
    const { entryId } = req.params;

    const { data: entry, error } = await supabaseAdmin
      .from('knowledge_base_entries')
      .select('id, content')
      .eq('id', entryId)
      .single();

    if (error || !entry) {
      res.status(404).json({ error: 'Entry not found' });
      return;
    }

    res.json({
      id: entry.id,
      content: entry.content || '',
      content_length: entry.content?.length || 0,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /knowledge-bases/:kbId/analytics ──────────
router.get('/knowledge-bases/:kbId/analytics', async (req, res, next) => {
  try {
    const { kbId } = req.params;

    // Fetch chunk sizes and embedding existence in parallel
    const [{ data: chunks, error: chunksErr }, { data: entries, error: entriesErr }] = await Promise.all([
      supabaseAdmin
        .from('kb_chunks')
        .select('id, content, embedding')
        .eq('knowledge_base_id', kbId),
      supabaseAdmin
        .from('knowledge_base_entries')
        .select('id, embedding_status')
        .eq('knowledge_base_id', kbId),
    ]);

    if (chunksErr) throw chunksErr;
    if (entriesErr) throw entriesErr;

    const allChunks = chunks || [];
    const chunkSizes = allChunks.map((c) => c.content?.length || 0);

    // Chunk size distribution buckets
    const distribution: Record<string, number> = {
      '0-500': 0,
      '500-1000': 0,
      '1000-2000': 0,
      '2000-3000': 0,
      '3000+': 0,
    };
    for (const size of chunkSizes) {
      if (size <= 500) distribution['0-500']++;
      else if (size <= 1000) distribution['500-1000']++;
      else if (size <= 2000) distribution['1000-2000']++;
      else if (size <= 3000) distribution['2000-3000']++;
      else distribution['3000+']++;
    }

    const withEmbedding = allChunks.filter((c) => !!c.embedding).length;
    const totalChars = chunkSizes.reduce((a, b) => a + b, 0);
    const embeddedChars = allChunks
      .filter((c) => !!c.embedding)
      .reduce((sum, c) => sum + (c.content?.length || 0), 0);

    // Entry status breakdown
    const statusCounts: Record<string, number> = {};
    for (const e of entries || []) {
      const status = e.embedding_status || 'pending';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    }

    res.json({
      total_chunks: allChunks.length,
      chunks_with_embeddings: withEmbedding,
      chunks_without_embeddings: allChunks.length - withEmbedding,
      embedding_completion_pct: allChunks.length > 0
        ? Math.round((withEmbedding / allChunks.length) * 100)
        : 0,
      avg_chunk_size: chunkSizes.length > 0
        ? Math.round(totalChars / chunkSizes.length)
        : 0,
      min_chunk_size: chunkSizes.length > 0 ? Math.min(...chunkSizes) : 0,
      max_chunk_size: chunkSizes.length > 0 ? Math.max(...chunkSizes) : 0,
      total_characters: totalChars,
      embedded_characters: embeddedChars,
      chunk_size_distribution: distribution,
      entry_status_breakdown: Object.entries(statusCounts).map(
        ([status, count]) => ({ status, count })
      ),
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /retrieval-settings ────────────────────────
router.get('/retrieval-settings', async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('retrieval_settings')
      .select('key, value, label, description, updated_at')
      .order('key');

    if (error) throw error;
    res.json({ settings: data || [] });
  } catch (err) {
    next(err);
  }
});

// ── PUT /retrieval-settings/:key ──────────────────
router.put('/retrieval-settings/:key', async (req, res, next) => {
  try {
    const { key } = req.params;
    const { value } = req.body as { value: string };

    if (value === undefined || value === null || String(value).trim() === '') {
      res.status(400).json({ error: 'value is required' });
      return;
    }

    const numValue = parseFloat(String(value));
    if (isNaN(numValue) || numValue < 0) {
      res.status(400).json({ error: 'value must be a non-negative number' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('retrieval_settings')
      .update({ value: String(numValue), updated_by: req.userId, updated_at: new Date().toISOString() })
      .eq('key', key)
      .select()
      .single();

    if (error) throw error;
    if (!data) {
      res.status(404).json({ error: 'Setting not found' });
      return;
    }

    invalidateRetrievalSettingsCache();
    res.json({ setting: data });
  } catch (err) {
    next(err);
  }
});

export default router;
