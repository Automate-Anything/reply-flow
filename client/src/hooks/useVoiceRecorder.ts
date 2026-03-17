import { useCallback, useEffect, useRef, useState } from 'react';

export type RecorderState = 'idle' | 'recording' | 'paused';

interface UseVoiceRecorderReturn {
  state: RecorderState;
  duration: number;
  analyserNode: AnalyserNode | null;
  audioBlob: Blob | null;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<{ blob: Blob; duration: number }>;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
}

const MAX_DURATION_MS = 15 * 60 * 1000;

export function useVoiceRecorder(
  onAutoStop?: (blob: Blob, duration: number) => void,
): UseVoiceRecorderReturn {
  const [state, setState] = useState<RecorderState>('idle');
  const [duration, setDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const elapsedBeforePauseRef = useRef(0);
  const maxDurationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { cleanup(); };
  }, []);

  const cleanup = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    if (maxDurationTimeoutRef.current) {
      clearTimeout(maxDurationTimeoutRef.current);
      maxDurationTimeoutRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    setAnalyserNode(null);
  }, []);

  const startDurationTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    durationIntervalRef.current = setInterval(() => {
      const elapsed = elapsedBeforePauseRef.current + (Date.now() - startTimeRef.current);
      setDuration(elapsed / 1000);
    }, 100);
  }, []);

  const stopDurationTimer = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    elapsedBeforePauseRef.current += Date.now() - startTimeRef.current;
  }, []);

  const start = useCallback(async () => {
    try {
      setError(null);
      setAudioBlob(null);
      setDuration(0);
      elapsedBeforePauseRef.current = 0;
      chunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      setAnalyserNode(analyser);

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        setAudioBlob(blob);
      };

      recorder.start(100);
      setState('recording');
      startDurationTimer();

      maxDurationTimeoutRef.current = setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          const elapsed = elapsedBeforePauseRef.current + (Date.now() - startTimeRef.current);
          stopDurationTimer();
          // Wait for onstop to fire so the final ondataavailable chunk is captured
          mediaRecorderRef.current.onstop = () => {
            const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
            setState('idle');
            onAutoStop?.(blob, elapsed / 1000);
            cleanup();
          };
          mediaRecorderRef.current.stop();
        }
      }, MAX_DURATION_MS);
    } catch (err: unknown) {
      cleanup();
      setState('idle');
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError') {
          setError('Microphone access required to send voice notes');
        } else if (err.name === 'NotFoundError') {
          setError('No microphone detected');
        } else {
          setError('Failed to start recording');
        }
      } else {
        setError('Failed to start recording');
      }
    }
  }, [cleanup, startDurationTimer, stopDurationTimer, onAutoStop]);

  const stop = useCallback((): Promise<{ blob: Blob; duration: number }> => {
    return new Promise((resolve) => {
      stopDurationTimer();
      const finalDuration = (elapsedBeforePauseRef.current + (Date.now() - startTimeRef.current)) / 1000;

      const cleanupStreams = () => {
        setState('idle');
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
        if (audioContextRef.current) {
          audioContextRef.current.close().catch(() => {});
          audioContextRef.current = null;
        }
        if (maxDurationTimeoutRef.current) {
          clearTimeout(maxDurationTimeoutRef.current);
          maxDurationTimeoutRef.current = null;
        }
        setAnalyserNode(null);
      };

      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.onstop = () => {
          const mimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
          const blob = new Blob(chunksRef.current, { type: mimeType });
          setAudioBlob(blob);
          cleanupStreams();
          resolve({ blob, duration: finalDuration });
        };
        mediaRecorderRef.current.stop();
      } else {
        // Recorder already inactive — resolve with whatever chunks we have
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        cleanupStreams();
        resolve({ blob, duration: finalDuration });
      }
    });
  }, [stopDurationTimer]);

  const pause = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
      stopDurationTimer();
      setState('paused');
    }
  }, [stopDurationTimer]);

  const resume = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume();
      startDurationTimer();
      setState('recording');
    }
  }, [startDurationTimer]);

  const cancel = useCallback(() => {
    cleanup();
    setState('idle');
    setDuration(0);
    setAudioBlob(null);
    elapsedBeforePauseRef.current = 0;
  }, [cleanup]);

  return { state, duration, analyserNode, audioBlob, error, start, stop, pause, resume, cancel };
}
