import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TeamMemberMultiSelect } from './TeamMemberMultiSelect';
import type { GroupCriteria } from '@/types/groups';

interface CriteriaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  criteria?: GroupCriteria | null;
  onSave: (values: Partial<GroupCriteria>) => Promise<void>;
}

export function CriteriaDialog({ open, onOpenChange, criteria, onSave }: CriteriaDialogProps) {
  const [name, setName] = useState('');
  const [matchType, setMatchType] = useState<'keyword' | 'ai'>('keyword');
  const [keywords, setKeywords] = useState('');
  const [operator, setOperator] = useState<'and' | 'or'>('or');
  const [aiDescription, setAiDescription] = useState('');
  const [notifyUserIds, setNotifyUserIds] = useState<string[]>([]);
  const [isEnabled, setIsEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (criteria) {
      setName(criteria.name);
      setMatchType(criteria.match_type);
      setKeywords(criteria.keyword_config?.keywords?.join(', ') || '');
      setOperator(criteria.keyword_config?.operator || 'or');
      setAiDescription(criteria.ai_description || '');
      setNotifyUserIds(criteria.notify_user_ids);
      setIsEnabled(criteria.is_enabled);
    } else {
      setName('');
      setMatchType('keyword');
      setKeywords('');
      setOperator('or');
      setAiDescription('');
      setNotifyUserIds([]);
      setIsEnabled(true);
    }
  }, [criteria, open]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        name,
        match_type: matchType,
        keyword_config:
          matchType === 'keyword'
            ? {
                keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
                operator,
              }
            : { keywords: [], operator: 'or' },
        ai_description: matchType === 'ai' ? aiDescription : null,
        notify_user_ids: notifyUserIds,
        is_enabled: isEnabled,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{criteria ? 'Edit Criteria' : 'New Criteria'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div>
            <Label htmlFor="criteria-name">Name</Label>
            <Input
              id="criteria-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Urgent complaints"
            />
          </div>

          <div>
            <Label>Match Type</Label>
            <Select value={matchType} onValueChange={(v) => setMatchType(v as 'keyword' | 'ai')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="keyword">Keyword</SelectItem>
                <SelectItem value="ai">AI</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {matchType === 'keyword' ? (
            <>
              <div>
                <Label htmlFor="keywords">Keywords (comma-separated)</Label>
                <Input
                  id="keywords"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="e.g., urgent, help needed, complaint"
                />
              </div>
              <div>
                <Label>Logic</Label>
                <Select value={operator} onValueChange={(v) => setOperator(v as 'and' | 'or')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="or">Match ANY keyword (OR)</SelectItem>
                    <SelectItem value="and">Match ALL keywords (AND)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : (
            <div>
              <Label htmlFor="ai-desc">AI Description</Label>
              <Textarea
                id="ai-desc"
                value={aiDescription}
                onChange={(e) => setAiDescription(e.target.value)}
                placeholder="Describe what the AI should look for, e.g., 'Someone is complaining about delivery delays'"
                rows={3}
              />
            </div>
          )}

          <div>
            <Label>Notify Team Members</Label>
            <TeamMemberMultiSelect
              value={notifyUserIds}
              onChange={setNotifyUserIds}
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
            <Label>Enabled</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? 'Saving...' : criteria ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
