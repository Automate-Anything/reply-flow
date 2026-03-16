import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
import { Loader2, Camera, User, DoorOpen, KeyRound, Link, Unlink, Bell } from 'lucide-react';
import NotificationPreferences from '@/components/settings/NotificationPreferences';
import PersonalHoursSection from '@/components/settings/PersonalHoursSection';
import HolidayEditor from '@/components/settings/HolidayEditor';
import type { BusinessHours } from '@/components/settings/BusinessHoursEditor';
import type { UserIdentity } from '@supabase/supabase-js';

interface Profile {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  timezone: string | null;
  personal_hours: BusinessHours | null;
  hours_control_availability: boolean;
}

const TABS = ['general', 'availability', 'notifications', 'security'] as const;
type Tab = (typeof TABS)[number];

export default function ProfileSettingsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, role, companyName, refresh } = useSession();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isOwner = role === 'owner';

  const rawTab = searchParams.get('tab');
  const activeTab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : 'general';

  const handleTabChange = (value: string) => {
    setSearchParams(value === 'general' ? {} : { tab: value }, { replace: true });
  };

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [companyTimezone, setCompanyTimezone] = useState('UTC');

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

  // Connected accounts
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const [disconnectingGoogle, setDisconnectingGoogle] = useState(false);

  // Leave company
  const [leaving, setLeaving] = useState(false);

  // Derive auth providers from Supabase user identities
  const identities = user?.identities ?? [];
  const googleIdentity = identities.find((i: UserIdentity) => i.provider === 'google');
  const hasPassword = identities.some((i: UserIdentity) => i.provider === 'email');
  const hasGoogle = !!googleIdentity;

  const fetchProfile = useCallback(async () => {
    try {
      const profileRes = await api.get('/me');
      setProfile(profileRes.data.profile);
      setName(profileRes.data.profile.full_name || '');
      setCompanyTimezone(profileRes.data.company?.timezone || 'UTC');
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

  const handleSaveAvailability = async (updates: {
    timezone?: string | null;
    personal_hours?: BusinessHours | null;
    hours_control_availability?: boolean;
  }) => {
    const { data } = await api.put('/me', updates);
    setProfile(data.profile);
    toast.success('Availability settings saved');
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

  const handleSetPassword = async () => {
    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success('Password set successfully');
      setNewPassword('');
      setConfirmPassword('');
      await refresh();
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || 'Failed to set password';
      toast.error(msg);
    } finally {
      setSavingPassword(false);
    }
  };

  const handleConnectGoogle = async () => {
    setConnectingGoogle(true);
    try {
      const { error } = await supabase.auth.linkIdentity({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/profile-settings` },
      });
      if (error) throw error;
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || 'Failed to connect Google';
      toast.error(msg);
      setConnectingGoogle(false);
    }
  };

  const handleDisconnectGoogle = async () => {
    if (!googleIdentity) return;
    setDisconnectingGoogle(true);
    try {
      const { error } = await supabase.auth.unlinkIdentity(googleIdentity);
      if (error) throw error;
      toast.success('Google account disconnected');
      await refresh();
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || 'Failed to disconnect Google';
      toast.error(msg);
    } finally {
      setDisconnectingGoogle(false);
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
  const passwordValid = hasPassword
    ? currentPassword.length > 0 && newPassword.length >= 6 && newPassword === confirmPassword
    : newPassword.length >= 6 && newPassword === confirmPassword;

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <User className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Profile Settings</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manage your personal information.
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="w-full">
          <TabsTrigger value="general" className="flex-1">General</TabsTrigger>
          <TabsTrigger value="availability" className="flex-1">Availability</TabsTrigger>
          <TabsTrigger value="notifications" className="flex-1">Notifications</TabsTrigger>
          <TabsTrigger value="security" className="flex-1">Security</TabsTrigger>
        </TabsList>

        {/* General Tab — Avatar & Display Name */}
        <TabsContent value="general" className="mt-6 space-y-6">
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
        </TabsContent>

        {/* Availability Tab */}
        <TabsContent value="availability" className="mt-6 space-y-6">
          <PersonalHoursSection
            timezone={profile?.timezone ?? null}
            companyTimezone={companyTimezone}
            personalHours={profile?.personal_hours ?? null}
            hoursControlAvailability={profile?.hours_control_availability ?? false}
            onSave={handleSaveAvailability}
          />
          <HolidayEditor scope="user" />
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications" className="mt-6">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <Bell className="h-4 w-4" />
                Notification Preferences
              </CardTitle>
              <CardDescription>Choose which notifications you want to receive.</CardDescription>
            </CardHeader>
            <CardContent>
              <NotificationPreferences />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security Tab — Connected Accounts, Password, Leave Company */}
        <TabsContent value="security" className="mt-6 space-y-6">
          {/* Connected Accounts */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <Link className="h-4 w-4" />
                Connected Accounts
              </CardTitle>
              <CardDescription>Manage sign-in methods linked to your account.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                <div className="flex items-center gap-3">
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium">Google</p>
                    {hasGoogle ? (
                      <p className="text-xs text-muted-foreground">
                        {googleIdentity?.identity_data?.email || 'Connected'}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Not connected</p>
                    )}
                  </div>
                </div>
                {hasGoogle ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDisconnectGoogle}
                    disabled={disconnectingGoogle || !hasPassword}
                    title={!hasPassword ? 'Set a password before disconnecting Google' : undefined}
                  >
                    {disconnectingGoogle ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Unlink className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleConnectGoogle}
                    disabled={connectingGoogle}
                  >
                    {connectingGoogle ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Link className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Connect
                  </Button>
                )}
              </div>
              {hasGoogle && !hasPassword && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Set a password below before you can disconnect Google.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Password */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="h-4 w-4" />
                {hasPassword ? 'Change Password' : 'Set Password'}
              </CardTitle>
              <CardDescription>
                {hasPassword
                  ? 'Update your password to keep your account secure.'
                  : 'Add a password so you can sign in with email and password.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {hasPassword && (
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
              )}
              <div className="space-y-1.5">
                <Label htmlFor="new-password">{hasPassword ? 'New Password' : 'Password'}</Label>
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
                  placeholder="Repeat password"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={hasPassword ? handleChangePassword : handleSetPassword}
                  disabled={savingPassword || !passwordValid}
                >
                  {savingPassword && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {hasPassword ? 'Change Password' : 'Set Password'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Leave Company (non-owners only) */}
          {!isOwner && (
            <Card className="border-destructive/30">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-base text-destructive">
                  <DoorOpen className="h-4 w-4" />
                  Leave Company
                </CardTitle>
                <CardDescription>
                  You will lose access to all company data. This cannot be undone.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-end">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm">
                      <DoorOpen className="mr-1.5 h-3.5 w-3.5" />
                      Leave
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Leave {companyName || 'this company'}?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        You will be removed from the company and lose access to all its data. You'll need a new invitation to rejoin.
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
                        Leave Company
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
