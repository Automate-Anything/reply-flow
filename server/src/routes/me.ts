import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

const upload = multer({
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

// GET /api/me — returns user profile + company + role + permissions
router.get('/', async (req, res, next) => {
  try {
    const userId = req.userId!;

    // Get user profile
    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('id, email, full_name, avatar_url, company_id')
      .eq('id', userId)
      .single();

    if (!profile) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Get company membership with role
    let { data: membership } = await supabaseAdmin
      .from('company_members')
      .select('company_id, role_id, roles(id, name, hierarchy_level), companies(id, name, slug, logo_url)')
      .eq('user_id', userId)
      .single();

    // If no company, check for pending invitations before auto-creating
    if (!membership) {
      const { data: invitations } = await supabaseAdmin
        .from('invitations')
        .select('id')
        .eq('email', profile.email)
        .is('accepted_at', null)
        .gt('expires_at', new Date().toISOString())
        .limit(1);

      // No pending invitations — auto-create a company for this user
      if (!invitations || invitations.length === 0) {
        const companyName = profile.full_name
          ? `${profile.full_name}'s Company`
          : `${profile.email}'s Company`;

        const { data: ownerRole } = await supabaseAdmin
          .from('roles')
          .select('id')
          .eq('name', 'owner')
          .single();

        if (ownerRole) {
          const { data: company } = await supabaseAdmin
            .from('companies')
            .insert({ name: companyName })
            .select()
            .single();

          if (company) {
            await supabaseAdmin
              .from('company_members')
              .insert({ company_id: company.id, user_id: userId, role_id: ownerRole.id });

            await supabaseAdmin
              .from('users')
              .update({ company_id: company.id })
              .eq('id', userId);

            await supabaseAdmin.rpc('seed_default_permissions', { p_company_id: company.id });

            // Re-fetch membership so the response includes the new company
            ({ data: membership } = await supabaseAdmin
              .from('company_members')
              .select('company_id, role_id, roles(id, name, hierarchy_level), companies(id, name, slug, logo_url)')
              .eq('user_id', userId)
              .single());
          }
        }
      }
    }

    // Get permissions for the user's role in their company
    let permissions: string[] = [];
    if (membership) {
      const roleName = (membership.roles as any)?.name;

      if (roleName === 'owner') {
        // Owner has all permissions — return a comprehensive list
        const { data: allPerms } = await supabaseAdmin
          .from('role_permissions')
          .select('resource, action')
          .eq('company_id', membership.company_id)
          .eq('role_id', membership.role_id);
        permissions = (allPerms || []).map(p => `${p.resource}.${p.action}`);

        // Also add any permissions that might only exist for owner
        // (owner always has everything, we just return what's seeded for display purposes)
      } else if (membership.role_id) {
        const { data: rolePerms } = await supabaseAdmin
          .from('role_permissions')
          .select('resource, action')
          .eq('company_id', membership.company_id)
          .eq('role_id', membership.role_id);
        permissions = (rolePerms || []).map(p => `${p.resource}.${p.action}`);
      }
    }

    res.json({
      profile,
      company: membership ? (membership.companies as any) : null,
      role: membership ? (membership.roles as any) : null,
      permissions,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/me — update user profile (full_name)
router.put('/', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { full_name } = req.body;

    if (!full_name || typeof full_name !== 'string' || !full_name.trim()) {
      res.status(400).json({ error: 'full_name is required' });
      return;
    }

    const trimmed = full_name.trim();
    if (trimmed.length > 100) {
      res.status(400).json({ error: 'Name must be 100 characters or fewer' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ full_name: trimmed })
      .eq('id', userId)
      .select('id, email, full_name, avatar_url')
      .single();

    if (error) throw error;

    // Also update auth metadata so session reflects the new name
    await supabaseAdmin.auth.admin.updateUserById(userId, {
      user_metadata: { full_name: trimmed },
    });

    res.json({ profile: data });
  } catch (err) {
    next(err);
  }
});

// POST /api/me/avatar — upload avatar image
router.post('/avatar', upload.single('avatar'), async (req, res, next) => {
  try {
    const userId = req.userId!;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    const ext = file.mimetype === 'image/png' ? 'png'
      : file.mimetype === 'image/webp' ? 'webp'
      : 'jpg';

    const storagePath = `${userId}/avatar.${ext}`;

    const { error: storageError } = await supabaseAdmin.storage
      .from('avatars')
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });

    if (storageError) {
      console.error('Avatar upload error:', storageError);
      res.status(500).json({ error: 'Failed to upload avatar' });
      return;
    }

    const { data: urlData } = supabaseAdmin.storage
      .from('avatars')
      .getPublicUrl(storagePath);

    const avatarUrl = `${urlData.publicUrl}?t=${Date.now()}`;

    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ avatar_url: avatarUrl })
      .eq('id', userId)
      .select('id, email, full_name, avatar_url')
      .single();

    if (error) throw error;

    res.json({ profile: data });
  } catch (err) {
    next(err);
  }
});

// GET /api/me/invitations — returns pending invitations for the current user's email
router.get('/invitations', async (req, res, next) => {
  try {
    const userId = req.userId!;

    // Get the user's email
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('email')
      .eq('id', userId)
      .single();

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const { data: invitations, error } = await supabaseAdmin
      .from('invitations')
      .select('id, email, expires_at, accepted_at, token, companies:company_id(name), roles:role_id(name)')
      .eq('email', user.email)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString());

    if (error) throw error;

    res.json({
      invitations: (invitations || []).map((inv: any) => ({
        id: inv.id,
        token: inv.token,
        company_name: (inv.companies as any)?.name,
        role_name: (inv.roles as any)?.name,
        expires_at: inv.expires_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
