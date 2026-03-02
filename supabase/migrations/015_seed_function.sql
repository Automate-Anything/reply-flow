-- Seed demo data function (callable via supabase rpc)
-- Drop old version first in case signature changed
DROP FUNCTION IF EXISTS public.seed_demo_data(UUID, UUID, BIGINT, JSONB, JSONB);
DROP FUNCTION IF EXISTS public.seed_demo_data(UUID, UUID, JSONB, JSONB);

CREATE OR REPLACE FUNCTION public.seed_demo_data(
  p_company_id UUID,
  p_user_id UUID,
  p_contacts JSONB,
  p_conversations JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  c JSONB;
  conv JSONB;
  msg JSONB;
  v_contact_id UUID;
  v_session_id UUID;
  contact_ids JSONB := '[]'::JSONB;
  session_count INT := 0;
  last_msg JSONB;
  chat_id_val TEXT;
BEGIN
  -- Create contacts
  FOR c IN SELECT * FROM jsonb_array_elements(p_contacts)
  LOOP
    SELECT id INTO v_contact_id
    FROM contacts
    WHERE company_id = p_company_id AND phone_number = c->>'phone';

    IF v_contact_id IS NULL THEN
      v_contact_id := gen_random_uuid();
      INSERT INTO contacts (id, company_id, user_id, created_by, phone_number, first_name, last_name, whatsapp_name, email, company)
      VALUES (
        v_contact_id, p_company_id, p_user_id, p_user_id,
        c->>'phone', c->>'first_name', c->>'last_name', c->>'whatsapp_name',
        c->>'email', c->>'company'
      );
    END IF;

    contact_ids := contact_ids || to_jsonb(v_contact_id);
  END LOOP;

  -- Create conversations and messages
  FOR conv IN SELECT * FROM jsonb_array_elements(p_conversations)
  LOOP
    chat_id_val := replace(conv->>'phone', '+', '') || '@s.whatsapp.net';
    v_contact_id := (contact_ids->>((conv->>'contact_idx')::INT))::UUID;

    -- Find last message
    last_msg := (conv->'messages')->((jsonb_array_length(conv->'messages') - 1));

    -- Check if session exists by company + chat_id
    SELECT id INTO v_session_id
    FROM chat_sessions
    WHERE chat_sessions.company_id = p_company_id AND chat_sessions.chat_id = chat_id_val;

    IF v_session_id IS NULL THEN
      v_session_id := gen_random_uuid();
      INSERT INTO chat_sessions (
        id, company_id, user_id, contact_id, chat_id,
        phone_number, contact_name, status, priority, is_starred, is_archived,
        last_message, last_message_at, last_message_direction, last_message_sender,
        human_takeover, marked_unread
      ) VALUES (
        v_session_id, p_company_id, p_user_id, v_contact_id, chat_id_val,
        conv->>'phone', conv->>'contact_name',
        conv->>'status', conv->>'priority',
        (conv->>'is_starred')::BOOLEAN, FALSE,
        last_msg->>'body', (last_msg->>'time')::TIMESTAMPTZ,
        last_msg->>'direction', last_msg->>'sender',
        FALSE, FALSE
      );
    ELSE
      UPDATE chat_sessions SET
        status = conv->>'status',
        priority = conv->>'priority',
        is_starred = (conv->>'is_starred')::BOOLEAN,
        last_message = last_msg->>'body',
        last_message_at = (last_msg->>'time')::TIMESTAMPTZ,
        last_message_direction = last_msg->>'direction',
        last_message_sender = last_msg->>'sender'
      WHERE id = v_session_id;

      -- Delete old demo messages for this session
      DELETE FROM chat_messages WHERE chat_messages.session_id = v_session_id AND message_id_normalized LIKE 'demo_%';
    END IF;

    -- Insert messages
    FOR msg IN SELECT * FROM jsonb_array_elements(conv->'messages')
    LOOP
      INSERT INTO chat_messages (
        id, session_id, company_id, user_id,
        message_body, message_type, message_id_normalized,
        direction, sender_type, status, read, message_ts, created_at
      ) VALUES (
        gen_random_uuid(), v_session_id, p_company_id, p_user_id,
        msg->>'body', 'text', 'demo_' || substr(gen_random_uuid()::TEXT, 1, 8),
        msg->>'direction', msg->>'sender',
        CASE WHEN msg->>'direction' = 'outbound' THEN 'sent' ELSE 'received' END,
        COALESCE((msg->>'read')::BOOLEAN, TRUE),
        (msg->>'time')::TIMESTAMPTZ, (msg->>'time')::TIMESTAMPTZ
      );
    END LOOP;

    session_count := session_count + 1;
  END LOOP;

  RETURN jsonb_build_object('contacts', jsonb_array_length(p_contacts), 'conversations', session_count);
END;
$$;
