import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Trash2, Pause, Play, Send } from 'lucide-react';
import type { RecorderState } from '@/hooks/useVoiceRecorder';

const BAR_COUNT = 48;

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
  const animationFrameRef = useRef<number>(0);
  const [bars, setBars] = useState<number[]>(() => Array(BAR_COUNT).fill(0.12));

  const formatDuration = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    if (state !== 'recording' || !analyserNode) return;

    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const bucketSize = Math.floor(bufferLength / BAR_COUNT);

    const update = () => {
      animationFrameRef.current = requestAnimationFrame(update);
      analyserNode.getByteFrequencyData(dataArray);

      const newBars: number[] = [];
      for (let i = 0; i < BAR_COUNT; i++) {
        const start = i * bucketSize;
        const end = start + bucketSize;
        let sum = 0;
        for (let j = start; j < end; j++) {
          sum += dataArray[j];
        }
        const avg = sum / bucketSize / 255;
        newBars.push(Math.max(0.12, avg));
      }
      setBars(newBars);
    };

    update();
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [state, analyserNode]);

  return (
    <div className="flex w-full items-center justify-end gap-3 px-3 py-2">
      <button
        onClick={onDelete}
        className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Trash2 className="h-5 w-5" />
      </button>

      {/* Recording indicator dot */}
      {state === 'recording' && (
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-destructive animate-pulse" />
      )}

      <span className="text-sm font-mono tabular-nums shrink-0">
        {formatDuration(duration)}
      </span>

      <div className="flex h-7 flex-1 max-w-[240px] items-center gap-[1.5px]">
        {bars.map((height, i) => (
          <div
            key={i}
            className="flex-1 rounded-full"
            style={{
              height: `${Math.max(15, Math.round(height * 100))}%`,
              minHeight: 3,
              background: 'color-mix(in srgb, var(--color-primary) 70%, transparent)',
            }}
          />
        ))}
      </div>

      <button
        onClick={state === 'paused' ? onResume : onPause}
        className="shrink-0 rounded-full p-1.5 hover:bg-accent"
      >
        {state === 'paused' ? (
          <Play className="h-5 w-5" />
        ) : (
          <Pause className="h-5 w-5" />
        )}
      </button>

      <Button
        size="icon"
        onClick={onSend}
        className="h-10 w-10 shrink-0 rounded-full"
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
}
