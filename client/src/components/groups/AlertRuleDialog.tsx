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
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, X } from 'lucide-react';
import { TeamMemberMultiSelect } from './TeamMemberMultiSelect';
import type { AlertRule, GroupChat } from '@/types/groups';

interface AlertRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: AlertRule | null;
  groups: GroupChat[];
  onSave: (values: {
    name: string;
    match_type: 'keyword' | 'ai';
    keyword_config?: { keywords: string[]; operator: 'and' | 'or' };
    ai_description?: string;
    notify_user_ids: string[];
    scope: string[] | null;
  }) => Promise<void>;
}

export function AlertRuleDialog({
  open,
  onOpenChange,
  rule,
  groups,
  onSave,
}: AlertRuleDialogProps) {
  const [name, setName] = useState('');
  const [matchType, setMatchType] = useState<'keyword' | 'ai'>('keyword');
  const [keywords, setKeywords] = useState('');
  const [operator, setOperator] = useState<'and' | 'or'>('or');
  const [aiDescription, setAiDescription] = useState('');
  const [notifyUserIds, setNotifyUserIds] = useState<string[]>([]);
  const [scopeType, setScopeType] = useState<'all' | 'specific'>('all');
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (rule) {
        setName(rule.name);
        setMatchType(rule.match_type);
        setKeywords(rule.keyword_config?.keywords?.join(', ') || '');
        setOperator(rule.keyword_config?.operator || 'or');
        setAiDescription(rule.ai_description || '');
        setNotifyUserIds(rule.notify_user_ids || []);
        setScopeType(rule.scope === null ? 'all' : 'specific');
        setSelectedGroupIds(rule.scope || []);
      } else {
        setName('');
        setMatchType('keyword');
        setKeywords('');
        setOperator('or');
        setAiDescription('');
        setNotifyUserIds([]);
        setScopeType('all');
        setSelectedGroupIds([]);
      }
    }
  }, [open, rule]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        name,
        match_type: matchType,
        keyword_config:
          matchType === 'keyword'
            ? {
                keywords: keywords
                  .split(',')
                  .map((k) => k.trim())
                  .filter(Boolean),
                operator,
              }
            : undefined,
        ai_description: matchType === 'ai' ? aiDescription : undefined,
        notify_user_ids: notifyUserIds,
        scope: scopeType === 'all' ? null : selectedGroupIds,
      });
    } finally {
      setSaving(false);
    }
  };

  const monitoredGroups = groups.filter((g) => g.monitoring_enabled);
  const canSave = name.trim() && (matchType === 'ai' ? aiDescription.trim() : keywords.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule ? 'Edit Alert Rule' : 'New Alert Rule'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Rule Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Competitor mentions"
            />
          </div>

          <div className="space-y-2">
            <Label>Match Type</Label>
            <Select
              value={matchType}
              onValueChange={(v) => setMatchType(v as 'keyword' | 'ai')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="keyword">Keyword Match</SelectItem>
                <SelectItem value="ai">AI Match</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {matchType === 'keyword' && (
            <>
              <div className="space-y-2">
                <Label>Keywords (comma-separated)</Label>
                <Input
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="e.g., pricing, discount, competitor"
                />
              </div>
              <div className="space-y-2">
                <Label>Operator</Label>
                <Select
                  value={operator}
                  onValueChange={(v) => setOperator(v as 'and' | 'or')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="or">ANY keyword (OR)</SelectItem>
                    <SelectItem value="and">ALL keywords (AND)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {matchType === 'ai' && (
            <div className="space-y-2">
              <Label>Description (what should this rule detect?)</Label>
              <Textarea
                value={aiDescription}
                onChange={(e) => setAiDescription(e.target.value)}
                placeholder="e.g., Someone asking about pricing or requesting a discount"
                rows={3}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>Apply to</Label>
            <Select
              value={scopeType}
              onValueChange={(v) => setScopeType(v as 'all' | 'specific')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All monitored groups</SelectItem>
                <SelectItem value="specific">Specific groups</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {scopeType === 'specific' && (
            <div className="space-y-2">
              <Label>Select groups</Label>
              <div className="border rounded-md max-h-40 overflow-y-auto p-2 space-y-1">
                {monitoredGroups.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-2">
                    No monitored groups. Enable monitoring on a group first.
                  </p>
                ) : (
                  monitoredGroups.map((g) => (
                    <label
                      key={g.id}
                      className="flex items-center gap-2 p-1.5 rounded hover:bg-accent cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedGroupIds.includes(g.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedGroupIds((prev) => [...prev, g.id]);
                          } else {
                            setSelectedGroupIds((prev) =>
                              prev.filter((id) => id !== g.id)
                            );
                          }
                        }}
                      />
                      <span className="text-sm">
                        {g.group_name || g.group_jid}
                      </span>
                    </label>
                  ))
                )}
              </div>
              {selectedGroupIds.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {selectedGroupIds.map((id) => {
                    const g = groups.find((gr) => gr.id === id);
                    return (
                      <Badge key={id} variant="secondary" className="gap-1">
                        {g?.group_name || g?.group_jid || id}
                        <button
                          onClick={() =>
                            setSelectedGroupIds((prev) =>
                              prev.filter((gid) => gid !== id)
                            )
                          }
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>Notify team members</Label>
            <TeamMemberMultiSelect
              value={notifyUserIds}
              onChange={setNotifyUserIds}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {rule ? 'Save Changes' : 'Create Rule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
