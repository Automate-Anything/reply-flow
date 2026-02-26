import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Archive, ArrowLeft, Loader2, Tag, X } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { Conversation } from '@/hooks/useConversations';
import AIToggle from '@/components/ai/AIToggle';

interface ConversationHeaderProps {
  conversation: Conversation;
  onArchive: () => void;
  onLabelsChange: () => void;
  onBack?: () => void;
}

interface LabelOption {
  id: string;
  name: string;
  color: string;
}

export default function ConversationHeader({
  conversation,
  onArchive,
  onLabelsChange,
  onBack,
}: ConversationHeaderProps) {
  const [allLabels, setAllLabels] = useState<LabelOption[]>([]);

  useEffect(() => {
    api.get('/labels').then(({ data }) => setAllLabels(data.labels || []));
  }, []);

  const assignedIds = new Set(conversation.labels.map((l) => l.id));

  const handleToggleLabel = async (label: LabelOption) => {
    if (assignedIds.has(label.id)) {
      await api.delete(`/labels/assign/${conversation.id}/${label.id}`);
    } else {
      await api.post('/labels/assign', {
        sessionId: conversation.id,
        labelId: label.id,
      });
    }
    onLabelsChange();
  };

  return (
    <div className="flex items-center justify-between border-b px-4 py-3">
      <div className="flex items-center gap-3">
        {onBack && (
          <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div>
          <h2 className="text-sm font-semibold">
            {conversation.contact_name || conversation.phone_number}
          </h2>
          <p className="text-xs text-muted-foreground">{conversation.phone_number}</p>
        </div>
        {conversation.labels.map((label) => (
          <Badge
            key={label.id}
            variant="outline"
            className="text-xs"
            style={{ borderColor: label.color, color: label.color }}
          >
            {label.name}
          </Badge>
        ))}
      </div>

      <div className="flex items-center gap-1">
        <AIToggle
          sessionId={conversation.id}
          humanTakeover={conversation.human_takeover}
          onUpdate={onLabelsChange}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Tag className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {allLabels.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                No labels created yet
              </div>
            ) : (
              allLabels.map((label) => (
                <DropdownMenuItem
                  key={label.id}
                  onClick={() => handleToggleLabel(label)}
                >
                  <span
                    className="mr-2 h-2 w-2 rounded-full"
                    style={{ backgroundColor: label.color }}
                  />
                  {label.name}
                  {assignedIds.has(label.id) && (
                    <X className="ml-auto h-3 w-3 text-muted-foreground" />
                  )}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onArchive}>
          <Archive className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
