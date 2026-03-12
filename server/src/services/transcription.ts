import OpenAI from 'openai';
import { env } from '../config/env.js';
import { downloadFromStorage } from './mediaStorage.js';

const openai = env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: env.OPENAI_API_KEY })
  : null;

const MIME_TO_EXT: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'mp4',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
};

/**
 * Transcribes an audio file stored in Supabase Storage using OpenAI Whisper.
 * Returns the transcript text, or null if transcription is unavailable/fails.
 */
export async function transcribeAudio(
  storagePath: string,
  mimeType: string,
): Promise<string | null> {
  if (!openai) {
    console.warn('Transcription skipped: OPENAI_API_KEY not configured');
    return null;
  }

  try {
    const buffer = await downloadFromStorage(storagePath);
    if (!buffer) return null;

    const baseMime = mimeType.split(';')[0].trim();
    const ext = MIME_TO_EXT[baseMime] || MIME_TO_EXT[mimeType] || 'ogg';
    const file = new File([new Uint8Array(buffer)], `audio.${ext}`, { type: mimeType });

    const response = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file,
    });

    return response.text || null;
  } catch (err) {
    console.error('Transcription error:', err instanceof Error ? err.message : err);
    return null;
  }
}
