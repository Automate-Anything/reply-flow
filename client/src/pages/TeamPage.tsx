import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Users,
  UserPlus,
  Trash2,
  Copy,
  Clock,
  Shield,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useSession } from '@/contexts/SessionContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Role {
  id: string;
  name: string;
  description: string | null;
  hierarchy_level: number;
}

interface Member {
  id: string;
  user_id: string;
  company_id: string;
  role_id: string;
  joined_at: string;
  users: {
    id: string;
    email: string;
    full_name: string;
    avatar_url: string | null;
  };
  roles: {
    id: string;
    name: string;
    hierarchy_level: number;
  };
}

interface Invitation {
  id: string;
  email: string;
  role_id: string;
  invited_by: string;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
  roles: { name: string };
  recipient_status: 'invite_sent' | 'account_unconfirmed' | 'account_confirmed';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function roleBadgeVariant(
  roleName: string
): 'default' | 'secondary' | 'outline' {
  switch (roleName.toLowerCase()) {
    case 'owner':
      return 'default';
    case 'admin':
      return 'secondary';
    default:
      return 'outline';
  }
}

function recipientStatusConfig(status: Invitation['recipient_status']) {
  switch (status) {
    case 'invite_sent':
      return { label: 'Invite Sent', dot: 'bg-muted-foreground' };
    case 'account_unconfirmed':
      return { label: 'Unconfirmed', dot: 'bg-amber-500' };
    case 'account_confirmed':
      return { label: 'Confirmed', dot: 'bg-green-500' };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TeamPage() {
  const { userId, role: currentRole, hasPermission } = useSession();

  // Data state
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);

  // Loading state
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [loadingInvitations, setLoadingInvitations] = useState(true);
  const [loadingRoles, setLoadingRoles] = useState(true);

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRoleId, setInviteRoleId] = useState('');
  const [inviting, setInviting] = useState(false);

  // Delete confirmation state
  const [memberToRemove, setMemberToRemove] = useState<Member | null>(null);
  const [removing, setRemoving] = useState(false);

  // Role change in-flight tracking
  const [changingRoleFor, setChangingRoleFor] = useState<string | null>(null);

  // Cancelling invitation
  const [cancellingInvitation, setCancellingInvitation] = useState<
    string | null
  >(null);

  // Copying link
  const [copyingLink, setCopyingLink] = useState<string | null>(null);

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------

  const fetchMembers = useCallback(async () => {
    try {
      const { data } = await api.get<{ members: Member[] }>('/team/members');
      setMembers(data.members);
    } catch {
      toast.error('Failed to load team members');
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  const fetchInvitations = useCallback(async () => {
    try {
      const { data } = await api.get<{ invitations: Invitation[] }>(
        '/team/invitations'
      );
      setInvitations(data.invitations);
    } catch {
      toast.error('Failed to load invitations');
    } finally {
      setLoadingInvitations(false);
    }
  }, []);

  const fetchRoles = useCallback(async () => {
    try {
      const { data } = await api.get<{ roles: Role[] }>('/roles');
      setRoles(data.roles);
    } catch {
      toast.error('Failed to load roles');
    } finally {
      setLoadingRoles(false);
    }
  }, []);

  useEffect(() => {
    fetchMembers();
    fetchInvitations();
    fetchRoles();
  }, [fetchMembers, fetchInvitations, fetchRoles]);

  // -----------------------------------------------------------------------
  // Derived values
  // -----------------------------------------------------------------------

  const currentMember = members.find((m) => m.user_id === userId);
  const currentHierarchy = currentMember?.roles.hierarchy_level ?? Infinity;

  // Roles below the current user's hierarchy (higher number = higher rank)
  const assignableRoles = roles.filter(
    (r) => r.hierarchy_level < currentHierarchy
  );

  // Filter pending invitations (not yet accepted)
  const pendingInvitations = invitations.filter((inv) => !inv.accepted_at);

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  const handleInvite = async () => {
    if (!inviteEmail.trim()) {
      toast.error('Please enter an email address');
      return;
    }
    if (!inviteRoleId) {
      toast.error('Please select a role');
      return;
    }

    setInviting(true);
    try {
      await api.post('/team/invite', {
        email: inviteEmail.trim(),
        role_id: inviteRoleId,
      });
      toast.success(`Invitation sent to ${inviteEmail.trim()}`);
      setInviteEmail('');
      setInviteRoleId('');
      fetchInvitations();
    } catch (err: unknown) {
      const message =
        err &&
        typeof err === 'object' &&
        'response' in err &&
        (err as { response?: { data?: { error?: string } } }).response?.data
          ?.error;
      toast.error(message || 'Failed to send invitation');
    } finally {
      setInviting(false);
    }
  };

  const handleCopyLink = async (invitationId: string) => {
    setCopyingLink(invitationId);
    try {
      const { data } = await api.get<{ link: string }>(
        `/team/invite-link/${invitationId}`
      );
      await navigator.clipboard.writeText(data.link);
      toast.success('Invite link copied to clipboard');
    } catch {
      toast.error('Failed to copy invite link');
    } finally {
      setCopyingLink(null);
    }
  };

  const handleCancelInvitation = async (invitationId: string) => {
    setCancellingInvitation(invitationId);
    try {
      await api.delete(`/team/invitations/${invitationId}`);
      toast.success('Invitation cancelled');
      fetchInvitations();
    } catch {
      toast.error('Failed to cancel invitation');
    } finally {
      setCancellingInvitation(null);
    }
  };

  const handleRoleChange = async (memberId: string, roleId: string) => {
    setChangingRoleFor(memberId);
    try {
      await api.put(`/team/members/${memberId}/role`, { role_id: roleId });
      toast.success('Role updated');
      fetchMembers();
    } catch {
      toast.error('Failed to update role');
    } finally {
      setChangingRoleFor(null);
    }
  };

  const handleRemoveMember = async () => {
    if (!memberToRemove) return;
    setRemoving(true);
    try {
      await api.delete(`/team/members/${memberToRemove.id}`);
      toast.success(
        `${memberToRemove.users.full_name || memberToRemove.users.email} has been removed`
      );
      setMemberToRemove(null);
      fetchMembers();
    } catch {
      toast.error('Failed to remove team member');
    } finally {
      setRemoving(false);
    }
  };

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------

  const canInvite = hasPermission('team', 'invite');
  const canEditRole = hasPermission('team', 'edit_role');
  const canRemove = hasPermission('team', 'remove');
  const canViewPermissions = hasPermission('role_permissions', 'view');

  const isOwnerRow = (member: Member) =>
    member.roles.name.toLowerCase() === 'owner';

  const canChangeRole = (member: Member) =>
    canEditRole &&
    !isOwnerRow(member) &&
    member.roles.hierarchy_level < currentHierarchy;

  const canDeleteMember = (member: Member) =>
    canRemove && !isOwnerRow(member) && member.user_id !== userId;

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your team members, roles, and invitations.
          </p>
        </div>

        {canViewPermissions && (
          <Button variant="outline" size="sm" asChild>
            <Link to="/team/permissions">
              <Shield className="size-4" />
              Role Permissions
              <ExternalLink className="size-3 opacity-50" />
            </Link>
          </Button>
        )}
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Members table                                                      */}
      {/* ----------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4" />
            Members
            {!loadingMembers && (
              <Badge variant="secondary" className="ml-1 text-xs font-normal">
                {members.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingMembers || loadingRoles ? (
            <div className="space-y-3 p-6">
              <Skeleton className="h-10 w-full rounded-md" />
              <Skeleton className="h-10 w-full rounded-md" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
          ) : members.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
              <Users className="size-8 opacity-40" />
              <p className="text-sm">No team members yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden sm:table-cell">
                    Joined
                  </TableHead>
                  <TableHead className="w-[60px] pr-6" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => (
                  <TableRow key={member.id}>
                    {/* Name + email */}
                    <TableCell className="pl-6">
                      <div className="flex items-center gap-3">
                        <Avatar size="default">
                          {member.users.avatar_url && (
                            <AvatarImage
                              src={member.users.avatar_url}
                              alt={member.users.full_name}
                            />
                          )}
                          <AvatarFallback>
                            {getInitials(
                              member.users.full_name || member.users.email
                            )}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {member.users.full_name || 'Unnamed'}
                            {member.user_id === userId && (
                              <span className="ml-1.5 text-xs text-muted-foreground">
                                (you)
                              </span>
                            )}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {member.users.email}
                          </p>
                        </div>
                      </div>
                    </TableCell>

                    {/* Role */}
                    <TableCell>
                      {canChangeRole(member) ? (
                        <Select
                          value={member.role_id}
                          onValueChange={(value) =>
                            handleRoleChange(member.id, value)
                          }
                          disabled={changingRoleFor === member.id}
                        >
                          <SelectTrigger size="sm" className="w-[130px]">
                            {changingRoleFor === member.id ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <SelectValue />
                            )}
                          </SelectTrigger>
                          <SelectContent>
                            {assignableRoles.map((r) => (
                              <SelectItem key={r.id} value={r.id}>
                                {r.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant={roleBadgeVariant(member.roles.name)}>
                          {member.roles.name}
                        </Badge>
                      )}
                    </TableCell>

                    {/* Joined date */}
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                      {formatDate(member.joined_at)}
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="pr-6 text-right">
                      {canDeleteMember(member) && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => setMemberToRemove(member)}
                        >
                          <Trash2 className="size-4" />
                          <span className="sr-only">Remove member</span>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ----------------------------------------------------------------- */}
      {/* Invite section                                                     */}
      {/* ----------------------------------------------------------------- */}
      {canInvite && (
        <>
          <Separator />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <UserPlus className="size-4" />
                Invite a team member
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <label
                    htmlFor="invite-email"
                    className="mb-1.5 block text-sm font-medium"
                  >
                    Email address
                  </label>
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder="colleague@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleInvite();
                    }}
                  />
                </div>
                <div className="w-full sm:w-[160px]">
                  <label
                    htmlFor="invite-role"
                    className="mb-1.5 block text-sm font-medium"
                  >
                    Role
                  </label>
                  <Select
                    value={inviteRoleId}
                    onValueChange={setInviteRoleId}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      {(loadingRoles ? [] : assignableRoles).map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handleInvite}
                  disabled={inviting || !inviteEmail.trim() || !inviteRoleId}
                  className="w-full sm:w-auto"
                >
                  {inviting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <UserPlus className="size-4" />
                  )}
                  Send Invite
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Pending invitations                                                */}
      {/* ----------------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="size-4" />
            Pending Invitations
            {!loadingInvitations && pendingInvitations.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs font-normal">
                {pendingInvitations.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingInvitations ? (
            <div className="space-y-3 p-6">
              <Skeleton className="h-10 w-full rounded-md" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
          ) : pendingInvitations.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
              <Clock className="size-8 opacity-40" />
              <p className="text-sm">No pending invitations.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40%] pl-6">Email</TableHead>
                  <TableHead className="w-[10%]">Role</TableHead>
                  <TableHead className="w-[15%]">Status</TableHead>
                  <TableHead className="hidden w-[15%] sm:table-cell">Sent</TableHead>
                  <TableHead className="w-[20%] pl-4">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingInvitations.map((inv) => {
                  const statusCfg = recipientStatusConfig(inv.recipient_status);
                  return (
                    <TableRow key={inv.id}>
                      <TableCell className="pl-6 text-sm font-medium">
                        {inv.email}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{inv.roles.name}</Badge>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-sm">
                          <span className={`inline-block size-2 rounded-full ${statusCfg.dot}`} />
                          {statusCfg.label}
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                        {formatDate(inv.created_at)}
                      </TableCell>
                      <TableCell className="pr-6">
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopyLink(inv.id)}
                            disabled={copyingLink === inv.id}
                          >
                            {copyingLink === inv.id ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Copy className="size-3" />
                            )}
                            Copy Link
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleCancelInvitation(inv.id)}
                            disabled={cancellingInvitation === inv.id}
                          >
                            {cancellingInvitation === inv.id ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Trash2 className="size-3" />
                            )}
                            Cancel
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ----------------------------------------------------------------- */}
      {/* Remove member confirmation dialog                                  */}
      {/* ----------------------------------------------------------------- */}
      <Dialog
        open={!!memberToRemove}
        onOpenChange={(open) => {
          if (!open) setMemberToRemove(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove team member</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove{' '}
              <span className="font-medium text-foreground">
                {memberToRemove?.users.full_name || memberToRemove?.users.email}
              </span>{' '}
              from the team? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMemberToRemove(null)}
              disabled={removing}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRemoveMember}
              disabled={removing}
            >
              {removing && <Loader2 className="size-4 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
