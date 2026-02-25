import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Bot, Pause, Play } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';

interface AIToggleProps {
  sessionId: string;
  humanTakeover: boolean;
  onUpdate: () => void;
}

export default function AIToggle({ sessionId, humanTakeover, onUpdate }: AIToggleProps) {
  const [loading, setLoading] = useState(false);

  const handlePause = async (minutes?: number) => {
    setLoading(true);
    try {
      await api.post(`/ai/pause/${sessionId}`, {
        duration_minutes: minutes || null,
      });
      onUpdate();
      toast.success(minutes ? `AI paused for ${minutes >= 60 ? `${minutes / 60}h` : `${minutes}min`}` : 'AI paused');
    } catch {
      toast.error('Failed to pause AI');
    } finally {
      setLoading(false);
    }
  };

  const handleResume = async () => {
    setLoading(true);
    try {
      await api.post(`/ai/resume/${sessionId}`);
      onUpdate();
      toast.success('AI resumed');
    } catch {
      toast.error('Failed to resume AI');
    } finally {
      setLoading(false);
    }
  };

  if (humanTakeover) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={handleResume}
        disabled={loading}
        className="gap-1.5 text-xs"
      >
        <Play className="h-3 w-3" />
        Resume AI
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={loading} className="gap-1.5 text-xs">
          <Bot className="h-3 w-3" />
          AI Active
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handlePause()}>
          <Pause className="mr-2 h-3 w-3" />
          Pause indefinitely
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handlePause(30)}>
          <Pause className="mr-2 h-3 w-3" />
          Pause for 30 min
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handlePause(60)}>
          <Pause className="mr-2 h-3 w-3" />
          Pause for 1 hour
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handlePause(1440)}>
          <Pause className="mr-2 h-3 w-3" />
          Pause for 24 hours
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
