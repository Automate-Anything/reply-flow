import { useCallback, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface VoiceRecordButtonProps {
  onRecordStart: () => Promise<void>;
  onRecordStop: () => void;
  onLock: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

const SWIPE_UP_THRESHOLD = 60;
const SWIPE_HORIZONTAL_TOLERANCE = 30;

export function VoiceRecordButton({
  onRecordStart,
  onRecordStop,
  onLock,
  onCancel,
  disabled,
}: VoiceRecordButtonProps) {
  const [isHolding, setIsHolding] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const isRecordingRef = useRef(false);

  const isTouchDevice = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  const handleTouchStart = useCallback(async (e: React.TouchEvent) => {
    if (disabled) return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    setIsHolding(true);
    isRecordingRef.current = true;
    await onRecordStart();
  }, [disabled, onRecordStart]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!isRecordingRef.current) return;
    setIsHolding(false);

    const touch = e.changedTouches[0];
    const start = touchStartRef.current;

    if (start) {
      const dy = start.y - touch.clientY;
      const dx = Math.abs(touch.clientX - start.x);

      if (dy >= SWIPE_UP_THRESHOLD && dx <= SWIPE_HORIZONTAL_TOLERANCE) {
        onLock();
        isRecordingRef.current = false;
        touchStartRef.current = null;
        return;
      }
    }

    onRecordStop();
    isRecordingRef.current = false;
    touchStartRef.current = null;
  }, [onRecordStop, onLock]);

  const handleTouchCancel = useCallback(() => {
    setIsHolding(false);
    if (isRecordingRef.current) {
      onCancel();
    }
    isRecordingRef.current = false;
    touchStartRef.current = null;
  }, [onCancel]);

  const handleClick = useCallback(async () => {
    if (disabled || isTouchDevice()) return;
    await onRecordStart();
    onLock();
  }, [disabled, onRecordStart, onLock]);

  return (
    <Button
      variant="ghost"
      size="icon"
      className={`h-9 w-9 shrink-0 ${isHolding ? 'bg-destructive/10 text-destructive' : ''}`}
      disabled={disabled}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
    >
      <Mic className="h-4 w-4" />
    </Button>
  );
}
