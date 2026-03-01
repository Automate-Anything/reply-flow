import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, ChevronDown, FlaskConical, Loader2, Zap } from 'lucide-react';
import type { ProfileData, Scenario } from '@/hooks/useCompanyAI';
import { cn } from '@/lib/utils';
import { useResponseFlow } from './useResponseFlow';
import ScenarioCard from './ScenarioCard';
import ScenarioDialog from './ScenarioDialog';
import FallbackToggle from './FallbackToggle';
import TestDialog from './TestDialog';

const PRESET_SUGGESTIONS = [
  'Appointment Booking',
  'Product Inquiry',
  'Pricing Question',
  'Complaint / Issue',
  'Order Status',
  'Hours & Location',
  'General Inquiry',
  'Technical Support',
];

interface Props {
  profileData: ProfileData;
  channelId?: number;
  agentId?: string;
  onSave: (data: Partial<ProfileData>) => Promise<void>;
}

export default function ResponseFlowSection({
  profileData, channelId, agentId, onSave,
}: Props) {
  const {
    flow, dirty, updateFlow, updateDefaultStyle,
    addScenario, updateScenario, removeScenario,
    setFallbackMode, reset,
  } = useResponseFlow(profileData);

  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingScenario, setEditingScenario] = useState<Scenario | null>(null);
  const [testOpen, setTestOpen] = useState(false);

  // Add scenario input
  const [customLabel, setCustomLabel] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasLabel = (label: string) =>
    flow.scenarios.some((s) => s.label.toLowerCase() === label.toLowerCase());

  const handleAddScenario = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed || hasLabel(trimmed)) return;
    const scenario = addScenario(trimmed);
    setCustomLabel('');
    setShowSuggestions(false);
    // Open dialog for the new scenario
    setEditingScenario(scenario);
    setDialogOpen(true);
  };

  const handleEditScenario = (scenario: Scenario) => {
    setEditingScenario(scenario);
    setDialogOpen(true);
  };

  const handleDialogSave = (data: Omit<Scenario, 'id'>) => {
    if (editingScenario) {
      updateScenario(editingScenario.id, data);
    }
    setEditingScenario(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ response_flow: flow });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    reset();
  };

  const availableSuggestions = PRESET_SUGGESTIONS.filter((s) => !hasLabel(s));

  return (
    <div className="rounded-lg border bg-card/50">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <Zap className="h-4 w-4 text-muted-foreground" />
        <div>
          <h3 className="text-sm font-medium">Response Flow</h3>
          <p className="text-xs text-muted-foreground">
            Define how the AI responds to different types of messages.
          </p>
        </div>
      </div>

      <div className="p-4 space-y-5">
        {/* Scenarios */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium">Scenarios</Label>
            <span className="text-[10px] text-muted-foreground">
              {flow.scenarios.length} scenario{flow.scenarios.length !== 1 ? 's' : ''}
            </span>
          </div>

          {flow.scenarios.length > 0 && (
            <div className="space-y-2">
              {flow.scenarios.map((scenario) => (
                <ScenarioCard
                  key={scenario.id}
                  scenario={scenario}
                  defaultStyle={flow.default_style}
                  onEdit={() => handleEditScenario(scenario)}
                  onDelete={() => removeScenario(scenario.id)}
                />
              ))}
            </div>
          )}

          {/* Add scenario */}
          <div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Input
                  ref={inputRef}
                  value={customLabel}
                  onChange={(e) => {
                    setCustomLabel(e.target.value);
                    if (e.target.value.trim()) setShowSuggestions(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddScenario(customLabel);
                    }
                  }}
                  placeholder="Add scenario..."
                  className="h-9 text-sm pr-8"
                />
                {availableSuggestions.length > 0 && (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setShowSuggestions((prev) => !prev);
                      inputRef.current?.focus();
                    }}
                  >
                    <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showSuggestions && 'rotate-180')} />
                  </button>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleAddScenario(customLabel)}
                disabled={!customLabel.trim() || hasLabel(customLabel.trim())}
                className="h-9 shrink-0"
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add
              </Button>
            </div>

            {/* Suggestions dropdown */}
            {showSuggestions && (customLabel.trim() || availableSuggestions.length > 0) && (
              <div className="mt-1.5 rounded-md border bg-popover p-1">
                {customLabel.trim() && !hasLabel(customLabel.trim()) && (
                  <button
                    type="button"
                    className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
                    onClick={() => handleAddScenario(customLabel)}
                  >
                    <Plus className="mr-2 h-3 w-3 text-muted-foreground" />
                    Add &ldquo;{customLabel.trim()}&rdquo;
                  </button>
                )}
                {availableSuggestions
                  .filter((s) => !customLabel || s.toLowerCase().includes(customLabel.toLowerCase()))
                  .length > 0 && (
                  <>
                    <p className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Suggestions</p>
                    {availableSuggestions
                      .filter((s) => !customLabel || s.toLowerCase().includes(customLabel.toLowerCase()))
                      .map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                          onClick={() => handleAddScenario(suggestion)}
                        >
                          <Plus className="mr-2 h-3 w-3 text-muted-foreground" />
                          {suggestion}
                        </button>
                      ))}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Test button */}
          {(channelId || agentId) && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setTestOpen(true)}
            >
              <FlaskConical className="mr-1.5 h-3.5 w-3.5" />
              Test with a message
            </Button>
          )}
        </div>

        {/* Unmatched Messages */}
        <div className="border-t pt-4">
          <FallbackToggle
            mode={flow.fallback_mode}
            onChange={setFallbackMode}
            style={flow.default_style}
            greetingMessage={flow.greeting_message}
            responseRules={flow.response_rules}
            topicsToAvoid={flow.topics_to_avoid}
            humanPhone={flow.human_phone}
            onStyleChange={updateDefaultStyle}
            onGreetingChange={(v) => updateFlow({ greeting_message: v || undefined })}
            onRulesChange={(v) => updateFlow({ response_rules: v || undefined })}
            onTopicsChange={(v) => updateFlow({ topics_to_avoid: v || undefined })}
            onPhoneChange={(v) => updateFlow({ human_phone: v || undefined })}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t pt-4 gap-2">
          <Button variant="outline" size="sm" onClick={handleCancel} disabled={!dirty}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
        </div>
      </div>

      {/* Scenario Dialog */}
      <ScenarioDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingScenario(null);
        }}
        scenario={editingScenario}
        defaultStyle={flow.default_style}
        onSave={handleDialogSave}
      />

      {/* Test Dialog */}
      {(channelId || agentId) && (
        <TestDialog
          open={testOpen}
          onOpenChange={setTestOpen}
          profileData={{ ...profileData, response_flow: flow }}
          channelId={channelId}
          agentId={agentId}
        />
      )}
    </div>
  );
}
