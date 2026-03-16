import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { useSession } from '@/contexts/SessionContext';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Loader2, Building2, Trash2, ChevronsUpDown, Check, Paintbrush, Upload, X } from 'lucide-react';
import { BRAND_PRESETS, applyBrandColor } from '@/lib/brand-colors';
import { cn } from '@/lib/utils';
import BusinessHoursSettings from '@/components/settings/BusinessHoursSettings';
import HolidayEditor from '@/components/settings/HolidayEditor';
import { PlanGate } from '@/components/auth/PlanGate';

interface Company {
  id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
  timezone: string;
  session_timeout_hours: number;
  business_type: string | null;
  business_description: string | null;
  brand_color: string | null;
}

const TIMEZONES = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    // Fallback for older browsers
    return [
      'UTC',
      'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
      'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
      'Europe/Moscow', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai',
      'Asia/Tokyo', 'Asia/Jerusalem', 'Australia/Sydney', 'Pacific/Auckland',
    ];
  }
})();

export default function CompanySettingsPage() {
  const navigate = useNavigate();
  const { hasPermission, role, companyName, refresh } = useSession();
  const canEdit = hasPermission('company_settings', 'edit');
  const isOwner = role === 'owner';

  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [businessDescription, setBusinessDescription] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [tzOpen, setTzOpen] = useState(false);
  const [tzSearch, setTzSearch] = useState('');
  const [brandColor, setBrandColor] = useState<string | null>(null);
  const [savedBrandColor, setSavedBrandColor] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [removingLogo, setRemovingLogo] = useState(false);
  const [customColorInput, setCustomColorInput] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const fetchCompany = useCallback(async () => {
    try {
      const { data } = await api.get('/company');
      setCompany(data.company);
      setName(data.company.name);
      setBusinessType(data.company.business_type || '');
      setBusinessDescription(data.company.business_description || '');
      setTimezone(data.company.timezone || 'UTC');
      setBrandColor(data.company.brand_color || null);
      setSavedBrandColor(data.company.brand_color || null);
      setLogoUrl(data.company.logo_url || null);
      const isCustom = data.company.brand_color && !BRAND_PRESETS.some(p => p.hex === data.company.brand_color);
      if (isCustom) {
        setCustomColorInput(data.company.brand_color);
        setShowCustomInput(true);
      }
    } catch {
      toast.error('Failed to load company settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCompany();
  }, [fetchCompany]);

  const filteredTimezones = useMemo(() => {
    if (!tzSearch) return TIMEZONES;
    const q = tzSearch.toLowerCase();
    return TIMEZONES.filter((tz) => tz.toLowerCase().includes(q));
  }, [tzSearch]);

  const hasChanges = useMemo(() => {
    if (!company) return false;
    return (
      name.trim() !== company.name ||
      businessType.trim() !== (company.business_type || '') ||
      businessDescription.trim() !== (company.business_description || '') ||
      timezone !== (company.timezone || 'UTC')
    );
  }, [company, name, businessType, businessDescription, timezone]);

  const hasBrandingChanges = brandColor !== savedBrandColor;

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Company name is required');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.put('/company', {
        name: name.trim(),
        business_type: businessType.trim() || null,
        business_description: businessDescription.trim() || null,
        timezone,
      });
      setCompany(data.company);
      toast.success('Company settings updated');
    } catch {
      toast.error('Failed to update company settings');
    } finally {
      setSaving(false);
    }
  };

  const [savingBranding, setSavingBranding] = useState(false);

  const handleBrandingSave = async () => {
    setSavingBranding(true);
    try {
      const { data } = await api.put('/company', { brand_color: brandColor });
      setCompany(data.company);
      setSavedBrandColor(data.company.brand_color || null);
      await refresh();
      toast.success('Branding updated');
    } catch {
      toast.error('Failed to update branding');
    } finally {
      setSavingBranding(false);
    }
  };

  // Revert live brand color preview if user leaves without saving
  useEffect(() => {
    return () => {
      // On unmount, re-apply the saved color (in case user previewed but didn't save)
      applyBrandColor(savedBrandColor);
    };
  }, [savedBrandColor]);

  const handleBrandColorChange = (hex: string | null) => {
    setBrandColor(hex);
    applyBrandColor(hex); // live preview
    setShowCustomInput(false);
    setCustomColorInput('');
  };

  const handleCustomColorApply = () => {
    const val = customColorInput.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      setBrandColor(val);
      applyBrandColor(val);
    } else {
      toast.error('Enter a valid hex color (e.g. #2563eb)');
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Client-side validation
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      toast.error('Only JPEG, PNG, and WebP images are allowed');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Logo must be under 2MB');
      return;
    }

    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('logo', file);
      const { data } = await api.post('/company/logo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setLogoUrl(data.logo_url);
      await refresh();
      toast.success('Logo uploaded');
    } catch {
      toast.error('Failed to upload logo');
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  const handleLogoRemove = async () => {
    setRemovingLogo(true);
    try {
      await api.delete('/company/logo');
      setLogoUrl(null);
      await refresh();
      toast.success('Logo removed');
    } catch {
      toast.error('Failed to remove logo');
    } finally {
      setRemovingLogo(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete('/company');
      await refresh();
      navigate('/onboarding', { replace: true });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error || 'Failed to delete company';
      toast.error(msg);
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" />
            Company Information
          </CardTitle>
          <CardDescription>General settings for your company.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-1.5">
            <Label htmlFor="company-name">Company Name</Label>
            <Input
              id="company-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canEdit}
              placeholder="Your company name"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="business-type">Business Type</Label>
            <Input
              id="business-type"
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value)}
              disabled={!canEdit}
              placeholder="e.g. Restaurant, E-commerce, Consulting"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="business-description">About</Label>
            <textarea
              id="business-description"
              value={businessDescription}
              onChange={(e) => setBusinessDescription(e.target.value)}
              disabled={!canEdit}
              rows={3}
              placeholder="Briefly describe what your company does..."
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Timezone</Label>
            <p className="text-xs text-muted-foreground">
              Used for business hours and scheduling across the platform.
            </p>
            <Popover open={tzOpen} onOpenChange={(open) => { setTzOpen(open); if (!open) setTzSearch(''); }}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={tzOpen}
                  disabled={!canEdit}
                  className="w-full justify-between font-normal"
                >
                  {timezone}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <div className="border-b px-3 py-2">
                  <Input
                    placeholder="Search timezones..."
                    value={tzSearch}
                    onChange={(e) => setTzSearch(e.target.value)}
                    className="h-8 border-0 p-0 shadow-none focus-visible:ring-0"
                  />
                </div>
                <div className="max-h-60 overflow-y-auto p-1">
                  {filteredTimezones.length === 0 ? (
                    <p className="px-2 py-4 text-center text-sm text-muted-foreground">No timezone found.</p>
                  ) : (
                    filteredTimezones.map((tz) => (
                      <button
                        key={tz}
                        type="button"
                        className={cn(
                          'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors',
                          tz === timezone && 'bg-accent'
                        )}
                        onClick={() => {
                          setTimezone(tz);
                          setTzOpen(false);
                          setTzSearch('');
                        }}
                      >
                        <Check className={cn('h-4 w-4 shrink-0', tz === timezone ? 'opacity-100' : 'opacity-0')} />
                        {tz}
                      </button>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {canEdit && (
            <div className="flex justify-end border-t pt-4">
              <PlanGate>
                <Button onClick={handleSave} disabled={saving || !hasChanges}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </PlanGate>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Paintbrush className="h-4 w-4" />
            Branding
          </CardTitle>
          <CardDescription>Customize your company's logo and color scheme.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Logo upload */}
          <div className="space-y-3">
            <Label>Company Logo</Label>
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start sm:gap-4">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={name || 'Company logo'}
                  className="h-16 w-16 rounded-xl border object-contain p-1"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-xl border bg-muted text-xl font-bold text-muted-foreground">
                  {(name || 'C').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="flex flex-col items-center gap-1.5 sm:items-start">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleLogoUpload}
                  disabled={!canEdit}
                />
                <div className="flex items-center gap-2">
                  <PlanGate>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!canEdit || uploadingLogo}
                      onClick={() => logoInputRef.current?.click()}
                    >
                      {uploadingLogo ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Upload className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      {logoUrl ? 'Change' : 'Upload'}
                    </Button>
                  </PlanGate>
                  {logoUrl && (
                    <PlanGate>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!canEdit || removingLogo}
                        onClick={handleLogoRemove}
                        className="text-destructive hover:text-destructive"
                      >
                        {removingLogo ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <X className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Remove
                      </Button>
                    </PlanGate>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  JPEG, PNG, or WebP. Max 2MB.
                </p>
              </div>
            </div>
          </div>

          {/* Brand color picker */}
          <div className="space-y-3">
            <Label>Brand Color</Label>
            <p className="text-xs text-muted-foreground">
              Changes the entire color theme across the app.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {BRAND_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  disabled={!canEdit}
                  title={preset.name}
                  className={cn(
                    'relative h-8 w-8 rounded-full border-2 transition-all hover:scale-110 disabled:opacity-50',
                    brandColor === preset.hex
                      ? 'border-foreground ring-2 ring-foreground/20'
                      : 'border-transparent'
                  )}
                  style={{ backgroundColor: preset.hex || '#0d9488' }}
                  onClick={() => handleBrandColorChange(preset.hex)}
                >
                  {brandColor === preset.hex && (
                    <Check className="absolute inset-0 m-auto h-4 w-4 text-white" />
                  )}
                </button>
              ))}
              {/* Custom color button */}
              <button
                type="button"
                disabled={!canEdit}
                title="Custom color"
                className={cn(
                  'relative flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all hover:scale-110 disabled:opacity-50',
                  showCustomInput && brandColor && !BRAND_PRESETS.some(p => p.hex === brandColor)
                    ? 'border-foreground ring-2 ring-foreground/20'
                    : 'border-muted-foreground/30',
                  'bg-gradient-to-br from-red-400 via-blue-400 to-green-400'
                )}
                onClick={() => setShowCustomInput(!showCustomInput)}
              >
                <Paintbrush className="h-3.5 w-3.5 text-white" />
              </button>
            </div>
            {showCustomInput && (
              <div className="flex items-center gap-2">
                <Input
                  placeholder="#2563eb"
                  value={customColorInput}
                  onChange={(e) => setCustomColorInput(e.target.value)}
                  disabled={!canEdit}
                  className="w-32 font-mono"
                  maxLength={7}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canEdit}
                  onClick={handleCustomColorApply}
                >
                  Apply
                </Button>
              </div>
            )}
          </div>

          {canEdit && (
            <div className="flex justify-end border-t pt-4">
              <PlanGate>
                <Button onClick={handleBrandingSave} disabled={savingBranding || !hasBrandingChanges}>
                  {savingBranding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Branding
                </Button>
              </PlanGate>
            </div>
          )}
        </CardContent>
      </Card>

      <BusinessHoursSettings />
      <HolidayEditor scope="company" canEdit={canEdit} />

      {isOwner && (
        <Card className="border-destructive/30">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <Trash2 className="h-4 w-4" />
              Delete Company
            </CardTitle>
            <CardDescription>
              This will permanently delete the company and all its data, including channels, conversations, and contacts.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-end">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <PlanGate>
                  <Button variant="destructive" size="sm">
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Delete
                  </Button>
                </PlanGate>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Delete {companyName || 'this company'}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the company, all channels, conversations, contacts, and other data. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    disabled={deleting}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Delete Company
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
