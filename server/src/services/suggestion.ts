import Anthropic from '@anthropic-ai/sdk';
import type { Response } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { searchKnowledgeBase } from './embeddings.js';

// ── Types ─────────────────────────────────────────────

export type SuggestionMode = 'generate' | 'complete' | 'rewrite';

interface SuggestionContext {
  messages: Array<{
    direction: string;
    sender_type: string;
    message_body: string;
    created_at: string;
  }>;
  agentProfile: {
    business_name?: string;
    business_type?: string;
    business_description?: string;
    response_flow?: {
      default_style?: {
        tone?: string;
        response_length?: string;
        emoji_usage?: string;
      };
    };
    custom_instructions?: string;
  } | null;
  kbChunks: string[];
  contact: {
    first_name?: string;
    whatsapp_name?: string;
    tags?: string[];
  } | null;
  sessionSummaries: string[];
}

// ── Usage Tracking (in-memory, resets daily) ──────────

const usageMap = new Map<string, { count: number; date: string }>();

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function incrementUsage(userId: string): number {
  const today = getToday();
  const entry = usageMap.get(userId);
  if (!entry || entry.date !== today) {
    usageMap.set(userId, { count: 1, date: today });
    return 1;
  }
  entry.count++;
  return entry.count;
}

export function getUsage(userId: string): number {
  const today = getToday();
  const entry = usageMap.get(userId);
  if (!entry || entry.date !== today) return 0;
  return entry.count;
}

// ── Context Gathering ─────────────────────────────────

export async function gatherSuggestionContext(
  companyId: string,
  sessionId: string,
): Promise<SuggestionContext> {
  // 1. Fetch session to get channel_id and contact_id
  const { data: session } = await supabaseAdmin
    .from('chat_sessions')
    .select('channel_id, contact_id')
    .eq('id', sessionId)
    .eq('company_id', companyId)
    .single();

  if (!session) {
    throw new Error('Session not found');
  }

  // 2. Fetch recent messages (last 20)
  const { data: messages } = await supabaseAdmin
    .from('chat_messages')
    .select('direction, sender_type, message_body, created_at')
    .eq('session_id', sessionId)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(20);

  // 3. Look up channel agent settings -> agent profile
  let agentProfile: SuggestionContext['agentProfile'] = null;
  const { data: channelSettings } = await supabaseAdmin
    .from('channel_agent_settings')
    .select('agent_id, profile_data')
    .eq('channel_id', session.channel_id)
    .eq('company_id', companyId)
    .single();

  if (channelSettings?.agent_id) {
    const { data: agent } = await supabaseAdmin
      .from('ai_agents')
      .select('profile_data')
      .eq('id', channelSettings.agent_id)
      .eq('company_id', companyId)
      .single();
    if (agent) {
      agentProfile = agent.profile_data as SuggestionContext['agentProfile'];
    }
  } else if (channelSettings?.profile_data) {
    agentProfile = channelSettings.profile_data as SuggestionContext['agentProfile'];
  }

  // 4. Search KB if agent has KB attachments
  let kbChunks: string[] = [];
  const latestContactMessage = (messages ?? [])
    .filter((m) => m.direction === 'inbound')
    .at(0);

  if (latestContactMessage?.message_body && agentProfile?.response_flow) {
    const rf = agentProfile.response_flow as Record<string, unknown>;
    const fallbackKb = rf.fallback_kb_attachments as Array<{ kb_id: string }> | undefined;
    const kbMode = rf.agent_kb_mode as string | undefined;

    if (fallbackKb?.length && (kbMode === 'always' || !kbMode)) {
      try {
        const kbIds = fallbackKb.map((k) => k.kb_id);
        const results = await searchKnowledgeBase(
          companyId,
          latestContactMessage.message_body,
          { knowledgeBaseIds: kbIds },
        );
        kbChunks = results.map((r) => r.content);
      } catch {
        // KB search failure is non-fatal — proceed without KB context
      }
    }
  }

  // 5. Fetch contact info
  let contact: SuggestionContext['contact'] = null;
  if (session.contact_id) {
    const { data: contactData } = await supabaseAdmin
      .from('contacts')
      .select('first_name, whatsapp_name, tags')
      .eq('id', session.contact_id)
      .eq('company_id', companyId)
      .single();
    contact = contactData;
  }

  // 6. Fetch past session summaries for this contact
  let sessionSummaries: string[] = [];
  if (session.contact_id) {
    const { data: pastSessions } = await supabaseAdmin
      .from('chat_sessions')
      .select('summary')
      .eq('contact_id', session.contact_id)
      .eq('company_id', companyId)
      .neq('id', sessionId)
      .not('summary', 'is', null)
      .order('created_at', { ascending: false })
      .limit(3);
    sessionSummaries = (pastSessions ?? [])
      .map((s) => s.summary as string)
      .filter(Boolean);
  }

  return {
    messages: (messages ?? []).reverse(), // chronological order
    agentProfile,
    kbChunks,
    contact,
    sessionSummaries,
  };
}

// ── Prompt Builder ────────────────────────────────────

const RESPONSE_MODEL = 'claude-sonnet-4-20250514';

const anthropic = env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  : null;

type ApiMessage = { role: 'user' | 'assistant'; content: string };

function buildSuggestionPrompt(
  context: SuggestionContext,
  existingText: string | undefined,
  mode: SuggestionMode,
): { system: string; messages: ApiMessage[] } {
  const parts: string[] = [];

  parts.push('You are a helpful assistant drafting the NEXT WhatsApp message on behalf of a human agent (the "Agent"). You are ALWAYS writing as the Agent, NEVER as the Contact. Infer the nature of their relationship from the conversation — do not assume who is the buyer or seller.');

  // Agent personality
  if (context.agentProfile) {
    const p = context.agentProfile;
    const style = p.response_flow?.default_style;
    const personalityLines: string[] = [];
    if (p.business_name) personalityLines.push(`Business: ${p.business_name}`);
    if (p.business_type) personalityLines.push(`Type: ${p.business_type}`);
    if (p.business_description) personalityLines.push(`About: ${p.business_description}`);
    if (style?.tone) personalityLines.push(`Tone: ${style.tone}`);
    if (style?.response_length) personalityLines.push(`Length: ${style.response_length}`);
    if (style?.emoji_usage) personalityLines.push(`Emoji usage: ${style.emoji_usage}`);
    if (personalityLines.length > 0) {
      parts.push('\n## Agent Profile\n' + personalityLines.join('\n'));
    }
    if (p.custom_instructions) {
      parts.push('\n## Custom Instructions\n' + p.custom_instructions);
    }
  }

  // KB context
  if (context.kbChunks.length > 0) {
    parts.push(
      '\n## Knowledge Base\nUse the following information to inform your response:\n' +
        context.kbChunks.join('\n\n'),
    );
  }

  // Contact context
  if (context.contact) {
    const c = context.contact;
    // Only use first_name if it was manually edited (differs from whatsapp_name = auto-set)
    const isManuallyNamed =
      c.first_name && (!c.whatsapp_name || c.first_name !== c.whatsapp_name);
    const firstName = isManuallyNamed
      ? c.first_name!.trim().split(/\s+/)[0] // first word only
      : null;
    const contactLines: string[] = [];
    if (firstName) contactLines.push(`First name (manually set): ${firstName}`);
    if (c.tags?.length) contactLines.push(`Tags: ${c.tags.join(', ')}`);
    if (contactLines.length > 0) parts.push('\n## Contact\n' + contactLines.join('\n'));
  }

  // Session summaries
  if (context.sessionSummaries.length > 0) {
    parts.push(
      '\n## Past Interactions\n' +
        context.sessionSummaries.map((s, i) => `Session ${i + 1}: ${s}`).join('\n'),
    );
  }

  // Check if last message was more than 24 hours ago (greeting is appropriate after a gap)
  const lastConversationMsg = context.messages.at(-1);
  const hoursSinceLastMsg = lastConversationMsg
    ? (Date.now() - new Date(lastConversationMsg.created_at).getTime()) / 36e5
    : Infinity;
  const greetingAppropriate = hoursSinceLastMsg > 24;

  // Derive agent's typical message length from their outbound messages
  const agentMessages = context.messages
    .filter((m) => m.direction === 'outbound' && m.message_body)
    .map((m) => m.message_body.trim().split(/\s+/).length);
  const avgAgentWords =
    agentMessages.length > 0
      ? Math.round(agentMessages.reduce((a, b) => a + b, 0) / agentMessages.length)
      : null;

  // Guardrails
  const lengthRule =
    avgAgentWords !== null
      ? `- Match the Agent's message style: their recent messages average ~${avgAgentWords} word${avgAgentWords === 1 ? '' : 's'}. Be similarly brief or detailed.`
      : '- Default to short, direct messages unless the topic requires more detail.';

  parts.push(`
## Rules
- Write ONLY the message text. No greetings like "Dear Customer" unless it fits the tone.
- Do not include meta-commentary like "Here's a draft:" — just the message itself.
- Match the language the contact is using.
- Keep it natural for WhatsApp — not overly formal unless the agent profile says so.
${lengthRule}
- Never pad the message with unnecessary words. If the Agent writes short replies, you write short replies.
- Only use the contact's first name if it appears in the Contact section above AND this is the very first message of the conversation. Never use their name mid-conversation. If no manually-set first name is provided, never reference their name at all.
- ${greetingAppropriate ? 'A greeting (hey/hi/hello) is appropriate since more than 24 hours have passed since the last message.' : 'Do NOT start with a greeting (hey, hi, hello) — this is an ongoing conversation.'}
- Do NOT make assumptions about facts not established in the conversation (e.g. availability, preferences, pricing). If something is unknown, ask — don't invent it.`);

  const system = parts.join('\n');

  // Build alternating user/assistant messages so Claude is structurally *inside*
  // the conversation rather than observing it as a transcript.
  // - inbound  → role: 'user'      (the other person)
  // - outbound (human) → role: 'assistant'  (you)
  // - outbound (ai)    → role: 'assistant', prefixed with "[Auto-reply]"
  // Consecutive messages from the same side are merged into one turn.
  type Group = { role: 'user' | 'assistant'; lines: string[] };
  const groups: Group[] = [];
  for (const m of context.messages) {
    const role: 'user' | 'assistant' = m.direction === 'inbound' ? 'user' : 'assistant';
    const prefix = m.sender_type === 'ai' ? '[Auto-reply] ' : '';
    const body = prefix + (m.message_body || '[media]');
    const last = groups.at(-1);
    if (last?.role === role) {
      last.lines.push(body);
    } else {
      groups.push({ role, lines: [body] });
    }
  }

  const messages: ApiMessage[] = groups.map((g) => ({
    role: g.role,
    content: g.lines.join('\n'),
  }));

  // Anthropic requires the first message to be 'user'
  if (messages[0]?.role === 'assistant') {
    messages.unshift({ role: 'user', content: '[Conversation started by you]' });
  }

  // Build the final instruction and attach it as a user turn
  const lastSender = context.messages.at(-1)?.direction === 'inbound' ? 'contact' : 'agent';
  let instruction: string;
  switch (mode) {
    case 'generate':
      if (lastSender === 'contact') {
        instruction = 'Write your next WhatsApp reply to their last message. Output only the message text, nothing else.';
      } else {
        instruction = "They haven't replied yet. Write a natural follow-up message. Output only the message text, nothing else.";
      }
      break;
    case 'complete':
      instruction = `You started typing: "${existingText}". Continue from where you left off. Output ONLY the continuation text, nothing else.`;
      break;
    case 'rewrite':
      instruction = `You drafted: "${existingText}". Write a polished, complete version of what you want to say. Output only the message text, nothing else.`;
      break;
  }

  // Append instruction to last user turn if it's already 'user', otherwise add new user turn
  const lastApiMsg = messages.at(-1);
  if (lastApiMsg?.role === 'user') {
    lastApiMsg.content += `\n\n${instruction}`;
  } else {
    messages.push({ role: 'user', content: instruction });
  }

  return { system, messages };
}

// ── Streaming ─────────────────────────────────────────

export async function streamSuggestion(
  companyId: string,
  sessionId: string,
  userId: string,
  existingText: string | undefined,
  mode: SuggestionMode,
  res: Response,
): Promise<void> {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!anthropic) {
    res.write(`data: ${JSON.stringify({ error: 'AI suggestions are not configured (missing API key)' })}\n\n`);
    res.end();
    return;
  }

  try {
    const context = await gatherSuggestionContext(companyId, sessionId);
    const { system, messages } = buildSuggestionPrompt(context, existingText, mode);

    // Determine max tokens based on response length setting
    const responseLength = context.agentProfile?.response_flow?.default_style?.response_length;
    let maxTokens = 500;
    if (responseLength === 'concise') maxTokens = 250;
    if (responseLength === 'detailed') maxTokens = 800;

    const stream = anthropic.messages.stream({
      model: RESPONSE_MODEL,
      max_tokens: maxTokens,
      system,
      messages,
    });

    // Handle client disconnect
    const onClose = () => {
      stream.abort();
    };
    res.on('close', onClose);

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ token: event.delta.text })}\n\n`);
      }
    }

    // Clean up close listener now that streaming is done
    res.off('close', onClose);

    // Increment usage counter
    const suggestionsToday = incrementUsage(userId);

    // Send done event
    res.write(`data: ${JSON.stringify({ done: true, suggestionsToday })}\n\n`);
    res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate suggestion';
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.end();
  }
}
