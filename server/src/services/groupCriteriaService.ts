import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '../config/supabase.js';
import { createNotificationsForUsers } from './notificationService.js';
import type { GroupChat, GroupChatMessage, GroupCriteria } from '../types/index.js';

const anthropic = new Anthropic();

// ── Keyword Matching ────────────────────────────────────────

function evaluateKeywordCriteria(
  messageBody: string,
  criteria: GroupCriteria
): boolean {
  const config = criteria.keyword_config;
  if (!config?.keywords?.length) return false;

  const lowerBody = messageBody.toLowerCase();
  const keywords = config.keywords.map((k: string) => k.toLowerCase());

  if (config.operator === 'and') {
    return keywords.every((kw: string) => lowerBody.includes(kw));
  }
  // Default to 'or'
  return keywords.some((kw: string) => lowerBody.includes(kw));
}

// ── AI Matching ─────────────────────────────────────────────

async function evaluateAICriteria(
  messageBody: string,
  criteria: GroupCriteria[]
): Promise<string[]> {
  if (criteria.length === 0) return [];

  const MAX_PER_BATCH = 20;
  const matchedIds: string[] = [];

  for (let i = 0; i < criteria.length; i += MAX_PER_BATCH) {
    const batch = criteria.slice(i, i + MAX_PER_BATCH);
    try {
      const batchResults = await evaluateAIBatch(messageBody, batch);
      matchedIds.push(...batchResults);
    } catch (err) {
      console.error('[group-criteria] AI evaluation failed for batch, skipping:', err);
      // Non-blocking: keyword matches still produce notifications
    }
  }

  return matchedIds;
}

async function evaluateAIBatch(
  messageBody: string,
  criteria: GroupCriteria[]
): Promise<string[]> {
  const criteriaList = criteria
    .map((c, i) => `${i + 1}. [ID: ${c.id}] ${c.ai_description}`)
    .join('\n');

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `You are evaluating a group chat message against a list of criteria. For each criteria, determine if the message matches.

Message:
"${messageBody}"

Criteria:
${criteriaList}

Respond with ONLY a JSON array of the IDs that matched. If none matched, respond with [].
Example: ["id1", "id2"]`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  // Extract JSON array from response
  const match = text.match(/\[.*\]/s);
  if (!match) return [];

  try {
    const ids = JSON.parse(match[0]) as string[];
    // Only return IDs that are actually in our criteria list
    const validIds = new Set(criteria.map((c) => c.id));
    return ids.filter((id) => validIds.has(id));
  } catch {
    console.error('[group-criteria] Failed to parse AI response:', text);
    return [];
  }
}

// ── Main Evaluation Pipeline ────────────────────────────────

export async function evaluateGroupCriteria(
  message: GroupChatMessage,
  group: GroupChat
): Promise<void> {
  // 1. Fetch all applicable criteria (group-specific + global)
  const { data: allCriteria, error } = await supabaseAdmin
    .from('group_criteria')
    .select('*')
    .eq('company_id', group.company_id)
    .eq('is_enabled', true)
    .or(`group_chat_id.eq.${group.id},group_chat_id.is.null`);

  if (error || !allCriteria?.length) return;

  const criteria = allCriteria as GroupCriteria[];
  const keywordCriteria = criteria.filter((c) => c.match_type === 'keyword');
  const aiCriteria = criteria.filter((c) => c.match_type === 'ai');

  // 2. Evaluate keyword criteria locally
  const matchedKeyword = keywordCriteria.filter((c) =>
    evaluateKeywordCriteria(message.message_body!, c)
  );

  // 3. Evaluate AI criteria via Claude
  const matchedAIIds = await evaluateAICriteria(message.message_body!, aiCriteria);
  const matchedAI = aiCriteria.filter((c) => matchedAIIds.includes(c.id));

  // 4. Consolidate matches
  const allMatched = [...matchedKeyword, ...matchedAI];
  if (allMatched.length === 0) return;

  // 5. Collect union of all notify_user_ids
  const userIdSet = new Set<string>();
  for (const c of allMatched) {
    for (const uid of c.notify_user_ids) {
      userIdSet.add(uid);
    }
  }
  const userIds = Array.from(userIdSet);

  // 6. Create consolidated notification
  const criteriaNames = allMatched.map((c) => ({ id: c.id, name: c.name }));
  const notificationData = {
    group_chat_id: group.id,
    group_name: group.group_name,
    group_chat_message_id: message.id,
    message_body: message.message_body,
    sender_phone: message.sender_phone,
    sender_name: message.sender_name,
    matched_criteria: criteriaNames,
  };

  const notificationTitle = `Group alert: ${group.group_name || group.group_jid}`;
  const notificationBody = allMatched.length === 1
    ? `Matched criteria: ${allMatched[0].name}`
    : `Matched ${allMatched.length} criteria: ${allMatched.map((c) => c.name).join(', ')}`;

  await createNotificationsForUsers(
    group.company_id,
    userIds,
    'group_criteria_match',
    notificationTitle,
    notificationBody,
    notificationData
  );

  // 7. Log the match
  // Note: notification_ids are not easily available from createNotificationsForUsers
  // since it doesn't return them. We store an empty array; the link is via metadata.
  await supabaseAdmin.from('group_criteria_matches').insert({
    company_id: group.company_id,
    group_chat_message_id: message.id,
    criteria_ids: allMatched.map((c) => c.id),
    notification_ids: [],
  });
}
