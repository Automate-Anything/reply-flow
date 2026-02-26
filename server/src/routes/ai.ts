import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { supabaseAdmin } from '../config/supabase.js';

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
// AI PROFILE ROUTES (per-channel)
// ────────────────────────────────────────────────

// Get AI profile for a channel
router.get('/profile/:channelId', requirePermission('ai_settings', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const channelId = Number(req.params.channelId);

    // Verify channel ownership
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
      .from('channel_ai_profiles')
      .select('*')
      .eq('channel_id', channelId)
      .single();

    if (error && error.code === 'PGRST116') {
      // No profile yet — return defaults
      res.json({
        profile: {
          is_enabled: false,
          profile_data: {},
          max_tokens: 500,
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

// Upsert AI profile for a channel
router.put('/profile/:channelId', requirePermission('ai_settings', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const channelId = Number(req.params.channelId);
    const { is_enabled, profile_data, max_tokens } = req.body;

    // Verify channel ownership
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
      created_by: req.userId,
      updated_at: new Date().toISOString(),
    };
    if (is_enabled !== undefined) updates.is_enabled = is_enabled;
    if (profile_data !== undefined) updates.profile_data = profile_data;
    if (max_tokens !== undefined) updates.max_tokens = max_tokens;

    const { data, error } = await supabaseAdmin
      .from('channel_ai_profiles')
      .upsert(updates, { onConflict: 'channel_id' })
      .select()
      .single();

    if (error) throw error;
    res.json({ profile: data });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// KNOWLEDGE BASE ROUTES
// ────────────────────────────────────────────────

// List KB entries for a channel
router.get('/kb/:channelId', requirePermission('knowledge_base', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const channelId = Number(req.params.channelId);

    const { data, error } = await supabaseAdmin
      .from('knowledge_base_entries')
      .select('*')
      .eq('channel_id', channelId)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ entries: data || [] });
  } catch (err) {
    next(err);
  }
});

// Add text KB entry
router.post('/kb/:channelId', requirePermission('knowledge_base', 'create'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const channelId = Number(req.params.channelId);
    const { title, content } = req.body;

    if (!title || !content) {
      res.status(400).json({ error: 'Title and content are required' });
      return;
    }

    // Verify channel ownership
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
      .from('knowledge_base_entries')
      .insert({
        channel_id: channelId,
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

// Upload file KB entry
router.post('/kb/:channelId/upload', requirePermission('knowledge_base', 'create'), upload.single('file'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const channelId = Number(req.params.channelId);
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    // Verify channel ownership
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
    const storagePath = `${companyId}/${channelId}/${Date.now()}_${file.originalname}`;
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
        channel_id: channelId,
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

    // Get the entry to check for file_url
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

    // Delete file from storage if it exists
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
