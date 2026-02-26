import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Briefcase, User, Building2, ChevronRight, ChevronLeft,
  Check, Loader2, Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ProfileData, ChannelAIProfile } from '@/hooks/useChannelAI';
import { cn } from '@/lib/utils';

interface Props {
  profile: ChannelAIProfile;
  onSave: (updates: Partial<ChannelAIProfile>) => Promise<unknown>;
}

const TOTAL_STEPS = 4;

const USE_CASE_OPTIONS = [
  { value: 'business' as const, label: 'Business', icon: Briefcase, description: 'Customer support, sales, or services' },
  { value: 'personal' as const, label: 'Personal', icon: User, description: 'Personal messaging assistant' },
  { value: 'organization' as const, label: 'Organization', icon: Building2, description: 'Non-profit, community, or team' },
];

const TONE_OPTIONS = [
  { value: 'professional' as const, label: 'Professional', description: 'Polished and business-appropriate' },
  { value: 'friendly' as const, label: 'Friendly', description: 'Warm and conversational' },
  { value: 'casual' as const, label: 'Casual', description: 'Relaxed and informal' },
  { value: 'formal' as const, label: 'Formal', description: 'Courteous and dignified' },
];

const LENGTH_OPTIONS = [
  { value: 'concise' as const, label: 'Concise', description: '1-3 sentences' },
  { value: 'moderate' as const, label: 'Moderate', description: 'Balanced detail' },
  { value: 'detailed' as const, label: 'Detailed', description: 'Thorough explanations' },
];

function OptionButton({
  selected,
  onClick,
  children,
  className,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
        selected
          ? 'border-primary bg-primary/5 ring-1 ring-primary'
          : 'border-border hover:border-primary/50 hover:bg-muted/50',
        className
      )}
    >
      {children}
    </button>
  );
}

function ProfileSummary({ data, onEdit }: { data: ProfileData; onEdit: () => void }) {
  const items: { label: string; value: string }[] = [];

  if (data.use_case) {
    items.push({ label: 'Use Case', value: data.use_case.charAt(0).toUpperCase() + data.use_case.slice(1) });
  }
  if (data.business_name) {
    items.push({ label: 'Name', value: data.business_name });
  }
  if (data.business_type) {
    items.push({ label: 'Type', value: data.business_type });
  }
  if (data.business_description) {
    items.push({ label: 'Description', value: data.business_description });
  }
  if (data.target_audience) {
    items.push({ label: 'Audience', value: data.target_audience });
  }
  if (data.tone) {
    items.push({ label: 'Tone', value: data.tone.charAt(0).toUpperCase() + data.tone.slice(1) });
  }
  if (data.language_preference) {
    items.push({
      label: 'Language',
      value: data.language_preference === 'match_customer' ? 'Match customer language' : data.language_preference,
    });
  }
  if (data.response_length) {
    items.push({ label: 'Response Length', value: data.response_length.charAt(0).toUpperCase() + data.response_length.slice(1) });
  }
  if (data.response_rules) {
    items.push({ label: 'Rules', value: data.response_rules });
  }
  if (data.greeting_message) {
    items.push({ label: 'Greeting', value: data.greeting_message });
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <p className="text-sm text-muted-foreground">No AI profile configured yet.</p>
        <Button onClick={onEdit} size="sm">
          Set Up AI Profile
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">AI Profile</p>
        <Button variant="ghost" size="sm" onClick={onEdit} className="h-7 gap-1.5 text-xs">
          <Pencil className="h-3 w-3" />
          Edit
        </Button>
      </div>
      <div className="grid gap-2 rounded-lg border p-3 text-sm">
        {items.map(({ label, value }) => (
          <div key={label} className="flex gap-2">
            <span className="shrink-0 text-muted-foreground">{label}:</span>
            <span className="line-clamp-2">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AIProfileWizard({ profile, onSave }: Props) {
  const [editing, setEditing] = useState(!profile.profile_data?.use_case);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<ProfileData>({ ...profile.profile_data });

  const updateDraft = (updates: Partial<ProfileData>) => {
    setDraft((prev) => ({ ...prev, ...updates }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ profile_data: draft });
      toast.success('AI profile saved');
      setEditing(false);
    } catch {
      toast.error('Failed to save AI profile');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = () => {
    setDraft({ ...profile.profile_data });
    setStep(0);
    setEditing(true);
  };

  if (!editing) {
    return <ProfileSummary data={profile.profile_data} onEdit={handleEdit} />;
  }

  return (
    <div className="space-y-4">
      {/* Progress */}
      <div className="flex items-center gap-1.5">
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors',
              i <= step ? 'bg-primary' : 'bg-muted'
            )}
          />
        ))}
      </div>

      {/* Step 1: Use Case */}
      {step === 0 && (
        <Card>
          <CardContent className="space-y-4 pt-5">
            <div>
              <p className="text-sm font-medium">What will this channel be used for?</p>
              <p className="text-xs text-muted-foreground mt-1">This helps us tailor the AI's behavior.</p>
            </div>

            <div className="grid gap-2">
              {USE_CASE_OPTIONS.map((opt) => (
                <OptionButton
                  key={opt.value}
                  selected={draft.use_case === opt.value}
                  onClick={() => updateDraft({ use_case: opt.value })}
                >
                  <opt.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{opt.label}</p>
                    <p className="text-xs text-muted-foreground">{opt.description}</p>
                  </div>
                </OptionButton>
              ))}
            </div>

            {(draft.use_case === 'business' || draft.use_case === 'organization') && (
              <div className="space-y-3 border-t pt-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{draft.use_case === 'business' ? 'Business Name' : 'Organization Name'}</Label>
                  <Input
                    value={draft.business_name || ''}
                    onChange={(e) => updateDraft({ business_name: e.target.value })}
                    placeholder="e.g. Acme Corp"
                    className="h-9"
                  />
                </div>
                {draft.use_case === 'business' && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Business Type</Label>
                    <Input
                      value={draft.business_type || ''}
                      onChange={(e) => updateDraft({ business_type: e.target.value })}
                      placeholder="e.g. Restaurant, E-commerce, Consulting"
                      className="h-9"
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label className="text-xs">Description</Label>
                  <textarea
                    value={draft.business_description || ''}
                    onChange={(e) => updateDraft({ business_description: e.target.value })}
                    rows={3}
                    placeholder="Briefly describe what you do..."
                    className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
              </div>
            )}

            {draft.use_case === 'personal' && (
              <div className="space-y-1.5 border-t pt-3">
                <Label className="text-xs">What do you want the AI to help with?</Label>
                <textarea
                  value={draft.business_description || ''}
                  onChange={(e) => updateDraft({ business_description: e.target.value })}
                  rows={3}
                  placeholder="e.g. Managing personal appointments, replying to friends..."
                  className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 2: Audience */}
      {step === 1 && (
        <Card>
          <CardContent className="space-y-4 pt-5">
            <div>
              <p className="text-sm font-medium">Who will be messaging this channel?</p>
              <p className="text-xs text-muted-foreground mt-1">
                Describe the people the AI will be talking to.
              </p>
            </div>
            <textarea
              value={draft.target_audience || ''}
              onChange={(e) => updateDraft({ target_audience: e.target.value })}
              rows={4}
              placeholder={
                draft.use_case === 'business'
                  ? 'e.g. Customers looking for product information, pricing inquiries, support requests...'
                  : 'e.g. Friends, family members, colleagues...'
              }
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </CardContent>
        </Card>
      )}

      {/* Step 3: Communication Style */}
      {step === 2 && (
        <Card>
          <CardContent className="space-y-4 pt-5">
            <div>
              <p className="text-sm font-medium">How should the AI communicate?</p>
              <p className="text-xs text-muted-foreground mt-1">Set the tone and style of responses.</p>
            </div>

            <div>
              <Label className="text-xs">Tone</Label>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {TONE_OPTIONS.map((opt) => (
                  <OptionButton
                    key={opt.value}
                    selected={draft.tone === opt.value}
                    onClick={() => updateDraft({ tone: opt.value })}
                  >
                    <div>
                      <p className="text-sm font-medium">{opt.label}</p>
                      <p className="text-xs text-muted-foreground">{opt.description}</p>
                    </div>
                  </OptionButton>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs">Response Length</Label>
              <div className="mt-1.5 grid grid-cols-3 gap-2">
                {LENGTH_OPTIONS.map((opt) => (
                  <OptionButton
                    key={opt.value}
                    selected={draft.response_length === opt.value}
                    onClick={() => updateDraft({ response_length: opt.value })}
                  >
                    <div>
                      <p className="text-xs font-medium">{opt.label}</p>
                      <p className="text-xs text-muted-foreground">{opt.description}</p>
                    </div>
                  </OptionButton>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Language</Label>
              <div className="grid grid-cols-2 gap-2">
                <OptionButton
                  selected={draft.language_preference === 'match_customer'}
                  onClick={() => updateDraft({ language_preference: 'match_customer' })}
                >
                  <div>
                    <p className="text-xs font-medium">Match customer</p>
                    <p className="text-xs text-muted-foreground">Respond in their language</p>
                  </div>
                </OptionButton>
                <OptionButton
                  selected={draft.language_preference !== undefined && draft.language_preference !== 'match_customer'}
                  onClick={() => updateDraft({ language_preference: 'English' })}
                >
                  <div>
                    <p className="text-xs font-medium">Specific language</p>
                    <p className="text-xs text-muted-foreground">Always use one language</p>
                  </div>
                </OptionButton>
              </div>
              {draft.language_preference && draft.language_preference !== 'match_customer' && (
                <Input
                  value={draft.language_preference}
                  onChange={(e) => updateDraft({ language_preference: e.target.value })}
                  placeholder="e.g. English, Spanish, Hebrew"
                  className="mt-2 h-9"
                />
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Response Rules */}
      {step === 3 && (
        <Card>
          <CardContent className="space-y-4 pt-5">
            <div>
              <p className="text-sm font-medium">Any specific instructions for the AI?</p>
              <p className="text-xs text-muted-foreground mt-1">
                Set rules, things to always mention, or topics to avoid.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Response Rules (optional)</Label>
              <textarea
                value={draft.response_rules || ''}
                onChange={(e) => updateDraft({ response_rules: e.target.value })}
                rows={4}
                placeholder="e.g. Always mention our business hours (9am-5pm). Never discuss competitor products. Always offer to connect with a human agent for complaints."
                className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Greeting Message (optional)</Label>
              <textarea
                value={draft.greeting_message || ''}
                onChange={(e) => updateDraft({ greeting_message: e.target.value })}
                rows={2}
                placeholder="e.g. Hi! Welcome to Acme Corp. How can I help you today?"
                className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <p className="text-xs text-muted-foreground">
                Sent as the first response to new contacts.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <div>
          {step > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)}>
              <ChevronLeft className="mr-1 h-3.5 w-3.5" />
              Back
            </Button>
          ) : (
            profile.profile_data?.use_case && (
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )
          )}
        </div>
        <div>
          {step < TOTAL_STEPS - 1 ? (
            <Button
              size="sm"
              onClick={() => setStep(step + 1)}
              disabled={step === 0 && !draft.use_case}
            >
              Next
              <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="mr-1.5 h-3.5 w-3.5" />
              )}
              {saving ? 'Saving...' : 'Save Profile'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
