import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Pencil, Trash2 } from 'lucide-react';
import type { GroupCriteria } from '@/types/groups';

interface CriteriaCardProps {
  criteria: GroupCriteria;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
}

export function CriteriaCard({ criteria, onEdit, onDelete, onToggle }: CriteriaCardProps) {
  return (
    <div className="flex items-start justify-between p-4 border rounded-lg">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{criteria.name}</span>
          <Badge variant={criteria.match_type === 'ai' ? 'default' : 'secondary'}>
            {criteria.match_type === 'ai' ? 'AI' : 'Keyword'}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          {criteria.match_type === 'keyword'
            ? `Keywords: ${criteria.keyword_config?.keywords?.join(', ') || 'none'} (${criteria.keyword_config?.operator || 'or'})`
            : criteria.ai_description || 'No description'}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Notifies {criteria.notify_user_ids.length} team member{criteria.notify_user_ids.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="flex items-center gap-2 ml-4">
        <Switch
          checked={criteria.is_enabled}
          onCheckedChange={onToggle}
        />
        <Button variant="ghost" size="icon" onClick={onEdit}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onDelete}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}
