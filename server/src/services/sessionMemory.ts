/**
 * Session Memory Service
 *
 * When a session ends, extracts key memories (preferences, facts, decisions,
 * issues, summary) via Claude and stores them with vector embeddings for
 * semantic retrieval in future sessions.
 */

import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { isEmbeddingsAvailable, generateEmbeddings, generateEmbedding } from './embeddings.js';

const anthropic = env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  : null;

const EXTRACTION_MODEL = 'claude-haiku-4-5-20251001';
const MIN_MESSAGES_FOR_EXTRACTION = 3;

interface ExtractedMemory {
  type: 'preference' | 'fact' | 'decision' | 'issue' | 'summary';
  content: string;
}

const EXTRACTION_PROMPT = `You are a conversation memory extractor. Given a customer service conversation, extract key information that would be useful for future interactions with this contact.

Extract the following as separate items:
- PREFERENCE: Any stated or implied preferences (language, communication style, how they like to be addressed, preferred times, etc.)
- FACT: Key facts about the contact (their role, company, needs, use case, location, etc.)
- DECISION: Agreements made, commitments, prices quoted, next steps promised
- ISSUE: Unresolved problems, complaints, or concerns that weren't fully addressed
- SUMMARY: A 1-2 sentence summary of what this conversation was about and how it concluded

Rules:
- Only include items clearly supported by the conversation. Don't guess.
- Keep each item concise (1-2 sentences max).
- If a category has no relevant items, skip it.
- Always include exactly one SUMMARY item.

Respond with a JSON array only, no other text:
[{"type": "preference", "content": "..."}, {"type": "summary", "content": "..."}]`;

/**
 * Extracts and stores memories from an ended session.
 * Designed to be called async (fire-and-forget) — never throws.
 */
export async function extractSessionMemories(
  sessionId: string,
  companyId: string
): Promise<void> {
  try {
    // Guard: need both APIs
    if (!anthropic || !isEmbeddingsAvailable()) {
      return;
    }

    // Idempotency: skip if memories already extracted for this session
    const { count } = await supabaseAdmin
      .from('contact_memories')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId);

    if (count && count > 0) {
      return;
    }

    // Load session to get contact_id
    const { data: session } = await supabaseAdmin
      .from('chat_sessions')
      .select('contact_id')
      .eq('id', sessionId)
      .single();

    if (!session?.contact_id) {
      return;
    }

    // Load all messages for this session
    const { data: messages } = await supabaseAdmin
      .from('chat_messages')
      .select('message_body, direction, sender_type, message_ts')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (!messages || messages.length < MIN_MESSAGES_FOR_EXTRACTION) {
      return;
    }

    // Format conversation for Claude
    const conversationText = messages
      .map((m) => {
        const speaker = m.direction === 'inbound' ? 'Customer' : (m.sender_type === 'ai' ? 'AI' : 'Agent');
        return `${speaker}: ${m.message_body || ''}`;
      })
      .join('\n');

    // Extract memories via Claude
    const response = await anthropic.messages.create({
      model: EXTRACTION_MODEL,
      max_tokens: 1000,
      system: EXTRACTION_PROMPT,
      messages: [{ role: 'user', content: conversationText }],
    });

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim()
      .replace(/^```(?:json)?\s*/, '')
      .replace(/\s*```$/, '');

    let memories: ExtractedMemory[];
    try {
      memories = JSON.parse(text);
    } catch {
      console.error('Session memory extraction: invalid JSON from Claude', { sessionId, text });
      return;
    }

    if (!Array.isArray(memories) || memories.length === 0) {
      return;
    }

    // Validate and filter
    const validTypes = ['preference', 'fact', 'decision', 'issue', 'summary'];
    memories = memories.filter(
      (m) => validTypes.includes(m.type) && typeof m.content === 'string' && m.content.trim().length > 0
    );

    if (memories.length === 0) {
      return;
    }

    // Generate embeddings in one batch
    const embeddings = await generateEmbeddings(memories.map((m) => m.content));

    // Store in DB
    const rows = memories.map((m, i) => ({
      contact_id: session.contact_id,
      company_id: companyId,
      session_id: sessionId,
      memory_type: m.type,
      content: m.content.trim(),
      embedding: JSON.stringify(embeddings[i]),
      metadata: {},
    }));

    const { error } = await supabaseAdmin
      .from('contact_memories')
      .insert(rows);

    if (error) {
      console.error('Session memory extraction: DB insert failed', { sessionId, error });
    }
  } catch (err) {
    console.error('Session memory extraction failed:', err);
  }
}

// ── Contact Context Retrieval (Phase 3) ──────────────

export interface ContactMemory {
  memory_type: string;
  content: string;
  similarity: number;
  created_at: string;
}

/**
 * Retrieves relevant memories for a contact via semantic search.
 * Used by the AI to have context about returning contacts.
 * Never throws — returns [] on any failure.
 */
export async function getContactContext(
  contactId: string,
  companyId: string,
  searchQuery: string
): Promise<ContactMemory[]> {
  try {
    if (!isEmbeddingsAvailable()) return [];

    const queryEmbedding = await generateEmbedding(searchQuery);

    const { data, error } = await supabaseAdmin.rpc('search_contact_memories', {
      p_query_embedding: JSON.stringify(queryEmbedding),
      p_contact_id: contactId,
      p_company_id: companyId,
      p_match_count: 10,
    });

    if (error) {
      console.error('Contact memory search failed:', error);
      return [];
    }

    return (data || []).map((row: Record<string, unknown>) => ({
      memory_type: row.memory_type as string,
      content: row.content as string,
      similarity: row.similarity as number,
      created_at: row.created_at as string,
    }));
  } catch (err) {
    console.error('Contact memory retrieval failed:', err);
    return [];
  }
}
