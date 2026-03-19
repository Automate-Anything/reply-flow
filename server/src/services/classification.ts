import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { createNotificationsForUsers } from './notificationService.js';
import type {
  ClassificationSuggestion,
  ClassificationSuggestions,
  ClassificationSuggestionItem,
  PartialAccept,
} from '../types/index.js';

const anthropic = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;
const CLASSIFICATION_MODEL = 'claude-haiku-4-5-20251001';
const CONFIDENCE_THRESHOLD = 0.3;
const MAX_LABELS = 5;
const MAX_MESSAGES = 50;
const DEDUP_WINDOW_SECONDS = 60;

// ── Tool Definition ──────────────────────────────────────────

const CLASSIFY_TOOL: Anthropic.Tool = {
  name: 'classify_conversation',
  description:
    'Classify a customer conversation by assigning labels, priority, status, contact tags, and contact list membership.',
  input_schema: {
    type: 'object' as const,
    properties: {
      labels: {
        type: 'array',
        description: 'Array of label classifications with confidence scores.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Label ID from available options.' },
            confidence: { type: 'number', description: 'Confidence score between 0.0 and 1.0.' },
          },
          required: ['id', 'confidence'],
        },
      },
      priority: {
        type: 'object',
        description: 'Priority classification with confidence score.',
        properties: {
          id: { type: 'string', description: 'Priority ID from available options.' },
          confidence: { type: 'number', description: 'Confidence score between 0.0 and 1.0.' },
        },
        required: ['id', 'confidence'],
      },
      status: {
        type: 'object',
        description: 'Status classification with confidence score.',
        properties: {
          id: { type: 'string', description: 'Status ID from available options.' },
          confidence: { type: 'number', description: 'Confidence score between 0.0 and 1.0.' },
        },
        required: ['id', 'confidence'],
      },
      contact_tags: {
        type: 'array',
        description: 'Array of contact tag classifications with confidence scores.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Contact tag ID from available options.' },
            confidence: { type: 'number', description: 'Confidence score between 0.0 and 1.0.' },
          },
          required: ['id', 'confidence'],
        },
      },
      contact_lists: {
        type: 'array',
        description: 'Array of contact list classifications with confidence scores.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Contact list ID from available options.' },
            confidence: { type: 'number', description: 'Confidence score between 0.0 and 1.0.' },
          },
          required: ['id', 'confidence'],
        },
      },
      reasoning: {
        type: 'string',
        description: 'Brief explanation of the classification decisions made.',
      },
    },
    required: ['reasoning'],
  },
};

// ── Entity Types ─────────────────────────────────────────────

interface EntityRecord {
  id: string;
  name: string;
  [key: string]: unknown;
}

interface AvailableEntities {
  labels: EntityRecord[];
  priorities: EntityRecord[];
  statuses: EntityRecord[];
  contact_tags: EntityRecord[];
  contact_lists: EntityRecord[];
}

// ── fetchAvailableEntities ───────────────────────────────────

async function fetchAvailableEntities(companyId: string): Promise<AvailableEntities> {
  const [labelsRes, prioritiesRes, statusesRes, contactTagsRes, contactListsRes] =
    await Promise.all([
      supabaseAdmin
        .from('labels')
        .select('id, name')
        .eq('company_id', companyId)
        .in('visibility', ['company', 'both'])
        .limit(50),
      supabaseAdmin
        .from('conversation_priorities')
        .select('id, name, is_default')
        .eq('company_id', companyId)
        .eq('is_deleted', false),
      supabaseAdmin
        .from('conversation_statuses')
        .select('id, name, is_default')
        .eq('company_id', companyId)
        .eq('is_deleted', false),
      supabaseAdmin
        .from('contact_tags')
        .select('id, name')
        .eq('company_id', companyId)
        .eq('is_deleted', false),
      supabaseAdmin
        .from('contact_lists')
        .select('id, name')
        .eq('company_id', companyId)
        .eq('is_deleted', false),
    ]);

  return {
    labels: (labelsRes.data ?? []) as EntityRecord[],
    priorities: (prioritiesRes.data ?? []) as EntityRecord[],
    statuses: (statusesRes.data ?? []) as EntityRecord[],
    contact_tags: (contactTagsRes.data ?? []) as EntityRecord[],
    contact_lists: (contactListsRes.data ?? []) as EntityRecord[],
  };
}

// ── Structured Rules → Text ──────────────────────────────────

interface StructuredRule {
  condition: { type: 'keyword' | 'contact_tag' | 'sentiment'; value: string };
  actions: Array<{ type: 'add_label' | 'set_priority' | 'set_status' | 'add_contact_tag' | 'add_to_contact_list'; value: string; label?: string }>;
}

function structuredRulesToText(rules: StructuredRule[]): string {
  if (!rules || rules.length === 0) return '';

  return rules.map((rule) => {
    const conditionText =
      rule.condition.type === 'keyword' ? `the message contains "${rule.condition.value}"` :
      rule.condition.type === 'contact_tag' ? `the contact has the tag "${rule.condition.value}"` :
      rule.condition.type === 'sentiment' ? `the conversation sentiment is ${rule.condition.value}` :
      `condition: ${rule.condition.value}`;

    const actionTexts = rule.actions.map((a) => {
      const name = a.label ?? a.value;
      switch (a.type) {
        case 'add_label': return `add the label "${name}"`;
        case 'set_priority': return `set priority to "${name}"`;
        case 'set_status': return `set status to "${name}"`;
        case 'add_contact_tag': return `add the contact tag "${name}"`;
        case 'add_to_contact_list': return `add to the contact list "${name}"`;
        default: return `apply ${a.type}: "${name}"`;
      }
    });

    return `If ${conditionText}, then ${actionTexts.join(' and ')}.`;
  }).join('\n');
}

// ── buildClassificationPrompt ────────────────────────────────

async function buildClassificationPrompt(
  sessionId: string,
  companyId: string,
  contactId: string,
  rules: string,
  structuredRules: StructuredRule[],
  entities: AvailableEntities
): Promise<string> {
  const parts: string[] = [];

  // Structured rules (converted to text)
  const structuredText = structuredRulesToText(structuredRules);

  // Combine structured + custom rules
  const allRules = [structuredText, rules].filter(Boolean).join('\n\n');
  if (allRules.trim()) {
    parts.push(`## Classification Rules\n${allRules.trim()}`);
  }

  // Contact info
  const { data: contact } = await supabaseAdmin
    .from('contacts')
    .select('first_name, last_name, phone_number, email, company, tags')
    .eq('id', contactId)
    .eq('company_id', companyId)
    .single();

  if (contact) {
    const contactLines: string[] = [];
    if (contact.first_name || contact.last_name) {
      contactLines.push(`Name: ${[contact.first_name, contact.last_name].filter(Boolean).join(' ')}`);
    }
    if (contact.phone_number) contactLines.push(`Phone: ${contact.phone_number}`);
    if (contact.email) contactLines.push(`Email: ${contact.email}`);
    if (contact.company) contactLines.push(`Company: ${contact.company}`);
    if (contact.tags && contact.tags.length > 0) {
      contactLines.push(`Tags: ${contact.tags.join(', ')}`);
    }
    if (contactLines.length > 0) {
      parts.push(`## Contact Information\n${contactLines.join('\n')}`);
    }
  }

  // Contact history — last 5 past sessions
  const { data: pastSessions } = await supabaseAdmin
    .from('chat_sessions')
    .select('id, last_message, status, conversation_labels(labels(name))')
    .eq('contact_id', contactId)
    .eq('company_id', companyId)
    .neq('id', sessionId)
    .order('created_at', { ascending: false })
    .limit(5);

  if (pastSessions && pastSessions.length > 0) {
    const historyLines = pastSessions.map((s: Record<string, unknown>, i: number) => {
      const labelNames = Array.isArray(s.conversation_labels)
        ? (s.conversation_labels as Array<{ labels: { name: string } | null }>)
            .map((cl) => cl.labels?.name)
            .filter(Boolean)
            .join(', ')
        : '';
      return `${i + 1}. Status: ${s.status ?? 'unknown'} | Labels: ${labelNames || 'none'} | Last message: ${s.last_message ?? '(none)'}`;
    });
    parts.push(`## Past Conversation History\n${historyLines.join('\n')}`);
  }

  // Current conversation messages
  const { data: messages } = await supabaseAdmin
    .from('chat_messages')
    .select('direction, sender_type, message_body, message_ts')
    .eq('session_id', sessionId)
    .eq('company_id', companyId)
    .order('message_ts', { ascending: true })
    .limit(MAX_MESSAGES);

  if (messages && messages.length > 0) {
    const msgLines = messages.map((m: Record<string, unknown>) => {
      const role =
        m.sender_type === 'contact'
          ? 'Customer'
          : m.sender_type === 'ai'
          ? 'AI'
          : 'Agent';
      return `${role}: ${m.message_body ?? '(media)'}`;
    });
    parts.push(`## Current Conversation\n${msgLines.join('\n')}`);
  }

  // Available classification options
  const optionSections: string[] = [];

  if (entities.labels.length > 0) {
    optionSections.push(
      `Labels: ${JSON.stringify(entities.labels.map((l) => ({ id: l.id, name: l.name })))}`
    );
  }
  if (entities.priorities.length > 0) {
    optionSections.push(
      `Priorities: ${JSON.stringify(entities.priorities.map((p) => ({ id: p.id, name: p.name })))}`
    );
  }
  if (entities.statuses.length > 0) {
    optionSections.push(
      `Statuses: ${JSON.stringify(entities.statuses.map((s) => ({ id: s.id, name: s.name })))}`
    );
  }
  if (entities.contact_tags.length > 0) {
    optionSections.push(
      `Contact Tags: ${JSON.stringify(entities.contact_tags.map((t) => ({ id: t.id, name: t.name })))}`
    );
  }
  if (entities.contact_lists.length > 0) {
    optionSections.push(
      `Contact Lists: ${JSON.stringify(entities.contact_lists.map((l) => ({ id: l.id, name: l.name })))}`
    );
  }

  if (optionSections.length > 0) {
    parts.push(`## Available Classification Options\n${optionSections.join('\n')}`);
  }

  return parts.join('\n\n');
}

// ── validateAndFilter ────────────────────────────────────────

function validateAndFilter(
  raw: Record<string, unknown>,
  entities: AvailableEntities
): ClassificationSuggestions {
  // Build a map from entity ID → name for enrichment
  const entityNameMap = new Map<string, string>();
  for (const list of [entities.labels, entities.priorities, entities.statuses, entities.contact_tags, entities.contact_lists]) {
    for (const e of list) {
      entityNameMap.set(e.id, e.name);
    }
  }

  const enrich = (item: ClassificationSuggestionItem): ClassificationSuggestionItem => ({
    ...item,
    name: entityNameMap.get(item.id) ?? item.id,
  });

  const filterItems = (
    items: unknown
  ): ClassificationSuggestionItem[] => {
    if (!Array.isArray(items)) return [];
    return items
      .filter(
        (item): item is ClassificationSuggestionItem =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as Record<string, unknown>).id === 'string' &&
          typeof (item as Record<string, unknown>).confidence === 'number' &&
          entityNameMap.has((item as Record<string, unknown>).id as string) &&
          (item as Record<string, unknown>).confidence as number >= CONFIDENCE_THRESHOLD
      )
      .map(enrich);
  };

  const filterSingle = (item: unknown): ClassificationSuggestionItem | undefined => {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as Record<string, unknown>).id !== 'string' ||
      typeof (item as Record<string, unknown>).confidence !== 'number'
    ) {
      return undefined;
    }
    const typed = item as ClassificationSuggestionItem;
    if (!entityNameMap.has(typed.id) || typed.confidence < CONFIDENCE_THRESHOLD) return undefined;
    return enrich(typed);
  };

  const filteredLabels = filterItems(raw.labels).slice(0, MAX_LABELS);
  const filteredPriority = filterSingle(raw.priority);
  const filteredStatus = filterSingle(raw.status);
  const filteredContactTags = filterItems(raw.contact_tags);
  const filteredContactLists = filterItems(raw.contact_lists);

  const result: ClassificationSuggestions = {
    reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : '',
  };

  if (filteredLabels.length > 0) result.labels = filteredLabels;
  if (filteredPriority) result.priority = filteredPriority;
  if (filteredStatus) result.status = filteredStatus;
  if (filteredContactTags.length > 0) result.contact_tags = filteredContactTags;
  if (filteredContactLists.length > 0) result.contact_lists = filteredContactLists;

  return result;
}

// ── applySuggestionItems ─────────────────────────────────────

async function applySuggestionItems(
  suggestions: ClassificationSuggestions,
  sessionId: string,
  contactId: string,
  companyId: string,
  partial?: PartialAccept
): Promise<void> {
  const tasks: PromiseLike<unknown>[] = [];

  // Labels
  const labelItems =
    partial?.labels !== undefined
      ? (suggestions.labels ?? []).filter((l) => partial.labels!.includes(l.id))
      : (suggestions.labels ?? []);

  if (labelItems.length > 0) {
    tasks.push(
      supabaseAdmin
        .from('conversation_labels')
        .upsert(
          labelItems.map((l) => ({ session_id: sessionId, label_id: l.id })),
          { onConflict: 'session_id,label_id' }
        )
        .then(({ error }) => { if (error) throw error; })
    );
  }

  // Priority
  const applyPriority = partial !== undefined ? partial.priority === true : true;
  if (applyPriority && suggestions.priority) {
    const priorityId = suggestions.priority.id;
    tasks.push(
      (async () => {
        // Only apply if current priority is default (unless partial/forced)
        if (partial === undefined) {
          const { data: session } = await supabaseAdmin
            .from('chat_sessions')
            .select('priority')
            .eq('id', sessionId)
            .single();

          const currentPriorityName = session?.priority as string | null;

          if (currentPriorityName) {
            const { data: currentPriority } = await supabaseAdmin
              .from('conversation_priorities')
              .select('is_default')
              .eq('company_id', companyId)
              .eq('name', currentPriorityName)
              .single();

            if (!currentPriority?.is_default) return;
          }
        }

        const { data: priorityRecord } = await supabaseAdmin
          .from('conversation_priorities')
          .select('name')
          .eq('id', priorityId)
          .eq('company_id', companyId)
          .single();

        if (priorityRecord?.name) {
          await supabaseAdmin
            .from('chat_sessions')
            .update({ priority: priorityRecord.name })
            .eq('id', sessionId);
        }
      })()
    );
  }

  // Status
  const applyStatus = partial !== undefined ? partial.status === true : true;
  if (applyStatus && suggestions.status) {
    const statusId = suggestions.status.id;
    tasks.push(
      (async () => {
        // Only apply if current status is default (unless partial/forced)
        if (partial === undefined) {
          const { data: session } = await supabaseAdmin
            .from('chat_sessions')
            .select('status')
            .eq('id', sessionId)
            .single();

          const currentStatusName = session?.status as string | null;

          if (currentStatusName) {
            const { data: currentStatus } = await supabaseAdmin
              .from('conversation_statuses')
              .select('is_default')
              .eq('company_id', companyId)
              .eq('name', currentStatusName)
              .single();

            if (!currentStatus?.is_default) return;
          }
        }

        const { data: statusRecord } = await supabaseAdmin
          .from('conversation_statuses')
          .select('name')
          .eq('id', statusId)
          .eq('company_id', companyId)
          .single();

        if (statusRecord?.name) {
          await supabaseAdmin
            .from('chat_sessions')
            .update({ status: statusRecord.name })
            .eq('id', sessionId);
        }
      })()
    );
  }

  // Contact tags
  const tagItems =
    partial?.contact_tags !== undefined
      ? (suggestions.contact_tags ?? []).filter((t) => partial.contact_tags!.includes(t.id))
      : (suggestions.contact_tags ?? []);

  if (tagItems.length > 0) {
    tasks.push(
      (async () => {
        // Resolve tag IDs to names
        const tagIds = tagItems.map((t) => t.id);
        const { data: tagRecords } = await supabaseAdmin
          .from('contact_tags')
          .select('id, name')
          .in('id', tagIds)
          .eq('company_id', companyId);

        if (!tagRecords || tagRecords.length === 0) return;

        const newTagNames = tagRecords.map((t: EntityRecord) => t.name);

        // Read existing contact tags
        const { data: contactRecord } = await supabaseAdmin
          .from('contacts')
          .select('tags')
          .eq('id', contactId)
          .single();

        const existingTags: string[] = (contactRecord?.tags ?? []) as string[];
        const mergedTags = [...existingTags, ...newTagNames.filter((n: string) => !existingTags.includes(n))];

        await supabaseAdmin
          .from('contacts')
          .update({ tags: mergedTags })
          .eq('id', contactId);
      })()
    );
  }

  // Contact lists
  const listItems =
    partial?.contact_lists !== undefined
      ? (suggestions.contact_lists ?? []).filter((l) => partial.contact_lists!.includes(l.id))
      : (suggestions.contact_lists ?? []);

  if (listItems.length > 0) {
    tasks.push(
      supabaseAdmin
        .from('contact_list_members')
        .upsert(
          listItems.map((l) => ({ list_id: l.id, contact_id: contactId })),
          { onConflict: 'list_id,contact_id' }
        )
        .then(({ error }) => { if (error) throw error; })
    );
  }

  await Promise.all(tasks);
}

// ── classifyConversation ─────────────────────────────────────

export async function classifyConversation(
  sessionId: string,
  companyId: string,
  trigger: 'auto' | 'manual'
): Promise<ClassificationSuggestion | null> {
  if (!anthropic) {
    console.warn('Classification skipped: ANTHROPIC_API_KEY not configured.');
    return null;
  }

  // 1. Fetch session
  const { data: session, error: sessionError } = await supabaseAdmin
    .from('chat_sessions')
    .select('channel_id, contact_id')
    .eq('id', sessionId)
    .eq('company_id', companyId)
    .single();

  if (sessionError || !session?.channel_id || !session?.contact_id) {
    console.error('classifyConversation: session not found or missing fields', sessionError);
    return null;
  }

  const { channel_id: channelId, contact_id: contactId } = session as {
    channel_id: number;
    contact_id: string;
  };

  // 2. Resolve classification config from company + channel settings
  const { data: company } = await supabaseAdmin
    .from('companies')
    .select('classification_enabled, classification_mode, classification_auto_classify, classification_rules, classification_config_mode, classification_structured_rules')
    .eq('id', companyId)
    .single();

  if (!company?.classification_enabled) {
    console.log('[classify] BAIL: company classification disabled');
    return null;
  }

  const configMode = (company.classification_config_mode as string) ?? 'company';
  let effectiveMode: string;
  let effectiveAutoClassify: boolean;
  let rules: string;
  let structuredRules: StructuredRule[];

  if (configMode === 'per_channel') {
    // Per-channel mode: use channel settings only, no company fallback
    const { data: channelSettings } = await supabaseAdmin
      .from('channel_agent_settings')
      .select('classification_override, classification_mode, classification_auto_classify, classification_rules, classification_structured_rules')
      .eq('channel_id', channelId)
      .eq('company_id', companyId)
      .single();

    const override = channelSettings?.classification_override ?? 'disabled';

    if (override !== 'custom') {
      console.log('[classify] BAIL: channel not configured in per-channel mode');
      return null;
    }

    effectiveMode = channelSettings?.classification_mode ?? 'suggest';
    effectiveAutoClassify = channelSettings?.classification_auto_classify ?? false;
    rules = channelSettings?.classification_rules ?? '';
    structuredRules = (channelSettings?.classification_structured_rules as StructuredRule[] | null) ?? [];
  } else {
    // Company-wide mode: use company settings for all channels
    effectiveMode = company.classification_mode ?? 'suggest';
    effectiveAutoClassify = company.classification_auto_classify ?? false;
    rules = company.classification_rules ?? '';
    structuredRules = (company.classification_structured_rules as StructuredRule[] | null) ?? [];
  }

  // For auto trigger, skip if auto-classify is disabled
  if (trigger === 'auto' && !effectiveAutoClassify) {
    console.log('[classify] BAIL: auto-classify disabled');
    return null;
  }

  // 4. Dedup check for auto trigger
  if (trigger === 'auto') {
    const dedupeWindowStart = new Date(
      Date.now() - DEDUP_WINDOW_SECONDS * 1000
    ).toISOString();

    const { data: recent } = await supabaseAdmin
      .from('classification_suggestions')
      .select('id')
      .eq('session_id', sessionId)
      .eq('company_id', companyId)
      .eq('trigger', 'auto')
      .in('status', ['pending', 'applied'])
      .gte('created_at', dedupeWindowStart)
      .limit(1);

    if (recent && recent.length > 0) {
      return null;
    }
  }

  // 5. Fetch entities, check empty entity guard
  const entities = await fetchAvailableEntities(companyId);
  const totalEntities =
    entities.labels.length +
    entities.priorities.length +
    entities.statuses.length +
    entities.contact_tags.length +
    entities.contact_lists.length;

  if (totalEntities === 0) {
    return null;
  }

  // 6. Build prompt, call Haiku with tool_use + tool_choice forced
  const userMessage = await buildClassificationPrompt(
    sessionId,
    companyId,
    contactId,
    rules,
    structuredRules,
    entities
  );

  const response = await anthropic.messages.create({
    model: CLASSIFICATION_MODEL,
    max_tokens: 1024,
    system:
      'You are a conversation classifier for a customer messaging platform.\nAnalyze the conversation and classify it using ONLY the available options provided.\nApply the admin\'s classification rules when provided.\nReturn your best matches with confidence scores (0.0 to 1.0).\nIf nothing fits well (confidence < 0.3), omit that field rather than guessing.',
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: 'tool', name: 'classify_conversation' },
    messages: [{ role: 'user', content: userMessage }],
  });

  // Extract tool use block
  const toolBlock = response.content.find(
    (block: Anthropic.ContentBlock): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
  );

  if (!toolBlock) {
    console.error('classifyConversation: no tool_use block in response');
    return null;
  }

  // 7. Validate/filter response
  const filtered = validateAndFilter(
    toolBlock.input as Record<string, unknown>,
    entities
  );

  // 8. Store in classification_suggestions
  const { data: suggestion, error: insertError } = await supabaseAdmin
    .from('classification_suggestions')
    .insert({
      company_id: companyId,
      session_id: sessionId,
      contact_id: contactId,
      trigger,
      status: 'pending',
      suggestions: filtered,
      accepted_items: null,
      applied_by: null,
      applied_at: null,
    })
    .select()
    .single();

  if (insertError || !suggestion) {
    console.error('classifyConversation: failed to insert suggestion', insertError);
    return null;
  }

  // Notify company members about classification
  if (trigger === 'auto') {
    const { data: members } = await supabaseAdmin
      .from('company_members')
      .select('user_id')
      .eq('company_id', companyId);

    if (members && members.length > 0) {
      const { data: contactData } = await supabaseAdmin
        .from('contacts')
        .select('first_name, last_name')
        .eq('id', contactId)
        .single();

      const contactName = [contactData?.first_name, contactData?.last_name].filter(Boolean).join(' ') || 'Unknown';
      const isAutoApply = effectiveMode === 'auto_apply';

      const title = isAutoApply
        ? `AI classified ${contactName}`
        : `AI has suggestions for ${contactName}`;

      const appliedItems: string[] = [];
      if (filtered.labels?.length) appliedItems.push(...filtered.labels.map((l) => l.name ?? l.id));
      if (filtered.priority) appliedItems.push(`Priority: ${filtered.priority.name ?? filtered.priority.id}`);
      if (filtered.status) appliedItems.push(`Status: ${filtered.status.name ?? filtered.status.id}`);
      if (filtered.contact_tags?.length) appliedItems.push(...filtered.contact_tags.map((t) => t.name ?? t.id));
      if (filtered.contact_lists?.length) appliedItems.push(...filtered.contact_lists.map((l) => l.name ?? l.id));

      const body = isAutoApply && appliedItems.length > 0
        ? `Applied: ${appliedItems.join(', ')}`
        : undefined;

      createNotificationsForUsers(
        companyId,
        members.map((m: { user_id: string }) => m.user_id),
        'classification',
        title,
        body,
        { conversation_id: sessionId, channel_id: channelId }
      ).catch((err) => console.error('Classification notification failed:', err));
    }
  }

  // 9. If effective mode is auto_apply, apply immediately
  if (effectiveMode === 'auto_apply') {
    await applySuggestionItems(filtered, sessionId, contactId, companyId);
    await supabaseAdmin
      .from('classification_suggestions')
      .update({ status: 'applied', applied_at: new Date().toISOString() })
      .eq('id', suggestion.id);

    return { ...suggestion, status: 'applied', applied_at: new Date().toISOString() } as ClassificationSuggestion;
  }

  // 10. Return the suggestion record
  return suggestion as ClassificationSuggestion;
}

// ── acceptSuggestion ─────────────────────────────────────────

export async function acceptSuggestion(
  suggestionId: string,
  userId: string,
  companyId: string,
  partial?: PartialAccept
): Promise<ClassificationSuggestion> {
  // 1. Fetch suggestion, verify status === 'pending'
  const { data: suggestion, error } = await supabaseAdmin
    .from('classification_suggestions')
    .select('*')
    .eq('id', suggestionId)
    .eq('company_id', companyId)
    .single();

  if (error || !suggestion) {
    throw new Error('NOT_FOUND');
  }

  if (suggestion.status !== 'pending') {
    throw new Error('CONFLICT');
  }

  const typed = suggestion as ClassificationSuggestion;

  // 2. Re-validate entities still exist
  const entities = await fetchAvailableEntities(companyId);
  const filteredSuggestions = validateAndFilter(
    typed.suggestions as unknown as Record<string, unknown>,
    entities
  );

  // 3. Apply filtered suggestions
  await applySuggestionItems(
    filteredSuggestions,
    typed.session_id,
    typed.contact_id,
    companyId,
    partial
  );

  // 4. Update suggestion status to 'accepted'
  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('classification_suggestions')
    .update({
      status: 'accepted',
      accepted_items: partial ?? null,
      applied_by: userId,
      applied_at: now,
    })
    .eq('id', suggestionId)
    .select()
    .single();

  if (updateError || !updated) {
    throw new Error('UPDATE_FAILED');
  }

  return updated as ClassificationSuggestion;
}

// ── dismissSuggestion ─────────────────────────────────────────

export async function dismissSuggestion(
  suggestionId: string,
  companyId: string
): Promise<ClassificationSuggestion> {
  // 1. Fetch suggestion, verify status === 'pending'
  const { data: suggestion, error } = await supabaseAdmin
    .from('classification_suggestions')
    .select('*')
    .eq('id', suggestionId)
    .eq('company_id', companyId)
    .single();

  if (error || !suggestion) {
    throw new Error('NOT_FOUND');
  }

  if (suggestion.status !== 'pending') {
    throw new Error('CONFLICT');
  }

  // 2. Update status to 'dismissed'
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('classification_suggestions')
    .update({ status: 'dismissed' })
    .eq('id', suggestionId)
    .select()
    .single();

  if (updateError || !updated) {
    throw new Error('UPDATE_FAILED');
  }

  return updated as ClassificationSuggestion;
}
