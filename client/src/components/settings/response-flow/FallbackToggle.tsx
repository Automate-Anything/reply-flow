import type { FallbackMode, CommunicationStyle } from '@/hooks/useCompanyAI';
import StyleFields from './StyleFields';

interface Props {
  mode: FallbackMode;
  onChange: (mode: FallbackMode) => void;
  fallbackStyle?: CommunicationStyle;
  onFallbackStyleChange?: (style: CommunicationStyle) => void;
}

function RadioCircle({ selected }: { selected: boolean }) {
  return (
    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
      selected ? 'border-primary' : 'border-muted-foreground/40'
    }`}>
      {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
    </span>
  );
}

export default function FallbackToggle({ mode, onChange, fallbackStyle, onFallbackStyleChange }: Props) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2">
        {/* Option 1: AI responds with default style */}
        <button
          type="button"
          onClick={() => onChange('respond_basics')}
          className={`flex items-center gap-3 rounded-lg border p-3 text-left cursor-pointer transition-colors ${
            mode === 'respond_basics'
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-muted-foreground/30'
          }`}
        >
          <RadioCircle selected={mode === 'respond_basics'} />
          <div>
            <p className="text-xs font-medium">AI responds</p>
            <p className="text-xs text-muted-foreground">
              Uses your communication style and knowledge base to handle unmatched messages.
            </p>
          </div>
        </button>

        {/* Option 2: AI responds with custom style */}
        <div className={`rounded-lg border overflow-hidden transition-colors ${
          mode === 'respond_custom'
            ? 'border-primary'
            : 'border-border hover:border-muted-foreground/30'
        }`}>
          <button
            type="button"
            onClick={() => onChange('respond_custom')}
            className={`flex w-full items-center gap-3 p-3 text-left cursor-pointer transition-colors ${
              mode === 'respond_custom' ? 'bg-primary/5' : ''
            }`}
          >
            <RadioCircle selected={mode === 'respond_custom'} />
            <div>
              <p className="text-xs font-medium">AI responds with communication style override</p>
              <p className="text-xs text-muted-foreground">
                Override the communication style for fallback messages.
              </p>
            </div>
          </button>

          {mode === 'respond_custom' && onFallbackStyleChange && (
            <div className="border-t border-primary/20 bg-muted/30 p-4">
              <StyleFields
                style={fallbackStyle ?? {}}
                onChange={onFallbackStyleChange}
                compact
              />
            </div>
          )}
        </div>

        {/* Option 3: Human handle */}
        <button
          type="button"
          onClick={() => onChange('human_handle')}
          className={`flex items-center gap-3 rounded-lg border p-3 text-left cursor-pointer transition-colors ${
            mode === 'human_handle'
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-muted-foreground/30'
          }`}
        >
          <RadioCircle selected={mode === 'human_handle'} />
          <div>
            <p className="text-xs font-medium">Let a human handle it</p>
            <p className="text-xs text-muted-foreground">
              The AI won't respond. A team member can reply manually.
            </p>
          </div>
        </button>
      </div>
    </div>
  );
}
