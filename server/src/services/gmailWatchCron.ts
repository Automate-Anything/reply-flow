import { supabaseAdmin } from '../config/supabase.js';
import * as gmail from './gmail.js';

export function startGmailWatchCron() {
  const SIX_HOURS = 6 * 60 * 60 * 1000;

  async function renewAll() {
    try {
      const { data: channels } = await supabaseAdmin
        .from('channels')
        .select('id, email_address, oauth_access_token, oauth_refresh_token')
        .eq('channel_type', 'email')
        .eq('channel_status', 'connected');

      if (!channels?.length) return;

      for (const ch of channels) {
        try {
          const client = gmail.getGmailClient({
            access_token: ch.oauth_access_token!,
            refresh_token: ch.oauth_refresh_token!,
          }, ch.id);
          const result = await gmail.registerWatch(client);
          await supabaseAdmin
            .from('channels')
            .update({
              gmail_history_id: result.historyId,
              gmail_watch_expiry: new Date(parseInt(result.expiration)).toISOString(),
            })
            .eq('id', ch.id);
          console.log(`[gmail-cron] Renewed watch for ${ch.email_address}`);
        } catch (err) {
          console.error(`[gmail-cron] Failed to renew watch for ${ch.email_address}:`, err);
          if ((err as any)?.code === 401 || (err as any)?.message?.includes('invalid_grant')) {
            await supabaseAdmin
              .from('channels')
              .update({ channel_status: 'disconnected' })
              .eq('id', ch.id);
          }
        }
      }
    } catch (err) {
      console.error('[gmail-cron] Error:', err);
    }
  }

  renewAll();
  setInterval(renewAll, SIX_HOURS);
}
