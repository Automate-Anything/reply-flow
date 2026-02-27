import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { MessageSquare } from 'lucide-react';
import type { ProfileData } from '@/hooks/useCompanyAI';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import SectionCard from './SectionCard';

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'he', label: 'Hebrew' },
  { value: 'ar', label: 'Arabic' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ru', label: 'Russian' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ko', label: 'Korean' },
  { value: 'it', label: 'Italian' },
  { value: 'tr', label: 'Turkish' },
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

const EMOJI_OPTIONS = [
  { value: 'none' as const, label: 'None', description: 'No emojis' },
  { value: 'minimal' as const, label: 'Minimal', description: 'Sparingly' },
  { value: 'moderate' as const, label: 'Moderate', description: 'Friendly use' },
];

function OptionButton({ selected, onClick, children, className }: {
  selected: boolean; onClick: () => void; children: React.ReactNode; className?: string;
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

interface Props {
  profileData: ProfileData;
  defaultLanguage: string;
  isExpanded: boolean;
  onToggle: () => void;
  onSave: (profileUpdates: Partial<ProfileData>, settingsUpdates: { default_language: string }) => Promise<void>;
  showSaveAsDefault?: boolean;
  saveAsDefault?: boolean;
  onSaveAsDefaultChange?: (val: boolean) => void;
}

export default function CommunicationSection({
  profileData, defaultLanguage, isExpanded, onToggle, onSave,
  showSaveAsDefault, saveAsDefault, onSaveAsDefaultChange,
}: Props) {
  const [draft, setDraft] = useState<ProfileData>({ ...profileData });
  const [draftLang, setDraftLang] = useState(defaultLanguage);
  const [saving, setSaving] = useState(false);

  const update = (updates: Partial<ProfileData>) => setDraft((prev) => ({ ...prev, ...updates }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(
        {
          tone: draft.tone,
          response_length: draft.response_length,
          emoji_usage: draft.emoji_usage,
          language_preference: draft.language_preference,
        },
        { default_language: draftLang }
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = () => {
    setDraft({ ...profileData });
    setDraftLang(defaultLanguage);
    onToggle();
  };

  const isConfigured = !!profileData.tone && !!profileData.response_length;

  const parts: string[] = [];
  if (profileData.tone) parts.push(profileData.tone.charAt(0).toUpperCase() + profileData.tone.slice(1));
  if (profileData.response_length) parts.push(profileData.response_length);
  if (profileData.emoji_usage) parts.push(`emoji: ${profileData.emoji_usage}`);
  if (profileData.language_preference) {
    parts.push(profileData.language_preference === 'match_customer' ? 'match customer lang' : profileData.language_preference);
  }
  const summaryText = isConfigured ? parts.join(' \u00b7 ') : 'Set tone, length, and language preferences';

  return (
    <SectionCard
      icon={<MessageSquare className="h-4 w-4" />}
      title="Communication Style"
      isConfigured={isConfigured}
      summary={summaryText}
      isExpanded={isExpanded}
      onToggle={handleToggle}
      saving={saving}
      onSave={handleSave}
      onCancel={handleToggle}
      canSave={!!draft.tone && !!draft.response_length && !!draft.language_preference}
      showSaveAsDefault={showSaveAsDefault}
      saveAsDefault={saveAsDefault}
      onSaveAsDefaultChange={onSaveAsDefaultChange}
    >
      <div className="space-y-4">
        {/* Tone */}
        <div>
          <Label className="text-xs">Tone</Label>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {TONE_OPTIONS.map((opt) => (
              <OptionButton
                key={opt.value}
                selected={draft.tone === opt.value}
                onClick={() => update({ tone: opt.value })}
              >
                <div>
                  <p className="text-sm font-medium">{opt.label}</p>
                  <p className="text-xs text-muted-foreground">{opt.description}</p>
                </div>
              </OptionButton>
            ))}
          </div>
        </div>

        {/* Response Length */}
        <div>
          <Label className="text-xs">Response Length</Label>
          <div className="mt-1.5 grid grid-cols-3 gap-2">
            {LENGTH_OPTIONS.map((opt) => (
              <OptionButton
                key={opt.value}
                selected={draft.response_length === opt.value}
                onClick={() => update({ response_length: opt.value })}
              >
                <div>
                  <p className="text-xs font-medium">{opt.label}</p>
                  <p className="text-xs text-muted-foreground">{opt.description}</p>
                </div>
              </OptionButton>
            ))}
          </div>
        </div>

        {/* Emoji Usage */}
        <div>
          <Label className="text-xs">Emoji Usage</Label>
          <div className="mt-1.5 grid grid-cols-3 gap-2">
            {EMOJI_OPTIONS.map((opt) => (
              <OptionButton
                key={opt.value}
                selected={draft.emoji_usage === opt.value}
                onClick={() => update({ emoji_usage: opt.value })}
              >
                <div>
                  <p className="text-xs font-medium">{opt.label}</p>
                  <p className="text-xs text-muted-foreground">{opt.description}</p>
                </div>
              </OptionButton>
            ))}
          </div>
        </div>

        {/* Language Preference */}
        <div className="space-y-1.5">
          <Label className="text-xs">Response Language</Label>
          <div className="grid grid-cols-2 gap-2">
            <OptionButton
              selected={draft.language_preference === 'match_customer'}
              onClick={() => update({ language_preference: 'match_customer' })}
            >
              <div>
                <p className="text-xs font-medium">Match customer</p>
                <p className="text-xs text-muted-foreground">Respond in their language</p>
              </div>
            </OptionButton>
            <OptionButton
              selected={draft.language_preference !== undefined && draft.language_preference !== 'match_customer'}
              onClick={() => update({ language_preference: 'English' })}
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
              onChange={(e) => update({ language_preference: e.target.value })}
              placeholder="e.g. English, Spanish, Hebrew"
              className="mt-2 h-9"
            />
          )}
        </div>

        {/* Default Language */}
        <div className="space-y-1.5 border-t pt-3">
          <Label className="text-xs">Default Language</Label>
          <p className="text-xs text-muted-foreground">
            The primary language for this channel's AI agent.
          </p>
          <Select value={draftLang} onValueChange={setDraftLang}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((lang) => (
                <SelectItem key={lang.value} value={lang.value}>
                  {lang.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </SectionCard>
  );
}
