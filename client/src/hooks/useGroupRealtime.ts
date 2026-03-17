import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/contexts/SessionContext';
import type { GroupChatMessage, GroupCriteriaMatch } from '@/types/groups';

interface UseGroupRealtimeOptions {
  onNewMessage?: (message: GroupChatMessage) => void;
  onNewMatch?: (match: GroupCriteriaMatch) => void;
}

export function useGroupRealtime({ onNewMessage, onNewMatch }: UseGroupRealtimeOptions) {
  const { companyId } = useSession();
  const onNewMessageRef = useRef(onNewMessage);
  const onNewMatchRef = useRef(onNewMatch);

  onNewMessageRef.current = onNewMessage;
  onNewMatchRef.current = onNewMatch;

  useEffect(() => {
    if (!companyId) return;

    let cancelled = false;

    const channel = supabase
      .channel(`groups-realtime-${companyId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'group_chat_messages',
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          if (!cancelled) {
            onNewMessageRef.current?.(payload.new as GroupChatMessage);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'group_criteria_matches',
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          if (!cancelled) {
            onNewMatchRef.current?.(payload.new as GroupCriteriaMatch);
          }
        }
      )
      .subscribe((status, err) => {
        if (cancelled) return;
        if (status === 'SUBSCRIBED') {
          console.log('[groups-realtime] connected');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[groups-realtime] channel error:', err);
        }
      });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [companyId]);
}
