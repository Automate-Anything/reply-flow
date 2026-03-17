import { useState } from 'react';
import { Palette } from 'lucide-react';
import type { CommunicationStyle } from '@/hooks/useCompanyAI';
import StyleFields from '../response-flow/StyleFields';
import StylePreview from '../response-flow/StylePreview';
import SectionCard from './SectionCard';
import { TONE_OPTIONS, LENGTH_OPTIONS, EMOJI_OPTIONS } from '../response-flow/StyleFields';

interface Props {
  style: CommunicationStyle;
  isExpanded: boolean;
  onToggle: () => void;
  onSave: (style: CommunicationStyle) => Promise<void>;
}

function formatStyleBrief(style: CommunicationStyle): string {
  const parts: string[] = [];
  const tone = TONE_OPTIONS.find((o) => o.value === style.tone);
  if (tone) parts.push(`${tone.label} tone`);
  const len = LENGTH_OPTIONS.find((o) => o.value === style.response_length);
  if (len) parts.push(`${len.label.toLowerCase()} length`);
  const emoji = EMOJI_OPTIONS.find((o) => o.value === style.emoji_usage);
  if (emoji) parts.push(`${emoji.label.toLowerCase()} emoji`);
  return parts.join(', ') || 'Not configured';
}

export default function StyleSection({ style, isExpanded, onToggle, onSave }: Props) {
  const [draft, setDraft] = useState<CommunicationStyle>(style);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      onToggle();
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = () => {
    setDraft(style);
    onToggle();
  };

  const isConfigured = !!(style.tone || style.response_length || style.emoji_usage);

  return (
    <SectionCard
      icon={<Palette className="h-4 w-4" />}
      title="Communication Style"
      isConfigured={isConfigured}
      summary={formatStyleBrief(style)}
      isExpanded={isExpanded}
      onToggle={handleToggle}
      saving={saving}
      onSave={handleSave}
      onCancel={handleToggle}
    >
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Set the default tone and style for your AI agent. Scenarios can override these individually.
        </p>
        <StyleFields style={draft} onChange={setDraft} />
        <StylePreview style={draft} />
      </div>
    </SectionCard>
  );
}
