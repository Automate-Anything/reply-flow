import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { ShieldCheck } from 'lucide-react';
import type { ProfileData } from '@/hooks/useCompanyAI';
import SectionCard from './SectionCard';

interface Props {
  profileData: ProfileData;
  isExpanded: boolean;
  onToggle: () => void;
  onSave: (data: Partial<ProfileData>) => Promise<void>;
  showSaveAsDefault?: boolean;
  saveAsDefault?: boolean;
  onSaveAsDefaultChange?: (val: boolean) => void;
}

export default function BehaviorSection({
  profileData, isExpanded, onToggle, onSave,
  showSaveAsDefault, saveAsDefault, onSaveAsDefaultChange,
}: Props) {
  const [step, setStep] = useState(0);
  const [responseRules, setResponseRules] = useState(profileData.response_rules || '');
  const [topicsToAvoid, setTopicsToAvoid] = useState(profileData.topics_to_avoid || '');
  const [greeting, setGreeting] = useState(profileData.greeting_message || '');
  const [escalationRules, setEscalationRules] = useState(profileData.escalation_rules || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        response_rules: responseRules.trim() || undefined,
        topics_to_avoid: topicsToAvoid.trim() || undefined,
        greeting_message: greeting.trim() || undefined,
        escalation_rules: escalationRules.trim() || undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = () => {
    setStep(0);
    setResponseRules(profileData.response_rules || '');
    setTopicsToAvoid(profileData.topics_to_avoid || '');
    setGreeting(profileData.greeting_message || '');
    setEscalationRules(profileData.escalation_rules || '');
    onToggle();
  };

  const isConfigured = !!(profileData.response_rules || profileData.greeting_message || profileData.escalation_rules || profileData.topics_to_avoid);

  const parts: string[] = [];
  if (profileData.response_rules) parts.push(`Rules: ${profileData.response_rules.slice(0, 50)}...`);
  if (profileData.greeting_message) parts.push(`Greeting set`);
  if (profileData.topics_to_avoid) parts.push(`Avoid topics set`);
  if (profileData.escalation_rules) parts.push(`Escalation rules set`);
  const summaryText = isConfigured ? parts.join(' \u00b7 ') : 'Set rules, greeting, and escalation behavior';

  return (
    <SectionCard
      icon={<ShieldCheck className="h-4 w-4" />}
      title="Behavior & Rules"
      isConfigured={isConfigured}
      summary={summaryText}
      isExpanded={isExpanded}
      onToggle={handleToggle}
      saving={saving}
      onSave={handleSave}
      onCancel={handleToggle}
      step={step}
      totalSteps={2}
      onNext={() => setStep(1)}
      onBack={() => setStep(0)}
      showSaveAsDefault={showSaveAsDefault}
      saveAsDefault={saveAsDefault}
      onSaveAsDefaultChange={onSaveAsDefaultChange}
    >
      {step === 0 && (
        <div className="space-y-4">
          <div>
            <p className="text-xs text-muted-foreground">
              Set rules and restrictions for the AI's behavior.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Response Rules (optional)</Label>
            <textarea
              value={responseRules}
              onChange={(e) => setResponseRules(e.target.value)}
              rows={4}
              placeholder="e.g. Always mention our business hours (9am-5pm). Never discuss competitor products. Always offer to connect with a human agent for complaints."
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Topics to Avoid (optional)</Label>
            <textarea
              value={topicsToAvoid}
              onChange={(e) => setTopicsToAvoid(e.target.value)}
              rows={3}
              placeholder="e.g. Internal pricing strategies, competitor comparisons, employee personal information, unannounced products..."
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <div>
            <p className="text-xs text-muted-foreground">
              Set greeting and escalation messages.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Greeting Message (optional)</Label>
            <textarea
              value={greeting}
              onChange={(e) => setGreeting(e.target.value)}
              rows={2}
              placeholder="e.g. Hi! Welcome to Acme Corp. How can I help you today?"
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              Sent as the first response to new contacts.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Escalation Rules (optional)</Label>
            <textarea
              value={escalationRules}
              onChange={(e) => setEscalationRules(e.target.value)}
              rows={3}
              placeholder="e.g. Hand off to a human when the customer mentions a complaint, legal issue, or asks to speak with a manager. Say: 'Let me connect you with a team member who can help.'"
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              When and how the AI should hand conversations to a human.
            </p>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
