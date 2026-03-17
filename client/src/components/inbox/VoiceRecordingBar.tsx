import { useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Trash2, Pause, Play, Send } from 'lucide-react';
import type { RecorderState } from '@/hooks/useVoiceRecorder';

interface VoiceRecordingBarProps {
  state: RecorderState;
  duration: number;
  analyserNode: AnalyserNode | null;
  onSend: () => void;
  onDelete: () => void;
  onPause: () => void;
  onResume: () => void;
}

export function VoiceRecordingBar({
  state,
  duration,
  analyserNode,
  onSend,
  onDelete,
  onPause,
  onResume,
}: VoiceRecordingBarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>(0);

  const formatDuration = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyserNode) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (state === 'paused') return;
      animationFrameRef.current = requestAnimationFrame(draw);

      analyserNode.getByteFrequencyData(dataArray);

      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      const barWidth = Math.max(2, (width / bufferLength) * 2.5);
      const gap = 1;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * height * 0.8;
        const y = (height - barHeight) / 2;

        ctx.fillStyle = 'hsl(var(--primary))';
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth - gap, barHeight || 2, 1);
        ctx.fill();

        x += barWidth;
        if (x > width) break;
      }
    };

    draw();
  }, [analyserNode, state]);

  useEffect(() => {
    if (state === 'recording' && analyserNode) {
      drawWaveform();
    }
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [state, analyserNode, drawWaveform]);

  return (
    <div className="flex items-center gap-2 px-3 py-2 w-full">
      <Button
        variant="ghost"
        size="icon"
        onClick={onDelete}
        className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </Button>

      <div className="flex-1 flex items-center gap-2 min-w-0">
        <span className="text-sm font-mono text-muted-foreground w-12 shrink-0">
          {formatDuration(duration)}
        </span>
        <canvas
          ref={canvasRef}
          className="flex-1 h-8"
          width={300}
          height={32}
        />
      </div>

      <Button
        variant="ghost"
        size="icon"
        onClick={state === 'paused' ? onResume : onPause}
        className="h-8 w-8 shrink-0"
      >
        {state === 'paused' ? (
          <Play className="h-4 w-4" />
        ) : (
          <Pause className="h-4 w-4" />
        )}
      </Button>

      <Button
        size="icon"
        onClick={onSend}
        className="h-9 w-9 shrink-0"
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
}
