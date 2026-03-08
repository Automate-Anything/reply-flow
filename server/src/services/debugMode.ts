/**
 * Debug Mode — cached check for the super_admin_debug_mode toggle.
 * Pattern mirrors retrievalSettings.ts with a shorter TTL.
 */

import { supabaseAdmin } from '../config/supabase.js';

const CACHE_TTL_MS = 30_000; // 30 seconds
let cached: boolean | null = null;
let cacheTime = 0;

export function invalidateDebugModeCache(): void {
  cached = null;
  cacheTime = 0;
}

export async function isDebugModeEnabled(): Promise<boolean> {
  const now = Date.now();
  if (cached !== null && now - cacheTime < CACHE_TTL_MS) {
    return cached;
  }

  try {
    const { data } = await supabaseAdmin
      .from('retrieval_settings')
      .select('value')
      .eq('key', 'super_admin_debug_mode')
      .single();

    cached = data?.value === '1';
    cacheTime = now;
    return cached;
  } catch {
    return false;
  }
}
