-- Remove all demo data seeded by seed_demo_data(), then drop the seed function.
-- Safety: only messages with message_id_normalized LIKE 'demo_%' are demo data.
-- Sessions and contacts are only deleted if they become completely empty afterward.

BEGIN;

-- 1. Identify sessions that have demo messages
CREATE TEMP TABLE _demo_sessions AS
  SELECT DISTINCT session_id
  FROM chat_messages
  WHERE message_id_normalized LIKE 'demo_%';

-- 2. Delete demo messages
DELETE FROM chat_messages
WHERE message_id_normalized LIKE 'demo_%';

-- 3. Find sessions from step 1 that now have ZERO remaining messages (fully demo-only)
CREATE TEMP TABLE _orphan_sessions AS
  SELECT ds.session_id
  FROM _demo_sessions ds
  LEFT JOIN chat_messages cm ON cm.session_id = ds.session_id
  GROUP BY ds.session_id
  HAVING COUNT(cm.id) = 0;

-- 4. Collect contact_ids from orphan sessions before deleting them
CREATE TEMP TABLE _candidate_contacts AS
  SELECT DISTINCT contact_id
  FROM chat_sessions
  WHERE id IN (SELECT session_id FROM _orphan_sessions)
    AND contact_id IS NOT NULL;

-- 5. Delete orphan sessions (cascade will handle conversation_labels, notes, etc.)
DELETE FROM chat_sessions
WHERE id IN (SELECT session_id FROM _orphan_sessions);

-- 6. Delete contacts that now have ZERO remaining sessions (fully demo-only contacts)
DELETE FROM contacts
WHERE id IN (SELECT contact_id FROM _candidate_contacts)
  AND NOT EXISTS (
    SELECT 1 FROM chat_sessions cs WHERE cs.contact_id = contacts.id
  );

-- 7. Drop the seed function — no longer needed
DROP FUNCTION IF EXISTS public.seed_demo_data(UUID, UUID, JSONB, JSONB);

-- Cleanup temp tables
DROP TABLE IF EXISTS _demo_sessions;
DROP TABLE IF EXISTS _orphan_sessions;
DROP TABLE IF EXISTS _candidate_contacts;

COMMIT;
