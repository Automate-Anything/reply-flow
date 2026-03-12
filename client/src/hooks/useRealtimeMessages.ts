import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/contexts/SessionContext';
import type { Message } from './useMessages';
import type { Conversation } from './useConversations';

interface UseRealtimeOptions {
  onNewMessage?: (message: Message) => void;
  onMessageUpdate?: (message: Partial<Message> & { id: string }) => void;
  onSessionUpdate?: (session: Partial<Conversation> & { id: string }) => void;
}

export function useRealtimeMessages({ onNewMessage, onMessageUpdate, onSessionUpdate }: UseRealtimeOptions) {
  const { companyId } = useSession();
  const onNewMessageRef = useRef(onNewMessage);
  const onMessageUpdateRef = useRef(onMessageUpdate);
  const onSessionUpdateRef = useRef(onSessionUpdate);

  onNewMessageRef.current = onNewMessage;
  onMessageUpdateRef.current = onMessageUpdate;
  onSessionUpdateRef.current = onSessionUpdate;

  useEffect(() => {
    if (!companyId) return;

    let cancelled = false;

    const channel = supabase
      .channel(`inbox-realtime-${companyId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          if (!cancelled) {
            onNewMessageRef.current?.(payload.new as Message);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chat_messages',
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          if (!cancelled) {
            onMessageUpdateRef.current?.(payload.new as Partial<Message> & { id: string });
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chat_sessions',
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          if (!cancelled) {
            onSessionUpdateRef.current?.(payload.new as Partial<Conversation> & { id: string });
          }
        }
      )
      .subscribe((status, err) => {
        if (cancelled) return;
        if (status === 'SUBSCRIBED') {
          console.log('[realtime] connected');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[realtime] channel error, will auto-retry:', err);
        } else if (status === 'TIMED_OUT') {
          console.warn('[realtime] subscription timed out, retrying...');
        } else if (status === 'CLOSED') {
          console.log('[realtime] channel closed');
        }
      });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [companyId]);
}
