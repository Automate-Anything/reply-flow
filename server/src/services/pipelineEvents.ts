/**
 * Pipeline Events — types and SSE helpers for streaming KB processing progress.
 */

import type { Response } from 'express';

export interface PipelineEvent {
  step: string;
  status: 'started' | 'completed' | 'error';
  data?: Record<string, unknown>;
  error?: string;
  timestamp: number;
}

export type PipelineProgressCallback = (event: PipelineEvent) => void;

/**
 * Write a single SSE event to the response stream.
 */
export function sseWrite(res: Response, event: PipelineEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Emit a 'started' event.
 */
export function emitStarted(
  onProgress: PipelineProgressCallback | undefined,
  step: string,
  data?: Record<string, unknown>,
): void {
  onProgress?.({ step, status: 'started', data, timestamp: Date.now() });
}

/**
 * Emit a 'completed' event.
 */
export function emitCompleted(
  onProgress: PipelineProgressCallback | undefined,
  step: string,
  data?: Record<string, unknown>,
): void {
  onProgress?.({ step, status: 'completed', data, timestamp: Date.now() });
}

/**
 * Emit an 'error' event.
 */
export function emitError(
  onProgress: PipelineProgressCallback | undefined,
  step: string,
  error: string,
): void {
  onProgress?.({ step, status: 'error', error, timestamp: Date.now() });
}
