import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Pencil, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SectionCardProps {
  icon: ReactNode;
  title: string;
  isConfigured: boolean;
  summary: ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  // Editor props (only used when expanded)
  children?: ReactNode;
  saving?: boolean;
  onSave?: () => void;
  onCancel?: () => void;
  canSave?: boolean;
  // Multi-step support
  step?: number;
  totalSteps?: number;
  onNext?: () => void;
  onBack?: () => void;
  canProceed?: boolean;
  // Save as default
  showSaveAsDefault?: boolean;
  saveAsDefault?: boolean;
  onSaveAsDefaultChange?: (val: boolean) => void;
}

export default function SectionCard({
  icon,
  title,
  isConfigured,
  summary,
  isExpanded,
  onToggle,
  children,
  saving,
  onSave,
  onCancel,
  canSave = true,
  step = 0,
  totalSteps = 1,
  onNext,
  onBack,
  canProceed = true,
  showSaveAsDefault,
  saveAsDefault,
  onSaveAsDefaultChange,
}: SectionCardProps) {
  if (!isExpanded) {
    return (
      <Card className="transition-colors hover:border-primary/30">
        <CardContent className="flex items-start gap-3 py-4">
          <div className="mt-0.5 text-muted-foreground">{icon}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">{title}</p>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-medium',
                  isConfigured
                    ? 'bg-green-500/10 text-green-600'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                {isConfigured ? 'Configured' : 'Not configured'}
              </span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{summary}</div>
          </div>
          <Button variant="ghost" size="sm" onClick={onToggle} className="h-7 gap-1.5 text-xs shrink-0">
            <Pencil className="h-3 w-3" />
            {isConfigured ? 'Edit' : 'Set Up'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const isLastStep = step >= totalSteps - 1;

  return (
    <Card className="border-primary/50 ring-1 ring-primary/20">
      <CardContent className="space-y-4 pt-5">
        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="text-primary">{icon}</div>
          <p className="text-sm font-medium">{title}</p>
        </div>

        {/* Step progress (only for multi-step) */}
        {totalSteps > 1 && (
          <div className="flex items-center gap-1.5">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors',
                  i <= step ? 'bg-primary' : 'bg-muted'
                )}
              />
            ))}
          </div>
        )}

        {/* Content */}
        {children}

        {/* Footer */}
        <div className="flex items-center justify-between border-t pt-3">
          <div>
            {step > 0 && onBack ? (
              <Button variant="ghost" size="sm" onClick={onBack}>
                <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                Back
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
          <div className="flex items-center gap-3">
            {isLastStep && showSaveAsDefault && onSaveAsDefaultChange && (
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={saveAsDefault}
                  onCheckedChange={(checked) => onSaveAsDefaultChange(!!checked)}
                />
                <span className="text-xs text-muted-foreground">Set as default for new channels</span>
              </label>
            )}
            {!isLastStep && onNext ? (
              <Button size="sm" onClick={onNext} disabled={!canProceed}>
                Next
                <ChevronRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button size="sm" onClick={onSave} disabled={saving || !canSave}>
                {saving ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                )}
                {saving ? 'Saving...' : 'Save'}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
