import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { requirePermission } from '../middleware/permissions.js';

const router = Router();
router.use(requireAuth);

// ────────────────────────────────────────────────
// LIST COMPANY MEMBERS
// ────────────────────────────────────────────────
router.get('/members', requirePermission('team', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    const { data, error } = await supabaseAdmin
      .from('company_members')
      .select('*, users:user_id(id, email, full_name, avatar_url), roles:role_id(id, name, hierarchy_level)')
      .eq('company_id', companyId);

    if (error) throw error;
    res.json({ members: data || [] });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// CREATE INVITATION
// ────────────────────────────────────────────────
router.post('/invite', requirePermission('team', 'invite'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { email, role_id } = req.body;

    if (!email || !role_id) {
      res.status(400).json({ error: 'email and role_id are required' });
      return;
    }

    // Validate that role_id exists
    const { data: role, error: roleError } = await supabaseAdmin
      .from('roles')
      .select('id')
      .eq('id', role_id)
      .single();

    if (roleError || !role) {
      res.status(400).json({ error: 'Invalid role_id' });
      return;
    }

    // Check if user is already a member of this company
    const { data: existingMember } = await supabaseAdmin
      .from('company_members')
      .select('id, users:user_id(email)')
      .eq('company_id', companyId);

    const alreadyMember = (existingMember || []).some(
      (m: any) => (m.users as any)?.email === email
    );

    if (alreadyMember) {
      res.status(409).json({ error: 'This user is already a member of the company' });
      return;
    }

    const { data: invitation, error } = await supabaseAdmin
      .from('invitations')
      .insert({
        company_id: companyId,
        email,
        role_id,
        invited_by: req.userId,
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ invitation });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// GET INVITE LINK
// ────────────────────────────────────────────────
router.get('/invite-link/:invitationId', requirePermission('team', 'invite'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { invitationId } = req.params;

    const { data: invitation, error } = await supabaseAdmin
      .from('invitations')
      .select('token')
      .eq('id', invitationId)
      .eq('company_id', companyId)
      .single();

    if (error || !invitation) {
      res.status(404).json({ error: 'Invitation not found' });
      return;
    }

    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    res.json({ link: `${clientUrl}/invite/${invitation.token}` });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// PREVIEW INVITATION (by token — no permission needed, just auth)
// ────────────────────────────────────────────────
router.get('/invite-preview/:token', async (req, res, next) => {
  try {
    const { token } = req.params;

    const { data: invitation, error } = await supabaseAdmin
      .from('invitations')
      .select('id, email, expires_at, accepted_at, companies:company_id(name), roles:role_id(name)')
      .eq('token', token)
      .single();

    if (error || !invitation) {
      res.status(404).json({ error: 'Invitation not found' });
      return;
    }

    res.json({
      invitation: {
        email: invitation.email,
        expires_at: invitation.expires_at,
        accepted_at: invitation.accepted_at,
        company_name: (invitation.companies as unknown as { name: string })?.name,
        role_name: (invitation.roles as unknown as { name: string })?.name,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// ACCEPT INVITATION
// ────────────────────────────────────────────────
router.post('/accept-invite', async (req, res, next) => {
  try {
    const userId = req.userId!;
    const { token } = req.body;

    if (!token) {
      res.status(400).json({ error: 'token is required' });
      return;
    }

    // Find the invitation by token
    const { data: invitation, error: invError } = await supabaseAdmin
      .from('invitations')
      .select('*, companies:company_id(*)')
      .eq('token', token)
      .single();

    if (invError || !invitation) {
      res.status(404).json({ error: 'Invitation not found' });
      return;
    }

    // Check if already accepted
    if (invitation.accepted_at) {
      res.status(400).json({ error: 'Invitation has already been accepted' });
      return;
    }

    // Check if expired
    if (new Date(invitation.expires_at) < new Date()) {
      res.status(400).json({ error: 'Invitation has expired' });
      return;
    }

    // Check if user already belongs to a company (UNIQUE constraint on user_id in company_members)
    const { data: existingMembership } = await supabaseAdmin
      .from('company_members')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (existingMembership) {
      res.status(409).json({ error: 'You already belong to a company' });
      return;
    }

    // Create company_member entry
    const { error: memberError } = await supabaseAdmin
      .from('company_members')
      .insert({
        company_id: invitation.company_id,
        user_id: userId,
        role_id: invitation.role_id,
        invited_by: invitation.invited_by,
      });

    if (memberError) throw memberError;

    // Update invitation with accepted_at
    const { error: updateInvError } = await supabaseAdmin
      .from('invitations')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', invitation.id);

    if (updateInvError) throw updateInvError;

    // Update user's company_id
    const { error: updateUserError } = await supabaseAdmin
      .from('users')
      .update({ company_id: invitation.company_id })
      .eq('id', userId);

    if (updateUserError) throw updateUserError;

    res.json({ company: invitation.companies });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// CHANGE MEMBER ROLE
// ────────────────────────────────────────────────
router.put('/members/:memberId/role', requirePermission('team', 'edit_role'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const userId = req.userId!;
    const { memberId } = req.params;
    const { role_id } = req.body;

    if (!role_id) {
      res.status(400).json({ error: 'role_id is required' });
      return;
    }

    // Get the target member with their current role
    const { data: targetMember, error: targetError } = await supabaseAdmin
      .from('company_members')
      .select('*, roles:role_id(id, name, hierarchy_level)')
      .eq('id', memberId)
      .eq('company_id', companyId)
      .single();

    if (targetError || !targetMember) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }

    const targetRole = targetMember.roles as unknown as { id: string; name: string; hierarchy_level: number };

    // Cannot change the owner's role
    if (targetRole.name === 'owner') {
      res.status(403).json({ error: 'Cannot change the owner\'s role' });
      return;
    }

    // Get the new role
    const { data: newRole, error: newRoleError } = await supabaseAdmin
      .from('roles')
      .select('id, name, hierarchy_level')
      .eq('id', role_id)
      .single();

    if (newRoleError || !newRole) {
      res.status(400).json({ error: 'Invalid role_id' });
      return;
    }

    // Cannot set role to owner
    if (newRole.name === 'owner') {
      res.status(403).json({ error: 'Cannot assign the owner role' });
      return;
    }

    // Get the caller's hierarchy level
    const { data: callerMember, error: callerError } = await supabaseAdmin
      .from('company_members')
      .select('roles:role_id(hierarchy_level)')
      .eq('user_id', userId)
      .eq('company_id', companyId)
      .single();

    if (callerError || !callerMember) {
      res.status(403).json({ error: 'Could not verify your role' });
      return;
    }

    const callerLevel = (callerMember.roles as unknown as { hierarchy_level: number }).hierarchy_level;

    // Caller can only change roles of members with lower hierarchy_level
    if (targetRole.hierarchy_level >= callerLevel) {
      res.status(403).json({ error: 'Cannot change role of a member at or above your level' });
      return;
    }

    // Caller cannot assign a role at or above their own level
    if (newRole.hierarchy_level >= callerLevel) {
      res.status(403).json({ error: 'Cannot assign a role at or above your level' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('company_members')
      .update({ role_id })
      .eq('id', memberId)
      .eq('company_id', companyId)
      .select('*, roles:role_id(id, name, hierarchy_level)')
      .single();

    if (error) throw error;
    res.json({ member: data });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// REMOVE MEMBER
// ────────────────────────────────────────────────
router.delete('/members/:memberId', requirePermission('team', 'remove'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const userId = req.userId!;
    const { memberId } = req.params;

    // Get the target member
    const { data: targetMember, error: targetError } = await supabaseAdmin
      .from('company_members')
      .select('*, roles:role_id(name)')
      .eq('id', memberId)
      .eq('company_id', companyId)
      .single();

    if (targetError || !targetMember) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }

    // Cannot remove yourself
    if (targetMember.user_id === userId) {
      res.status(403).json({ error: 'Cannot remove yourself from the company' });
      return;
    }

    // Cannot remove the owner
    const targetRoleName = (targetMember.roles as unknown as { name: string }).name;
    if (targetRoleName === 'owner') {
      res.status(403).json({ error: 'Cannot remove the company owner' });
      return;
    }

    // Delete from company_members
    const { error: deleteError } = await supabaseAdmin
      .from('company_members')
      .delete()
      .eq('id', memberId)
      .eq('company_id', companyId);

    if (deleteError) throw deleteError;

    // Update the removed user's company_id to null
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ company_id: null })
      .eq('id', targetMember.user_id);

    if (updateError) throw updateError;

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// LIST PENDING INVITATIONS (with recipient status)
// ────────────────────────────────────────────────
router.get('/invitations', requirePermission('team', 'view'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;

    const { data, error } = await supabaseAdmin
      .from('invitations')
      .select('*, roles:role_id(name)')
      .eq('company_id', companyId)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString());

    if (error) throw error;

    const invitations = data || [];

    // Enrich each invitation with recipient account status
    const emails = invitations.map((inv: any) => inv.email);

    // Batch-lookup which emails already have accounts in public.users
    const { data: existingUsers } = emails.length
      ? await supabaseAdmin
          .from('users')
          .select('id, email')
          .in('email', emails)
      : { data: [] };

    const emailToUserId = new Map<string, string>();
    for (const u of existingUsers || []) {
      emailToUserId.set(u.email, u.id);
    }

    // For users that exist, check email confirmation via auth admin API
    const confirmedSet = new Set<string>();
    await Promise.all(
      Array.from(emailToUserId.entries()).map(async ([email, uid]) => {
        try {
          const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(uid);
          if (authUser?.user?.email_confirmed_at) {
            confirmedSet.add(email);
          }
        } catch {
          // If lookup fails, treat as unconfirmed
        }
      })
    );

    const enriched = invitations.map((inv: any) => {
      let recipient_status: 'invite_sent' | 'account_unconfirmed' | 'account_confirmed';
      if (!emailToUserId.has(inv.email)) {
        recipient_status = 'invite_sent';
      } else if (confirmedSet.has(inv.email)) {
        recipient_status = 'account_confirmed';
      } else {
        recipient_status = 'account_unconfirmed';
      }
      return { ...inv, recipient_status };
    });

    res.json({ invitations: enriched });
  } catch (err) {
    next(err);
  }
});

// ────────────────────────────────────────────────
// CANCEL INVITATION
// ────────────────────────────────────────────────
router.delete('/invitations/:id', requirePermission('team', 'invite'), async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const { id } = req.params;

    // Verify it belongs to the company
    const { data: invitation, error: findError } = await supabaseAdmin
      .from('invitations')
      .select('id')
      .eq('id', id)
      .eq('company_id', companyId)
      .single();

    if (findError || !invitation) {
      res.status(404).json({ error: 'Invitation not found' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('invitations')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
