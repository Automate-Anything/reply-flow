import axios from 'axios';
import { supabaseAdmin } from '../config/supabase.js';

const BUCKET = 'chat-media';

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'mp4a',
  'audio/aac': 'aac',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt',
  'text/csv': 'csv',
};

function getExtension(mimeType: string, filename?: string): string {
  if (filename) {
    const parts = filename.split('.');
    if (parts.length > 1) return parts.pop()!;
  }
  // Strip parameters like "audio/ogg; codecs=opus" → "audio/ogg"
  const baseMime = mimeType.split(';')[0].trim();
  return MIME_TO_EXT[baseMime] || MIME_TO_EXT[mimeType] || 'bin';
}

/**
 * Downloads a media file from Whapi and uploads it to Supabase Storage.
 * Returns the storage path on success, or null on failure.
 */
export async function downloadAndStore(
  whapiLink: string,
  companyId: string,
  channelId: number,
  messageId: string,
  mimeType: string,
  filename?: string,
): Promise<string | null> {
  try {
    // Download from Whapi
    const response = await axios.get(whapiLink, {
      responseType: 'arraybuffer',
      timeout: 60_000,
    });

    const buffer = Buffer.from(response.data);
    const ext = getExtension(mimeType, filename);
    const storagePath = `${companyId}/${channelId}/${messageId}.${ext}`;

    // Upload to Supabase Storage
    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (error) {
      console.error('Supabase storage upload error:', error.message);
      return null;
    }

    return storagePath;
  } catch (err) {
    console.error('Media download/upload error:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Creates a time-limited signed URL for accessing a stored media file.
 */
export async function getSignedUrl(
  storagePath: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error) {
    console.error('Signed URL error:', error.message);
    return null;
  }

  return data.signedUrl;
}

/**
 * Stores an already-downloaded media buffer in Supabase Storage.
 * Returns the storage path on success, or null on failure.
 */
export async function storeBuffer(
  buffer: Buffer,
  companyId: string,
  channelId: number,
  messageId: string,
  mimeType: string,
  filename?: string,
): Promise<string | null> {
  try {
    const ext = getExtension(mimeType, filename);
    const storagePath = `${companyId}/${channelId}/${messageId}.${ext}`;

    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: mimeType,
        upsert: true,
      });

    if (error) {
      console.error('Supabase storage upload error:', error.message);
      return null;
    }

    return storagePath;
  } catch (err) {
    console.error('Buffer store error:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Downloads a stored media file as a Buffer (for AI processing).
 */
export async function downloadFromStorage(storagePath: string): Promise<Buffer | null> {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .download(storagePath);

  if (error) {
    console.error('Storage download error:', error.message);
    return null;
  }

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
