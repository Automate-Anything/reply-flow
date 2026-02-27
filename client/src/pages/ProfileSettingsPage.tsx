import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/contexts/SessionContext';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Loader2, Camera, User, DoorOpen, Trash2, KeyRound } from 'lucide-react';

interface Profile {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
}

export default function ProfileSettingsPage() {
  const navigate = useNavigate();
  const { role, companyName, refresh } = useSession();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isOwner = role === 'owner';

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // Name editing
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);

  // Avatar uploading
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  // Leave / delete company
  const [leaving, setLeaving] = useState(false);
  const [memberCount, setMemberCount] = useState<number | null>(null);

  const fetchProfile = useCallback(async () => {
    try {
      const [profileRes, membersRes] = await Promise.all([
        api.get('/me'),
        api.get('/team/members').catch(() => ({ data: { members: [] } })),
      ]);
      setProfile(profileRes.data.profile);
      setName(profileRes.data.profile.full_name || '');
      setMemberCount(membersRes.data.members.length);
    } catch {
      toast.error('Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const initials = (profile?.full_name || '')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const handleSaveName = async () => {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSavingName(true);
    try {
      const { data } = await api.put('/me', { full_name: name.trim() });
      setProfile(data.profile);
      await refresh();
      toast.success('Name updated');
    } catch {
      toast.error('Failed to update name');
    } finally {
      setSavingName(false);
    }
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error('Image must be under 2MB');
      return;
    }

    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append('avatar', file);
      const { data } = await api.post('/me/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setProfile(data.profile);
      await refresh();
      toast.success('Avatar updated');
    } catch {
      toast.error('Failed to upload avatar');
    } finally {
      setUploadingAvatar(false);
      // Reset file input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword) {
      toast.error('Current password is required');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('New password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setSavingPassword(true);
    try {
      // Verify current password by re-authenticating
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: profile?.email || '',
        password: currentPassword,
      });
      if (signInError) {
        toast.error('Current password is incorrect');
        setSavingPassword(false);
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success('Password updated');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || 'Failed to update password';
      toast.error(msg);
    } finally {
      setSavingPassword(false);
    }
  };

  const handleLeave = async () => {
    setLeaving(true);
    try {
      await api.post('/team/leave');
      await refresh();
      navigate('/onboarding', { replace: true });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error || 'Failed to leave company';
      toast.error(msg);
      setLeaving(false);
    }
  };

  const nameChanged = profile && name.trim() !== (profile.full_name || '');
  const passwordValid = currentPassword.length > 0 && newPassword.length >= 6 && newPassword === confirmPassword;

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your personal information.
        </p>
      </div>

      {/* Avatar & Info */}
      <Card>
        <CardContent className="flex items-center gap-5 pt-6 pb-6">
          <div className="relative">
            <Avatar className="h-16 w-16">
              {profile?.avatar_url && (
                <AvatarImage src={profile.avatar_url} alt={profile.full_name} />
              )}
              <AvatarFallback className="text-lg">
                {initials || <User size={24} />}
              </AvatarFallback>
            </Avatar>
            {uploadingAvatar && (
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
                <Loader2 className="h-5 w-5 animate-spin text-white" />
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{profile?.full_name || 'No name set'}</p>
            <p className="text-xs text-muted-foreground">{profile?.email}</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleAvatarChange}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
            >
              <Camera className="mr-1.5 h-3.5 w-3.5" />
              Change Avatar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Display Name */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4" />
            Display Name
          </CardTitle>
          <CardDescription>How your name appears to team members and in conversations.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="full-name">Full Name</Label>
            <Input
              id="full-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              maxLength={100}
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSaveName} disabled={savingName || !nameChanged}>
              {savingName && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Name
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" />
            Change Password
          </CardTitle>
          <CardDescription>Update your password to keep your account secure.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="current-password">Current Password</Label>
            <Input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New Password</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 6 characters"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">Confirm Password</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat new password"
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={handleChangePassword} disabled={savingPassword || !passwordValid}>
              {savingPassword && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Change Password
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Leave / Delete Company */}
      {(
        <Card className="border-destructive/30">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              {isOwner ? <Trash2 className="h-4 w-4" /> : <DoorOpen className="h-4 w-4" />}
              {isOwner ? 'Delete Company' : 'Leave Company'}
            </CardTitle>
            <CardDescription>
              {isOwner
                ? 'You are the only member. This will permanently delete the company and all its data.'
                : 'You will lose access to all company data. This cannot be undone.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-end">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  {isOwner ? (
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  ) : (
                    <DoorOpen className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {isOwner ? 'Delete' : 'Leave'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {isOwner ? 'Delete' : 'Leave'} {companyName || 'this company'}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {isOwner
                      ? 'This will permanently delete the company, all channels, conversations, contacts, and other data. This cannot be undone.'
                      : 'You will be removed from the company and lose access to all its data. You\'ll need a new invitation to rejoin.'}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleLeave}
                    disabled={leaving}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {leaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isOwner ? 'Delete Company' : 'Leave Company'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
