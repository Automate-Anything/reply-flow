import { Sparkles, Square, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type SuggestionMode = 'generate' | 'complete' | 'rewrite';

interface AISuggestionButtonProps {
  hasText: boolean;
  isStreaming: boolean;
  hasStreamedText: boolean;
  onSuggest: (mode: SuggestionMode) => void;
  onStop: () => void;
  onRegenerate: () => void;
  disabled?: boolean;
}

export function AISuggestionButton({
  hasText,
  isStreaming,
  hasStreamedText,
  onSuggest,
  onStop,
  onRegenerate,
  disabled,
}: AISuggestionButtonProps) {
  // Streaming state — show stop button
  if (isStreaming) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-red-500 hover:text-red-600"
            onClick={onStop}
          >
            <Square className="h-4 w-4 fill-current" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Stop generating</TooltipContent>
      </Tooltip>
    );
  }

  // After streaming — show regenerate button alongside the star
  const regenerateButton = hasStreamedText && !isStreaming ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground hover:text-foreground"
          onClick={onRegenerate}
          disabled={disabled}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Regenerate suggestion</TooltipContent>
    </Tooltip>
  ) : null;

  // No text — click directly generates
  if (!hasText) {
    return (
      <>
        {regenerateButton}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground hover:text-purple-500"
              onClick={() => onSuggest('generate')}
              disabled={disabled}
            >
              <Sparkles className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Generate AI suggestion</TooltipContent>
        </Tooltip>
      </>
    );
  }

  // Has text — show dropdown with Complete / Rewrite
  return (
    <>
      {regenerateButton}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground hover:text-purple-500"
            disabled={disabled}
          >
            <Sparkles className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onSuggest('complete')}>
            Complete — continue from here
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onSuggest('rewrite')}>
            Rewrite — polish my draft
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
