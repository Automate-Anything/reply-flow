import axios from 'axios';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';

const BUCKET = 'profile-pictures';

/**
 * Downloads an image from a CDN URL and uploads it to the public
 * profile-pictures bucket in Supabase Storage.
 *
 * Returns the full public URL on success, or null on failure.
 */
export async function cacheProfilePicture(
  cdnUrl: string,
  storagePath: string,
): Promise<string | null> {
  try {
    const response = await axios.get(cdnUrl, {
      responseType: 'arraybuffer',
      timeout: 15_000,
    });

    const buffer = Buffer.from(response.data);

    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (error) {
      console.error('Profile picture upload error:', error.message);
      return null;
    }

    return `${env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;
  } catch (err) {
    console.error('Profile picture cache error:', err instanceof Error ? err.message : err);
    return null;
  }
}
