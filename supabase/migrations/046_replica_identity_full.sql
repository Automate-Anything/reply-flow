-- Supabase Realtime with row-level filters (e.g. company_id=eq.xxx) requires
-- REPLICA IDENTITY FULL on tables so that UPDATE events include all columns
-- in the WAL record. Without this, filtered UPDATE subscriptions are silently dropped.

ALTER TABLE chat_messages REPLICA IDENTITY FULL;
ALTER TABLE chat_sessions REPLICA IDENTITY FULL;
ALTER TABLE conversation_notes REPLICA IDENTITY FULL;
