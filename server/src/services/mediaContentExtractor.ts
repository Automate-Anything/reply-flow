import { downloadFromStorage } from './mediaStorage.js';
import { processDocument } from './documentProcessor.js';
import { transcribeAudio } from './transcription.js';

const MAX_EXTRACTED_TEXT_LENGTH = 30_000;

/**
 * Extracts text content from a stored document for AI context.
 * Reuses the existing document processing pipeline (PDF, DOCX, XLSX, TXT, CSV, etc.).
 * Returns extracted text truncated to a reasonable size, or null on failure.
 */
export async function extractDocumentText(
  storagePath: string,
  mimeType: string,
  filename?: string,
): Promise<string | null> {
  try {
    const buffer = await downloadFromStorage(storagePath);
    if (!buffer) return null;

    const fname = filename || `document.${storagePath.split('.').pop() || 'bin'}`;
    const result = await processDocument(buffer, fname, mimeType);

    if (!result.cleanedText.trim()) return null;

    return result.cleanedText.slice(0, MAX_EXTRACTED_TEXT_LENGTH);
  } catch (err) {
    console.error('Document text extraction error:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Transcribes an audio message and returns the transcript.
 * Thin wrapper around the transcription service for consistency.
 */
export async function extractAudioTranscript(
  storagePath: string,
  mimeType: string,
): Promise<string | null> {
  return transcribeAudio(storagePath, mimeType);
}
