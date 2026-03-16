import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import {
  changePassword,
  updateProfile,
  getAgreement,
  acceptAgreement,
  requestAccountDeletion,
  getNotificationPreferences,
  updateNotificationPreferences,
} from '../api';
import type { Affiliate } from '../hooks/usePortalData';
import { formatDate } from '../lib/utils';

interface SettingsTabProps {
  affiliate: Affiliate | null;
  onProfileUpdate: () => void;
}

const NOTIFICATION_LABELS: Record<string, string> = {
  new_referral: 'New referral signup',
  referral_converted: 'Referral converts to paid plan',
  commission_earned: 'Commission earned',
  payout_processed: 'Payout processed',
};

function SettingsTab({ affiliate, onProfileUpdate }: SettingsTabProps) {
  // Profile state
  const [profileName, setProfileName] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileMsg, setProfileMsg] = useState('');
  const [profileError, setProfileError] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  // Password state
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [pwError, setPwError] = useState('');

  // Notifications state
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean> | null>(null);
  const [notifLoading, setNotifLoading] = useState(true);
  const [notifError, setNotifError] = useState('');

  // Agreement state
  const [agreement, setAgreement] = useState<{
    version: string;
    termsText: string;
    accepted: boolean;
    acceptedAt: string | null;
  } | null>(null);
  const [agreementLoading, setAgreementLoading] = useState(true);
  const [termsExpanded, setTermsExpanded] = useState(false);
  const [acceptingTerms, setAcceptingTerms] = useState(false);
  const [termsMsg, setTermsMsg] = useState('');

  // Danger zone state
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Initialize profile fields from affiliate data
  useEffect(() => {
    if (affiliate) {
      setProfileName(affiliate.name || '');
      setProfileEmail(affiliate.email || '');
      setProfilePhone(affiliate.phone || '');
    }
  }, [affiliate]);

  // Load notification preferences
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getNotificationPreferences();
        if (!cancelled) {
          setNotifPrefs(res.preferences);
          setNotifLoading(false);
        }
      } catch {
        if (!cancelled) {
          setNotifPrefs({ new_referral: true, referral_converted: true, commission_earned: true, payout_processed: true });
          setNotifLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load agreement
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getAgreement();
        if (!cancelled) {
          setAgreement(res);
          setAgreementLoading(false);
        }
      } catch {
        if (!cancelled) setAgreementLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Profile save
  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg('');
    setProfileError('');
    setProfileSaving(true);
    try {
      const updates: Record<string, string> = {};
      if (profileName !== (affiliate?.name || '')) updates.name = profileName;
      if (profileEmail !== (affiliate?.email || '')) updates.email = profileEmail;
      if (profilePhone !== (affiliate?.phone || '')) updates.phone = profilePhone;

      if (Object.keys(updates).length === 0) {
        setProfileMsg('No changes to save');
        setProfileSaving(false);
        return;
      }

      await updateProfile(updates);
      setProfileMsg('Profile updated successfully');
      onProfileUpdate();
    } catch (err: any) {
      setProfileError(err.message || 'Failed to update profile');
    } finally {
      setProfileSaving(false);
    }
  };

  // Password change
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg('');
    setPwError('');
    if (newPw !== confirmPw) {
      setPwError('Passwords do not match');
      return;
    }
    if (newPw.length < 8) {
      setPwError('Password must be at least 8 characters');
      return;
    }
    try {
      await changePassword(currentPw, newPw);
      setPwMsg('Password changed successfully');
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
    } catch (err: any) {
      setPwError(err.message || 'Failed to change password');
    }
  };

  // Toggle notification preference
  const toggleNotifPref = useCallback(async (key: string) => {
    if (!notifPrefs) return;
    const updated = { ...notifPrefs, [key]: !notifPrefs[key] };
    setNotifPrefs(updated);
    setNotifError('');
    try {
      await updateNotificationPreferences(updated);
    } catch (err: any) {
      // Revert on error
      setNotifPrefs(notifPrefs);
      setNotifError(err.message || 'Failed to save preferences');
    }
  }, [notifPrefs]);

  // Accept terms
  const handleAcceptTerms = async () => {
    if (!agreement) return;
    setAcceptingTerms(true);
    setTermsMsg('');
    try {
      await acceptAgreement(agreement.version);
      setAgreement({ ...agreement, accepted: true, acceptedAt: new Date().toISOString() });
      setTermsMsg('Terms accepted successfully');
    } catch (err: any) {
      setTermsMsg(err.message || 'Failed to accept terms');
    } finally {
      setAcceptingTerms(false);
    }
  };

  // Account deletion
  const handleDeleteRequest = async () => {
    setDeleteMsg('');
    setDeleteError('');
    setDeleting(true);
    try {
      const res = await requestAccountDeletion(deleteReason || undefined);
      setDeleteMsg(res.message);
      setDeleteConfirm(false);
      setDeleteReason('');
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to submit deletion request');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-xl space-y-6" role="tabpanel">
      {/* Profile Section */}
      <Card title="Profile">
        <form onSubmit={handleProfileSave} className="space-y-4">
          <Input
            label="Name"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            required
          />
          <Input
            label="Email"
            type="email"
            value={profileEmail}
            onChange={(e) => setProfileEmail(e.target.value)}
            required
          />
          <Input
            label="Phone"
            type="tel"
            value={profilePhone}
            onChange={(e) => setProfilePhone(e.target.value)}
            placeholder="Optional"
          />
          {profileError && <p className="text-sm text-[hsl(var(--destructive))]">{profileError}</p>}
          {profileMsg && <p className="text-sm text-[hsl(var(--success))]">{profileMsg}</p>}
          <Button type="submit" disabled={profileSaving}>
            {profileSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </form>
      </Card>

      {/* Commission Info */}
      {affiliate && (affiliate.commission_type || affiliate.commission_rate !== undefined) && (
        <Card title="Commission Info">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-[hsl(var(--muted-foreground))]">Type</span>
              <span className="font-medium text-[hsl(var(--foreground))] capitalize">
                {affiliate.commission_type || 'Percentage'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[hsl(var(--muted-foreground))]">Rate</span>
              <span className="font-medium text-[hsl(var(--foreground))]">
                {affiliate.commission_type === 'flat'
                  ? `$${((affiliate.commission_rate || 0) / 100).toFixed(2)}`
                  : `${affiliate.commission_rate || 0}%`}
              </span>
            </div>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-2">
              Contact an administrator to change your commission structure.
            </p>
          </div>
        </Card>
      )}

      {/* Change Password */}
      <Card title="Change Password">
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          <Input
            label="Current Password"
            type="password"
            required
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
          />
          <Input
            label="New Password"
            type="password"
            required
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
          />
          <Input
            label="Confirm New Password"
            type="password"
            required
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
          />
          {pwError && <p className="text-sm text-[hsl(var(--destructive))]">{pwError}</p>}
          {pwMsg && <p className="text-sm text-[hsl(var(--success))]">{pwMsg}</p>}
          <Button type="submit" className="w-full">
            Update Password
          </Button>
        </form>
      </Card>

      {/* Notification Preferences */}
      <Card title="Email Notifications">
        {notifLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {Object.entries(NOTIFICATION_LABELS).map(([key, label]) => (
              <label key={key} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifPrefs?.[key] !== false}
                  onChange={() => toggleNotifPref(key)}
                  className="w-4 h-4 rounded border-[hsl(var(--border))] text-[hsl(var(--primary))] focus:ring-[hsl(var(--primary))]"
                />
                <span className="text-sm text-[hsl(var(--foreground))]">{label}</span>
              </label>
            ))}
            {notifError && <p className="text-sm text-[hsl(var(--destructive))] mt-2">{notifError}</p>}
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-2">
              Changes are saved automatically.
            </p>
          </div>
        )}
      </Card>

      {/* Program Terms */}
      <Card title="Program Terms">
        {agreementLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
        ) : agreement ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[hsl(var(--muted-foreground))]">Version</span>
              <span className="font-medium text-[hsl(var(--foreground))]">{agreement.version}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-[hsl(var(--muted-foreground))]">Status</span>
              {agreement.accepted ? (
                <span className="inline-flex items-center gap-1 text-[hsl(var(--success))] font-medium">
                  <Check className="h-4 w-4" />
                  Accepted {agreement.acceptedAt ? `on ${formatDate(agreement.acceptedAt)}` : ''}
                </span>
              ) : (
                <span className="text-[hsl(var(--warning))] font-medium">Not yet accepted</span>
              )}
            </div>

            <button
              onClick={() => setTermsExpanded(!termsExpanded)}
              className="flex items-center gap-1 text-sm text-[hsl(var(--primary))] hover:underline"
            >
              {termsExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {termsExpanded ? 'Hide Full Terms' : 'View Full Terms'}
            </button>

            {termsExpanded && (
              <div className="mt-2 p-4 bg-[hsl(var(--muted))] rounded-[var(--radius)] text-sm text-[hsl(var(--foreground))] max-h-64 overflow-y-auto whitespace-pre-wrap">
                {agreement.termsText}
              </div>
            )}

            {!agreement.accepted && (
              <Button onClick={handleAcceptTerms} disabled={acceptingTerms} className="mt-2">
                {acceptingTerms ? 'Accepting...' : 'Accept Terms'}
              </Button>
            )}

            {termsMsg && (
              <p className={`text-sm ${termsMsg.includes('Failed') ? 'text-[hsl(var(--destructive))]' : 'text-[hsl(var(--success))]'}`}>
                {termsMsg}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            No program terms available at this time.
          </p>
        )}
      </Card>

      {/* Danger Zone */}
      <div className="border-2 border-[hsl(var(--destructive)/0.3)] rounded-lg">
        <Card title="Danger Zone">
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 text-[hsl(var(--destructive))] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-[hsl(var(--foreground))]">Request Account Deletion</p>
                <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                  Your data will be reviewed. Active referrals will continue to earn commission until processed.
                </p>
              </div>
            </div>

            {!deleteConfirm ? (
              <Button variant="destructive" size="sm" onClick={() => setDeleteConfirm(true)}>
                Request Deletion
              </Button>
            ) : (
              <div className="space-y-3 pt-2 border-t border-[hsl(var(--border))]">
                <div>
                  <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1">
                    Reason (optional)
                  </label>
                  <textarea
                    value={deleteReason}
                    onChange={(e) => setDeleteReason(e.target.value)}
                    rows={3}
                    className="w-full border border-[hsl(var(--border))] rounded-[var(--radius)] px-3 py-2 text-sm bg-[hsl(var(--card))] text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))] focus-visible:ring-offset-1"
                    placeholder="Tell us why you're leaving..."
                  />
                </div>
                <div className="flex gap-2">
                  <Button variant="destructive" size="sm" onClick={handleDeleteRequest} disabled={deleting}>
                    {deleting ? 'Submitting...' : 'Confirm Deletion Request'}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => { setDeleteConfirm(false); setDeleteReason(''); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {deleteError && <p className="text-sm text-[hsl(var(--destructive))]">{deleteError}</p>}
            {deleteMsg && <p className="text-sm text-[hsl(var(--success))]">{deleteMsg}</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}

export { SettingsTab };
