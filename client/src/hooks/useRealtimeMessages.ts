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

    const channel = supabase
      .channel('inbox-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          onNewMessageRef.current?.(payload.new as Message);
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
          onMessageUpdateRef.current?.(payload.new as Partial<Message> & { id: string });
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
          onSessionUpdateRef.current?.(payload.new as Partial<Conversation> & { id: string });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId]);
}
