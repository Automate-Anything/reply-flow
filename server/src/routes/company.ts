import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { requirePermission } from '../middleware/permissions.js';
import * as whapi from '../services/whapi.js';

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
    }
  },
});

const router = Router();
router.use(requireAuth);

// ────────────────────────────────────────────────
// CREATE COMPANY (for users with no company)
// ────────────────────────────────────────────────
router.post('/create', async (req, res, next) => {
  try {
    const userId = req.userId!;

    // Check if user already has a company
    const { data: existing } = await supabaseAdmin
      .from('company_members')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (existing) {
      res.status(409).json({ error: 'You already belong to a company' });
      return;
    }

    // Get user info for company name
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('full_name, email')
      .eq('id', userId)
      .single();

    const name = user?.full_name
      ? `${user.full_name}'s Company`
      : `${user?.email}'s Company`;

    // Get owner role
    const { data: ownerRole } = await supabaseAdmin
      .from('roles')
      .select('id')
      .eq('name', 'owner')
      .single();

    if (!ownerRole) {
      res.status(500).json({ error: 'Owner role not found' });
      return;
    }

    // Create company
    const { data: company, error: companyError } = await supabaseAdmin
      .from('companies')
      .insert({ name })
      .select()
      .single();

    if (companyError) throw companyError;

    // Create membership
    const { error: memberError } = await supabaseAdmin
      .from('company_members')
      .insert({
        company_id: company.id,
        user_id: userId,
        role_id: ownerRole.id,
      });

    if (memberError) throw memberError;

    // Update user's company_id
    const { error: userError } = await supabaseAdmin
      .from('users')
      .update({ company_id: company.id })
      .eq('id', userId);

    if (userError) throw userError;

    // Seed default permissions
    const { error: seedError } = await supabaseAdmin.rpc('seed_default_permissions', {
      p_company_id: company.id,
    });

    if (seedError) throw seedError;

    res.json({ company });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// GET COMPANY INFO
// ────────────────────────────────────────────────
router.get('/', requirePermission('company_settings', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    const { data, error } = await supabaseAdmin
      .from('companies')
      .select('*')
      .eq('id', companyId)
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }

    res.json({ company: data });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// UPDATE COMPANY INFO
// ────────────────────────────────────────────────
router.put('/', requirePermission('company_settings', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { name, slug, logo_url, timezone, default_language, business_hours, session_timeout_hours, business_type, business_description, auto_assign_mode, auto_create_contacts, brand_color } = req.body;

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (slug !== undefined) updates.slug = slug;
    if (logo_url !== undefined) updates.logo_url = logo_url;
    if (timezone !== undefined) updates.timezone = timezone;
    if (default_language !== undefined) updates.default_language = default_language;
    if (business_hours !== undefined) updates.business_hours = business_hours;
    if (business_type !== undefined) updates.business_type = business_type;
    if (business_description !== undefined) updates.business_description = business_description;
    if (auto_assign_mode !== undefined) {
      if (!['company', 'per_channel'].includes(auto_assign_mode)) {
        res.status(400).json({ error: 'auto_assign_mode must be "company" or "per_channel"' });
        return;
      }
      updates.auto_assign_mode = auto_assign_mode;
    }
    if (session_timeout_hours !== undefined) {
      const hours = Number(session_timeout_hours);
      if (isNaN(hours) || hours < 1 || hours > 720) {
        res.status(400).json({ error: 'Session timeout must be between 1 and 720 hours' });
        return;
      }
      updates.session_timeout_hours = hours;
    }
    if (auto_create_contacts !== undefined) {
      updates.auto_create_contacts = Boolean(auto_create_contacts);
    }
    if (brand_color !== undefined) {
      if (brand_color !== null && !/^#[0-9a-fA-F]{6}$/.test(brand_color)) {
        res.status(400).json({ error: 'brand_color must be a valid hex color (e.g. #2563eb) or null' });
        return;
      }
      updates.brand_color = brand_color;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('companies')
      .update(updates)
      .eq('id', companyId)
      .select()
      .single();

    if (error) throw error;
    res.json({ company: data });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// DELETE COMPANY (owner only)
// ────────────────────────────────────────────────
router.delete('/', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const companyId = req.companyId;
    const userRole = req.userRole;

    if (!companyId) {
      res.status(400).json({ error: 'You are not a member of any company' });
      return;
    }

    if (userRole !== 'owner') {
      res.status(403).json({ error: 'Only the company owner can delete the company' });
      return;
    }

    // 1. Clean up WhatsApp channels via Whapi
    const { data: channels } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('channel_id, channel_token')
      .eq('company_id', companyId);

    for (const ch of channels || []) {
      try {
        await whapi.logoutChannel(ch.channel_token);
      } catch {
        // Channel may already be logged out
      }
      try {
        await whapi.deleteChannel(ch.channel_id);
      } catch {
        // Channel may already be deleted
      }
    }

    // 2. Clear company_id for all users in this company
    await supabaseAdmin
      .from('users')
      .update({ company_id: null })
      .eq('company_id', companyId);

    // 3. Delete the company — CASCADE handles all related data
    const { error } = await supabaseAdmin
      .from('companies')
      .delete()
      .eq('id', companyId);

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// UPLOAD COMPANY LOGO
// ────────────────────────────────────────────────
router.post('/logo', requirePermission('company_settings', 'edit'), logoUpload.single('logo'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    const ext = file.mimetype === 'image/png' ? 'png'
      : file.mimetype === 'image/webp' ? 'webp'
      : 'jpg';

    const storagePath = `${companyId}/logo.${ext}`;

    // Upload new logo first (safer: old file remains if upload fails)
    const { error: storageError } = await supabaseAdmin.storage
      .from('company-logos')
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });

    if (storageError) {
      console.error('Logo upload error:', storageError);
      res.status(500).json({ error: 'Failed to upload logo' });
      return;
    }

    // Clean up old files with different extensions (e.g., old logo.png when uploading logo.jpg)
    const { data: existingFiles } = await supabaseAdmin.storage
      .from('company-logos')
      .list(companyId);

    if (existingFiles && existingFiles.length > 0) {
      const filesToDelete = existingFiles
        .map((f) => `${companyId}/${f.name}`)
        .filter((path) => path !== storagePath);
      if (filesToDelete.length > 0) {
        await supabaseAdmin.storage.from('company-logos').remove(filesToDelete);
      }
    }

    // Get public URL with cache-busting
    const { data: urlData } = supabaseAdmin.storage
      .from('company-logos')
      .getPublicUrl(storagePath);

    const logoUrl = `${urlData.publicUrl}?t=${Date.now()}`;

    // Update company record
    const { data, error } = await supabaseAdmin
      .from('companies')
      .update({ logo_url: logoUrl })
      .eq('id', companyId)
      .select()
      .single();

    if (error) {
      // Best-effort cleanup if DB update fails
      await supabaseAdmin.storage.from('company-logos').remove([storagePath]);
      throw error;
    }

    res.json({ logo_url: data.logo_url });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// DELETE COMPANY LOGO
// ────────────────────────────────────────────────
router.delete('/logo', requirePermission('company_settings', 'edit'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    // List and remove all files in the company's logo folder
    const { data: existingFiles } = await supabaseAdmin.storage
      .from('company-logos')
      .list(companyId);

    if (existingFiles && existingFiles.length > 0) {
      const filePaths = existingFiles.map((f) => `${companyId}/${f.name}`);
      await supabaseAdmin.storage.from('company-logos').remove(filePaths);
    }

    // Clear logo_url in company record
    const { error } = await supabaseAdmin
      .from('companies')
      .update({ logo_url: null })
      .eq('id', companyId);

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
