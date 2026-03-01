import { Label } from '@/components/ui/label';
import type { CommunicationStyle } from '@/hooks/useCompanyAI';
import { cn } from '@/lib/utils';

export const TONE_OPTIONS = [
  { value: 'professional' as const, label: 'Professional', description: 'Polished and business-appropriate' },
  { value: 'friendly' as const, label: 'Friendly', description: 'Warm and conversational' },
  { value: 'casual' as const, label: 'Casual', description: 'Relaxed and informal' },
  { value: 'formal' as const, label: 'Formal', description: 'Courteous and dignified' },
];

export const LENGTH_OPTIONS = [
  { value: 'concise' as const, label: 'Concise', description: '1-3 sentences' },
  { value: 'moderate' as const, label: 'Moderate', description: 'Balanced detail' },
  { value: 'detailed' as const, label: 'Detailed', description: 'Thorough explanations' },
];

export const EMOJI_OPTIONS = [
  { value: 'none' as const, label: 'None', description: 'No emojis' },
  { value: 'minimal' as const, label: 'Minimal', description: 'Sparingly' },
  { value: 'moderate' as const, label: 'Moderate', description: 'Friendly use' },
];

export function OptionButton({ selected, onClick, children, className }: {
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
  style: CommunicationStyle;
  onChange: (style: CommunicationStyle) => void;
  compact?: boolean;
}

export default function StyleFields({ style, onChange, compact }: Props) {
  const update = (field: keyof CommunicationStyle, value: string) => {
    onChange({ ...style, [field]: value });
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs">Tone</Label>
        <div className={cn('mt-1.5 grid gap-2', compact ? 'grid-cols-2' : 'grid-cols-2')}>
          {TONE_OPTIONS.map((opt) => (
            <OptionButton
              key={opt.value}
              selected={style.tone === opt.value}
              onClick={() => update('tone', opt.value)}
            >
              <div>
                <p className={cn('font-medium', compact ? 'text-xs' : 'text-sm')}>{opt.label}</p>
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
              selected={style.response_length === opt.value}
              onClick={() => update('response_length', opt.value)}
            >
              <div>
                <p className="text-xs font-medium">{opt.label}</p>
                <p className="text-xs text-muted-foreground">{opt.description}</p>
              </div>
            </OptionButton>
          ))}
        </div>
      </div>

      <div>
        <Label className="text-xs">Emoji Usage</Label>
        <div className="mt-1.5 grid grid-cols-3 gap-2">
          {EMOJI_OPTIONS.map((opt) => (
            <OptionButton
              key={opt.value}
              selected={style.emoji_usage === opt.value}
              onClick={() => update('emoji_usage', opt.value)}
            >
              <div>
                <p className="text-xs font-medium">{opt.label}</p>
                <p className="text-xs text-muted-foreground">{opt.description}</p>
              </div>
            </OptionButton>
          ))}
        </div>
      </div>
    </div>
  );
}
