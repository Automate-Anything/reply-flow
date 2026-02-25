import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/contexts/SessionContext';
import type { Message } from './useMessages';
import type { Conversation } from './useConversations';

interface UseRealtimeOptions {
  onNewMessage?: (message: Message) => void;
  onSessionUpdate?: (session: Partial<Conversation> & { id: string }) => void;
}

export function useRealtimeMessages({ onNewMessage, onSessionUpdate }: UseRealtimeOptions) {
  const { userId } = useSession();

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel('inbox-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          onNewMessage?.(payload.new as Message);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chat_sessions',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          onSessionUpdate?.(payload.new as Partial<Conversation> & { id: string });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, onNewMessage, onSessionUpdate]);
}
