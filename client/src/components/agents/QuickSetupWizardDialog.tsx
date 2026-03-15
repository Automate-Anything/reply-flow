import { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  Bot,
  Building2,
  MessageCircleQuestion,
  ListChecks,
  Palette,
  ShieldAlert,
  ArrowRight,
  ArrowLeft,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ProfileData } from '@/hooks/useCompanyAI';

interface QuickSetupWizardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (input: WizardFormData) => Promise<{ name: string; profile_data: ProfileData }>;
  onCreate: (body: { name: string; profile_data: ProfileData }) => Promise<{ id: string }>;
}

interface WizardFormData {
  business_name: string;
  business_type: string;
  business_description: string;
  common_questions: string;
  instructions: string;
  tone: string;
  response_length: string;
  emoji_usage: string;
  escalation_triggers: string[];
  escalation_custom?: string;
}

type Step = 'business' | 'questions' | 'instructions' | 'style' | 'escalation' | 'generating' | 'review';

const STEPS: Step[] = ['business', 'questions', 'instructions', 'style', 'escalation'];

const STEP_META: Record<string, { title: string; icon: React.ReactNode; number: number }> = {
  business:     { title: 'Your Business',       icon: <Building2 className="h-5 w-5" />,              number: 1 },
  questions:    { title: 'Common Questions',     icon: <MessageCircleQuestion className="h-5 w-5" />,  number: 2 },
  instructions: { title: 'Instructions',         icon: <ListChecks className="h-5 w-5" />,             number: 3 },
  style:        { title: 'Style & Tone',         icon: <Palette className="h-5 w-5" />,                number: 4 },
  escalation:   { title: 'Escalation',           icon: <ShieldAlert className="h-5 w-5" />,            number: 5 },
  generating:   { title: 'Generating...',        icon: <Sparkles className="h-5 w-5" />,               number: 6 },
  review:       { title: 'Review',               icon: <Bot className="h-5 w-5" />,                    number: 6 },
};

const ESCALATION_OPTIONS = [
  { id: 'angry_customer',       label: 'Customer is angry or frustrated' },
  { id: 'pricing_negotiation',  label: 'Pricing negotiation or discount requests' },
  { id: 'unknown_question',     label: "AI doesn't know the answer" },
  { id: 'human_request',        label: 'Customer asks to speak with a human' },
  { id: 'technical_issue',      label: 'Complex technical problems' },
  { id: 'refund_request',       label: 'Refund or cancellation requests' },
];

const TONE_LABELS: Record<string, string> = {
  professional: 'Professional',
  friendly: 'Friendly',
  casual: 'Casual',
  formal: 'Formal',
};

const LENGTH_LABELS: Record<string, string> = {
  concise: 'Concise',
  moderate: 'Moderate',
  detailed: 'Detailed',
};

const EMOJI_LABELS: Record<string, string> = {
  none: 'None',
  minimal: 'Minimal',
  moderate: 'Moderate',
};

const DEFAULT_FORM: WizardFormData = {
  business_name: '',
  business_type: '',
  business_description: '',
  common_questions: '',
  instructions: '',
  tone: 'friendly',
  response_length: 'concise',
  emoji_usage: 'none',
  escalation_triggers: ['human_request', 'unknown_question'],
  escalation_custom: '',
};

export default function QuickSetupWizardDialog({
  open,
  onOpenChange,
  onGenerate,
  onCreate,
}: QuickSetupWizardDialogProps) {
  const [step, setStep] = useState<Step>('business');
  const [form, setForm] = useState<WizardFormData>({ ...DEFAULT_FORM });
  const [generatedName, setGeneratedName] = useState('');
  const [generatedProfile, setGeneratedProfile] = useState<ProfileData | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = useCallback(() => {
    setStep('business');
    setForm({ ...DEFAULT_FORM });
    setGeneratedName('');
    setGeneratedProfile(null);
    setSaving(false);
  }, []);

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) reset();
    onOpenChange(isOpen);
  };

  const update = <K extends keyof WizardFormData>(key: K, value: WizardFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const toggleTrigger = (id: string) => {
    setForm((prev) => ({
      ...prev,
      escalation_triggers: prev.escalation_triggers.includes(id)
        ? prev.escalation_triggers.filter((t) => t !== id)
        : [...prev.escalation_triggers, id],
    }));
  };

  const currentStepIndex = STEPS.indexOf(step as typeof STEPS[number]);

  const canProceed = (): boolean => {
    switch (step) {
      case 'business':
        return !!(form.business_name.trim() && form.business_description.trim());
      case 'questions':
        return !!form.common_questions.trim();
      case 'instructions':
        return true; // optional
      case 'style':
        return true; // has defaults
      case 'escalation':
        return true; // has defaults
      default:
        return false;
    }
  };

  const goNext = () => {
    if (currentStepIndex < STEPS.length - 1) {
      setStep(STEPS[currentStepIndex + 1]);
    }
  };

  const goBack = () => {
    if (step === 'review') {
      setStep('escalation');
      return;
    }
    if (currentStepIndex > 0) {
      setStep(STEPS[currentStepIndex - 1]);
    }
  };

  const handleGenerate = async () => {
    setStep('generating');
    try {
      const result = await onGenerate(form);
      setGeneratedName(result.name);
      setGeneratedProfile(result.profile_data);
      setStep('review');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to generate agent. Please try again.';
      toast.error(msg);
      setStep('escalation');
    }
  };

  const handleCreate = async () => {
    if (!generatedProfile) return;
    setSaving(true);
    try {
      await onCreate({ name: generatedName || 'New Agent', profile_data: generatedProfile });
      toast.success('Agent created successfully');
      handleOpenChange(false);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 402) {
        toast.error('Agent limit reached. Upgrade your plan to add more agents.');
      } else {
        toast.error('Failed to create agent');
      }
      setSaving(false);
    }
  };

  const meta = STEP_META[step];
  const flow = generatedProfile?.response_flow;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {meta.icon}
            {step === 'generating' ? 'Generating Your Agent...' : meta.title}
          </DialogTitle>
        </DialogHeader>

        {/* Progress bar */}
        {step !== 'generating' && step !== 'review' && (
          <div className="flex gap-1">
            {STEPS.map((s, i) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i <= currentStepIndex ? 'bg-primary' : 'bg-muted'
                }`}
              />
            ))}
          </div>
        )}

        {/* ── Step 1: Business ───────────────────── */}
        {step === 'business' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Tell us about your business so the AI knows who it's representing.
            </p>
            <div className="space-y-2">
              <Label htmlFor="biz-name">Business Name *</Label>
              <Input
                id="biz-name"
                placeholder="e.g. Acme Inc."
                value={form.business_name}
                onChange={(e) => update('business_name', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="biz-type">Business Type</Label>
              <Input
                id="biz-type"
                placeholder="e.g. E-commerce, Restaurant, SaaS, Real Estate"
                value={form.business_type}
                onChange={(e) => update('business_type', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="biz-desc">What does your business do? *</Label>
              <Textarea
                id="biz-desc"
                placeholder="Describe your products, services, and who your customers are..."
                value={form.business_description}
                onChange={(e) => update('business_description', e.target.value)}
                rows={3}
              />
            </div>
          </div>
        )}

        {/* ── Step 2: Common Questions ───────────── */}
        {step === 'questions' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              What do your customers typically ask about? This helps us create the right conversation scenarios.
            </p>
            <div className="space-y-2">
              <Label htmlFor="common-q">Common questions or topics *</Label>
              <Textarea
                id="common-q"
                placeholder={"e.g.\n- Pricing and availability\n- How to place an order\n- Shipping times and tracking\n- Return and refund policy\n- Product specifications"}
                value={form.common_questions}
                onChange={(e) => update('common_questions', e.target.value)}
                rows={6}
              />
            </div>
          </div>
        )}

        {/* ── Step 3: Instructions ──────────────── */}
        {step === 'instructions' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Any specific rules or guidelines for your AI? Things it should always do, or never do.
            </p>
            <div className="space-y-2">
              <Label htmlFor="instructions">Instructions (optional)</Label>
              <Textarea
                id="instructions"
                placeholder={"e.g.\n- Always mention our 30-day return policy\n- Never discuss competitor products\n- Collect the customer's email before booking\n- Don't make promises about delivery dates"}
                value={form.instructions}
                onChange={(e) => update('instructions', e.target.value)}
                rows={6}
              />
            </div>
          </div>
        )}

        {/* ── Step 4: Style & Tone ──────────────── */}
        {step === 'style' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              How should your AI communicate with customers?
            </p>
            <div className="space-y-2">
              <Label>Tone</Label>
              <Select value={form.tone} onValueChange={(v) => update('tone', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="professional">Professional — Business-like and polished</SelectItem>
                  <SelectItem value="friendly">Friendly — Warm and approachable</SelectItem>
                  <SelectItem value="casual">Casual — Relaxed and conversational</SelectItem>
                  <SelectItem value="formal">Formal — Highly structured and respectful</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Response Length</Label>
              <Select value={form.response_length} onValueChange={(v) => update('response_length', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="concise">Concise — Short and to the point</SelectItem>
                  <SelectItem value="moderate">Moderate — Balanced detail</SelectItem>
                  <SelectItem value="detailed">Detailed — Thorough explanations</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Emoji Usage</Label>
              <Select value={form.emoji_usage} onValueChange={(v) => update('emoji_usage', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None — No emojis</SelectItem>
                  <SelectItem value="minimal">Minimal — Occasional emojis</SelectItem>
                  <SelectItem value="moderate">Moderate — Regular emoji use</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* ── Step 5: Escalation ────────────────── */}
        {step === 'escalation' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              When should the AI stop responding and hand off to a human?
            </p>
            <div className="space-y-3">
              {ESCALATION_OPTIONS.map((opt) => (
                <label key={opt.id} className="flex items-start gap-3 cursor-pointer">
                  <Checkbox
                    checked={form.escalation_triggers.includes(opt.id)}
                    onCheckedChange={() => toggleTrigger(opt.id)}
                    className="mt-0.5"
                  />
                  <span className="text-sm">{opt.label}</span>
                </label>
              ))}
            </div>
            <div className="space-y-2">
              <Label htmlFor="esc-custom">Other escalation rules (optional)</Label>
              <Textarea
                id="esc-custom"
                placeholder="Any other situations where the AI should hand off to a human..."
                value={form.escalation_custom}
                onChange={(e) => update('escalation_custom', e.target.value)}
                rows={2}
              />
            </div>
          </div>
        )}

        {/* ── Generating ───────────────────────── */}
        {step === 'generating' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <div className="text-center">
              <p className="text-sm font-medium">Creating your AI agent...</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Generating scenarios based on your answers. This may take 10-20 seconds.
              </p>
            </div>
          </div>
        )}

        {/* ── Review ───────────────────────────── */}
        {step === 'review' && generatedProfile && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="agent-name">Agent Name</Label>
              <Input
                id="agent-name"
                value={generatedName}
                onChange={(e) => setGeneratedName(e.target.value)}
                placeholder="Agent name"
              />
            </div>

            <div className="space-y-3 rounded-lg border p-4">
              {(generatedProfile.business_name || generatedProfile.business_type) && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Business</p>
                  <p className="text-sm">
                    {[generatedProfile.business_name, generatedProfile.business_type].filter(Boolean).join(' — ')}
                  </p>
                </div>
              )}

              {flow?.default_style && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Style</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {flow.default_style.tone && (
                      <Badge variant="secondary">{TONE_LABELS[flow.default_style.tone] || flow.default_style.tone}</Badge>
                    )}
                    {flow.default_style.response_length && (
                      <Badge variant="secondary">{LENGTH_LABELS[flow.default_style.response_length] || flow.default_style.response_length}</Badge>
                    )}
                    {flow.default_style.emoji_usage && (
                      <Badge variant="secondary">Emoji: {EMOJI_LABELS[flow.default_style.emoji_usage] || flow.default_style.emoji_usage}</Badge>
                    )}
                  </div>
                </div>
              )}

              {flow && flow.scenarios.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Scenarios ({flow.scenarios.length})
                  </p>
                  <div className="mt-1.5 space-y-1.5">
                    {flow.scenarios.map((s) => (
                      <div key={s.id} className="rounded-md bg-muted/50 px-3 py-2">
                        <p className="text-sm font-medium">{s.label}</p>
                        <p className="text-xs text-muted-foreground">{s.detection_criteria}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              You can fine-tune all settings after creating the agent.
            </p>
          </div>
        )}

        {/* ── Footer buttons ───────────────────── */}
        {step !== 'generating' && (
          <div className="flex justify-between">
            <div>
              {(currentStepIndex > 0 || step === 'review') && (
                <Button variant="outline" onClick={goBack}>
                  <ArrowLeft className="mr-1.5 h-4 w-4" />
                  Back
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              {step !== 'review' && (
                <Button variant="outline" onClick={() => handleOpenChange(false)}>
                  Cancel
                </Button>
              )}
              {step === 'review' ? (
                <Button onClick={handleCreate} disabled={saving}>
                  {saving ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Bot className="mr-1.5 h-4 w-4" />
                  )}
                  Create Agent
                </Button>
              ) : currentStepIndex === STEPS.length - 1 ? (
                <Button onClick={handleGenerate} disabled={!canProceed()}>
                  <Sparkles className="mr-1.5 h-4 w-4" />
                  Generate Agent
                </Button>
              ) : (
                <Button onClick={goNext} disabled={!canProceed()}>
                  Next
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
