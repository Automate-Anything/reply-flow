import { supabaseAdmin } from '../config/supabase.js';

export interface AudienceSegment {
  label: string;
  description?: string;
}

// ── Response Flow types ──────────────────────────────

export interface CommunicationStyle {
  tone?: 'professional' | 'friendly' | 'casual' | 'formal';
  response_length?: 'concise' | 'moderate' | 'detailed';
  emoji_usage?: 'none' | 'minimal' | 'moderate';
}

export interface Scenario {
  id: string;
  label: string;
  detection_criteria: string;

  // Instructions
  goal?: string;
  instructions?: string;
  context?: string;

  // Knowledge base attachments
  kb_attachments?: { kb_id: string; instructions?: string }[];

  // Guardrails
  rules?: string;
  example_response?: string;

  // Escalation
  escalation_trigger?: string;
  escalation_message?: string;

  // Style overrides
  tone?: CommunicationStyle['tone'];
  response_length?: CommunicationStyle['response_length'];
  emoji_usage?: CommunicationStyle['emoji_usage'];

  // DEPRECATED — kept for migration from old data
  response_rules?: string;
  escalation_rules?: string;
}

export type FallbackMode = 'respond_basics' | 'human_handle';

export interface ResponseFlow {
  default_style: CommunicationStyle;
  greeting_message?: string;
  response_rules?: string;
  topics_to_avoid?: string;
  scenarios: Scenario[];
  fallback_mode: FallbackMode;
  human_phone?: string;
  fallback_kb_attachments?: { kb_id: string; instructions?: string }[];
}

// ── Profile & KB types ──────────────────────────────

export interface ProfileData {
  // Identity
  use_case?: 'business' | 'personal' | 'organization';
  business_name?: string;
  business_type?: string;
  business_description?: string;
  // Language (global)
  language_preference?: 'match_customer' | string;
  // Scenario-based response flow
  response_flow?: ResponseFlow;
  // DEPRECATED — old flat fields
  audiences?: AudienceSegment[];
  target_audience?: string;
  tone?: 'professional' | 'friendly' | 'casual' | 'formal';
  response_length?: 'concise' | 'moderate' | 'detailed';
  emoji_usage?: 'none' | 'minimal' | 'moderate';
  response_rules?: string;
  greeting_message?: string;
  escalation_rules?: string;
  topics_to_avoid?: string;
}

export interface KBEntry {
  id?: string;
  title: string;
  content: string;
  knowledge_base_id?: string;
}

export interface ChannelOverrides {
  custom_instructions?: string;
}

// ── Shared constants (fallback defaults) ────────────

const DEFAULT_TONE_DESCRIPTIONS: Record<string, string> = {
  professional: 'Maintain a professional, polished tone. Be respectful and business-appropriate.',
  friendly: 'Be warm, approachable, and personable. Use a conversational but helpful tone.',
  casual: 'Keep things relaxed and informal. Use everyday language and be easygoing.',
  formal: 'Use formal language and proper etiquette. Be courteous and dignified.',
};

const DEFAULT_LENGTH_DESCRIPTIONS: Record<string, string> = {
  concise: 'Keep responses short and to the point. Aim for 1-3 sentences when possible.',
  moderate: 'Provide clear, balanced responses. Use enough detail to be helpful without being verbose.',
  detailed: 'Give thorough, comprehensive responses. Include relevant details and explanations.',
};

const DEFAULT_EMOJI_DESCRIPTIONS: Record<string, string> = {
  none: 'Do not use emojis in your responses.',
  minimal: 'Use emojis sparingly, only when they add warmth or clarity.',
  moderate: 'Feel free to use emojis to add personality and friendliness.',
};

const DEFAULT_CORE_RULES = `## Core Rules
- You are chatting via WhatsApp. Keep messages appropriate for mobile messaging.
- Never reveal that you are an AI unless directly asked.
- If you don't know the answer to something, be honest about it rather than making up information.
- Never share sensitive business information like internal processes, pricing strategies, or employee details unless explicitly covered in the knowledge base.
- If a conversation requires human attention (complaints, complex issues, urgent matters), politely let the customer know that a team member will follow up.`;

// ── DB-backed template cache ────────────────────────

export interface PromptTemplateCache {
  tone: Record<string, string>;
  length: Record<string, string>;
  emoji: Record<string, string>;
  coreRules: string;
  loadedAt: number;
}

let templateCache: PromptTemplateCache | null = null;
const CACHE_TTL = 60_000; // 60 seconds

export async function getPromptTemplates(): Promise<PromptTemplateCache> {
  if (templateCache && Date.now() - templateCache.loadedAt < CACHE_TTL) {
    return templateCache;
  }

  try {
    const { data } = await supabaseAdmin
      .from('prompt_templates')
      .select('key, category, content');

    const tone: Record<string, string> = { ...DEFAULT_TONE_DESCRIPTIONS };
    const length: Record<string, string> = { ...DEFAULT_LENGTH_DESCRIPTIONS };
    const emoji: Record<string, string> = { ...DEFAULT_EMOJI_DESCRIPTIONS };
    let coreRules = DEFAULT_CORE_RULES;

    for (const row of data || []) {
      const subKey = row.key.split('.')[1];
      if (row.category === 'tone' && subKey) tone[subKey] = row.content;
      else if (row.category === 'length' && subKey) length[subKey] = row.content;
      else if (row.category === 'emoji' && subKey) emoji[subKey] = row.content;
      else if (row.category === 'core_rules') coreRules = row.content;
    }

    templateCache = { tone, length, emoji, coreRules, loadedAt: Date.now() };
    return templateCache;
  } catch (err) {
    console.error('Failed to load prompt templates from DB, using defaults:', err);
    return {
      tone: DEFAULT_TONE_DESCRIPTIONS,
      length: DEFAULT_LENGTH_DESCRIPTIONS,
      emoji: DEFAULT_EMOJI_DESCRIPTIONS,
      coreRules: DEFAULT_CORE_RULES,
      loadedAt: Date.now(),
    };
  }
}

export function invalidateTemplateCache(): void {
  templateCache = null;
}

// ── Identity builders (shared) ──────────────────────

function buildAudienceSection(profile: ProfileData): string | null {
  if (profile.audiences && profile.audiences.length > 0) {
    const lines = profile.audiences.map((a) =>
      a.description ? `- **${a.label}**: ${a.description}` : `- ${a.label}`
    );
    return `## Target Audience\n${lines.join('\n')}`;
  }
  if (profile.target_audience) {
    return `## Target Audience\n${profile.target_audience}`;
  }
  return null;
}

function buildIdentitySection(profile: ProfileData): string {
  const sections: string[] = [];

  switch (profile.use_case) {
    case 'business': {
      const name = profile.business_name || 'the business';
      sections.push(`You are an AI assistant for ${name}. You help manage WhatsApp conversations on behalf of this business.`);
      if (profile.business_description) sections.push(`## About the Business\n${profile.business_description}`);
      if (profile.business_type) sections.push(`## Industry\nThis is a ${profile.business_type} business.`);
      break;
    }
    case 'organization': {
      const name = profile.business_name || 'the organization';
      sections.push(`You are an AI assistant for ${name}. You help manage WhatsApp conversations on behalf of this organization.`);
      if (profile.business_description) sections.push(`## About the Organization\n${profile.business_description}`);
      break;
    }
    case 'personal':
      sections.push('You are a personal AI assistant managing WhatsApp conversations.');
      if (profile.business_description) sections.push(`## Context\n${profile.business_description}`);
      break;
    default:
      sections.push('You are a helpful AI assistant managing WhatsApp conversations. Respond professionally and concisely.');
      break;
  }

  return sections.join('\n\n');
}

function buildLanguageSection(profile: ProfileData): string | null {
  if (!profile.language_preference) return null;
  if (profile.language_preference === 'match_customer') {
    return '## Language\nAlways respond in the same language the customer uses.';
  }
  return `## Language\nRespond in ${profile.language_preference}.`;
}

function buildKBSection(kbEntries: KBEntry[]): string | null {
  if (kbEntries.length === 0) return null;
  const kbSection = kbEntries
    .map((entry) => `### ${entry.title}\n${entry.content}`)
    .join('\n\n---\n\n');
  return `## Relevant Knowledge Base Context\nThe following is the most relevant information retrieved from the knowledge base for this query. Use it to answer questions accurately. If a question isn't covered by this information, say so honestly.\n\n${kbSection}`;
}

// ── New: Scenario-based prompt builder ──────────────

function formatStyleDescription(style: CommunicationStyle, t: PromptTemplateCache): string {
  const parts: string[] = [];
  if (style.tone && t.tone[style.tone]) parts.push(t.tone[style.tone]);
  if (style.response_length && t.length[style.response_length]) parts.push(t.length[style.response_length]);
  if (style.emoji_usage && t.emoji[style.emoji_usage]) parts.push(t.emoji[style.emoji_usage]);
  return parts.join('\n');
}

function formatStyleBrief(style: CommunicationStyle): string {
  const parts: string[] = [];
  if (style.tone) parts.push(`${style.tone} tone`);
  if (style.response_length) parts.push(`${style.response_length} responses`);
  if (style.emoji_usage) parts.push(`${style.emoji_usage} emojis`);
  return parts.join(', ');
}

function resolveScenarioStyle(scenario: Scenario, defaults: CommunicationStyle): CommunicationStyle {
  return {
    tone: scenario.tone ?? defaults.tone,
    response_length: scenario.response_length ?? defaults.response_length,
    emoji_usage: scenario.emoji_usage ?? defaults.emoji_usage,
  };
}

function buildScenariosSection(flow: ResponseFlow, kbEntries: KBEntry[] = []): string | null {
  if (flow.scenarios.length === 0) return null;

  const entriesByKBId = groupEntriesByKBId(kbEntries);

  const scenarioBlocks = flow.scenarios.map((sc) => {
    const resolved = resolveScenarioStyle(sc, flow.default_style);
    const lines: string[] = [];
    lines.push(`### ${sc.label}`);
    lines.push(`**Detect**: ${sc.detection_criteria}`);
    if (sc.goal) lines.push(`**Goal**: ${sc.goal}`);
    lines.push(`**Style**: ${formatStyleBrief(resolved)}`);
    if (sc.instructions) lines.push(`**Instructions**:\n${sc.instructions}`);
    // Inline context and KB attachments as unified context
    const contextParts: string[] = [];
    if (sc.context) contextParts.push(sc.context);
    if (sc.kb_attachments && sc.kb_attachments.length > 0) {
      for (const att of sc.kb_attachments) {
        const entries = entriesByKBId.get(att.kb_id) || [];
        for (const entry of entries) {
          const header = att.instructions
            ? `[${entry.title}] (${att.instructions})`
            : `[${entry.title}]`;
          contextParts.push(`${header}\n${entry.content}`);
        }
      }
    }
    if (contextParts.length > 0) lines.push(`**Context**:\n${contextParts.join('\n\n')}`);
    // Support both new and legacy field names
    if (sc.rules) lines.push(`**Rules**:\n${sc.rules}`);
    else if (sc.response_rules) lines.push(`**Rules**: ${sc.response_rules}`);
    if (sc.example_response) lines.push(`**Example Response**:\n"${sc.example_response}"`);
    if (sc.escalation_trigger || sc.escalation_rules) {
      const trigger = sc.escalation_trigger || sc.escalation_rules;
      lines.push(`**Escalation**:\n- **When**: ${trigger}`);
      if (sc.escalation_message) lines.push(`- **Say**: "${sc.escalation_message}"`);
    }
    return lines.join('\n');
  });

  let fallbackText: string;
  if (flow.fallback_mode === 'respond_basics') {
    fallbackText = 'Respond using your default communication style and the knowledge base.';
  } else {
    fallbackText = flow.human_phone
      ? `Politely let the customer know that a human team member will assist them and provide this contact number: ${flow.human_phone}`
      : 'Do not respond. A human team member will handle this conversation.';
  }

  return `## Scenarios\nWhen you receive a message, identify which scenario best matches and apply its specific rules.\nIf multiple scenarios could match, choose the most specific one.\n\n${scenarioBlocks.join('\n\n')}\n\n### Messages that don't match any scenario\n${fallbackText}`;
}

function buildResponseFlowPrompt(
  profile: ProfileData,
  kbEntries: KBEntry[],
  t: PromptTemplateCache,
  channelOverrides?: ChannelOverrides,
): string {
  const flow = profile.response_flow!;
  const parts: string[] = [];

  // Identity
  parts.push(buildIdentitySection(profile));

  // Language
  const lang = buildLanguageSection(profile);
  if (lang) parts.push(lang);

  // Default communication style
  const styleDesc = formatStyleDescription(flow.default_style, t);
  if (styleDesc) parts.push(`## Communication Style\n${styleDesc}`);

  // Greeting
  if (flow.greeting_message) {
    parts.push(`## First Contact Greeting\nWhen this is the first message from a new contact, greet them with: "${flow.greeting_message}"`);
  }

  // General response rules
  if (flow.response_rules) {
    parts.push(`## Response Guidelines\n${flow.response_rules}`);
  }

  // Topics to avoid
  if (flow.topics_to_avoid) {
    parts.push(`## Topics to Avoid\nNever discuss or share information about the following:\n${flow.topics_to_avoid}`);
  }

  // Scenarios (pass KB entries so per-scenario attachments are inlined)
  const scenarios = buildScenariosSection(flow, kbEntries);
  if (scenarios) parts.push(scenarios);

  // Fallback knowledge base (from fallback_kb_attachments)
  if (flow.fallback_kb_attachments && flow.fallback_kb_attachments.length > 0) {
    const fallbackEntries: KBEntry[] = [];
    for (const att of flow.fallback_kb_attachments) {
      const entries = kbEntries.filter((e) => e.knowledge_base_id === att.kb_id);
      fallbackEntries.push(...entries);
    }
    const kb = buildKBSection(fallbackEntries);
    if (kb) parts.push(kb);
  }

  // Channel-specific instructions
  if (channelOverrides?.custom_instructions) {
    parts.push(`## Channel-Specific Instructions\n${channelOverrides.custom_instructions}`);
  }

  // Core rules
  parts.push(t.coreRules);

  return parts.join('\n\n');
}

// ── Legacy flat prompt builder ──────────────────────

function buildBusinessPrompt(profile: ProfileData): string {
  const sections: string[] = [];
  const name = profile.business_name || 'the business';
  sections.push(`You are an AI assistant for ${name}. You help manage WhatsApp conversations on behalf of this business.`);
  if (profile.business_description) sections.push(`## About the Business\n${profile.business_description}`);
  if (profile.business_type) sections.push(`## Industry\nThis is a ${profile.business_type} business.`);
  const audience = buildAudienceSection(profile);
  if (audience) sections.push(audience);
  return sections.join('\n\n');
}

function buildPersonalPrompt(profile: ProfileData): string {
  const sections: string[] = [];
  sections.push('You are a personal AI assistant managing WhatsApp conversations.');
  if (profile.business_description) sections.push(`## Context\n${profile.business_description}`);
  const audience = buildAudienceSection(profile);
  if (audience) sections.push(audience);
  return sections.join('\n\n');
}

function buildOrganizationPrompt(profile: ProfileData): string {
  const sections: string[] = [];
  const name = profile.business_name || 'the organization';
  sections.push(`You are an AI assistant for ${name}. You help manage WhatsApp conversations on behalf of this organization.`);
  if (profile.business_description) sections.push(`## About the Organization\n${profile.business_description}`);
  const audience = buildAudienceSection(profile);
  if (audience) sections.push(audience);
  return sections.join('\n\n');
}

function buildLegacyPrompt(
  profile: ProfileData,
  kbEntries: KBEntry[],
  t: PromptTemplateCache,
  channelOverrides?: ChannelOverrides,
): string {
  const parts: string[] = [];

  // Identity
  switch (profile.use_case) {
    case 'business':
      parts.push(buildBusinessPrompt(profile));
      break;
    case 'organization':
      parts.push(buildOrganizationPrompt(profile));
      break;
    case 'personal':
      parts.push(buildPersonalPrompt(profile));
      break;
    default:
      parts.push('You are a helpful AI assistant managing WhatsApp conversations. Respond professionally and concisely.');
      break;
  }

  // Communication style
  const styleRules: string[] = [];
  if (profile.tone && t.tone[profile.tone]) styleRules.push(t.tone[profile.tone]);
  if (profile.response_length && t.length[profile.response_length]) styleRules.push(t.length[profile.response_length]);
  if (profile.emoji_usage && t.emoji[profile.emoji_usage]) styleRules.push(t.emoji[profile.emoji_usage]);
  if (profile.language_preference) {
    if (profile.language_preference === 'match_customer') {
      styleRules.push('Always respond in the same language the customer uses.');
    } else {
      styleRules.push(`Respond in ${profile.language_preference}.`);
    }
  }
  if (styleRules.length > 0) parts.push(`## Communication Style\n${styleRules.join('\n')}`);

  if (profile.response_rules) parts.push(`## Response Guidelines\n${profile.response_rules}`);
  if (profile.topics_to_avoid) parts.push(`## Topics to Avoid\nNever discuss or share information about the following:\n${profile.topics_to_avoid}`);
  if (profile.escalation_rules) parts.push(`## Escalation Guidelines\n${profile.escalation_rules}`);
  if (profile.greeting_message) parts.push(`## First Contact Greeting\nWhen this is the first message from a new contact, greet them with: "${profile.greeting_message}"`);

  const kb = buildKBSection(kbEntries);
  if (kb) parts.push(kb);

  if (channelOverrides?.custom_instructions) {
    parts.push(`## Channel-Specific Instructions\n${channelOverrides.custom_instructions}`);
  }

  parts.push(t.coreRules);
  return parts.join('\n\n');
}

// ── Shared helper ───────────────────────────────────

function groupEntriesByKBId(kbEntries: KBEntry[]): Map<string, KBEntry[]> {
  const map = new Map<string, KBEntry[]>();
  for (const entry of kbEntries) {
    if (entry.knowledge_base_id) {
      const list = map.get(entry.knowledge_base_id) || [];
      list.push(entry);
      map.set(entry.knowledge_base_id, list);
    }
  }
  return map;
}

// ── Classification prompt (lightweight, for Haiku) ──

export function buildClassificationPrompt(profile: ProfileData): string | null {
  const flow = profile.response_flow;
  if (!flow || flow.scenarios.length === 0) return null;

  const businessCtx = profile.business_name
    ? ` for ${profile.business_name}${profile.business_type ? ` (${profile.business_type})` : ''}`
    : '';

  const scenarioList = flow.scenarios
    .map((sc, i) => `${i + 1}. "${sc.label}" — ${sc.detection_criteria}`)
    .join('\n');

  return `You are a message classifier${businessCtx}. Given a customer message and conversation context, determine which scenario best matches.

## Available Scenarios
${scenarioList}

## Instructions
- Analyze the customer's latest message in the context of the conversation.
- Choose the single best matching scenario, or null if no scenario fits.
- Consider follow-up messages: if the conversation is continuing a previous topic, classify according to that topic.
- If multiple scenarios could match, choose the most specific one.

Respond with JSON only, no other text:
{"scenario_label": "<exact label or null>", "confidence": "high|medium|low"}`;
}

// ── Targeted response prompt (single matched scenario) ──

export async function buildScenarioResponsePrompt(
  profile: ProfileData,
  kbEntries: KBEntry[],
  matchedScenarioLabel: string | null,
  channelOverrides?: ChannelOverrides,
): Promise<string> {
  const t = await getPromptTemplates();
  const flow = profile.response_flow!;
  const parts: string[] = [];

  // Identity
  parts.push(buildIdentitySection(profile));

  // Language
  const lang = buildLanguageSection(profile);
  if (lang) parts.push(lang);

  // Greeting
  if (flow.greeting_message) {
    parts.push(`## First Contact Greeting\nWhen this is the first message from a new contact, greet them with: "${flow.greeting_message}"`);
  }

  // General response rules
  if (flow.response_rules) {
    parts.push(`## Response Guidelines\n${flow.response_rules}`);
  }

  // Topics to avoid
  if (flow.topics_to_avoid) {
    parts.push(`## Topics to Avoid\nNever discuss or share information about the following:\n${flow.topics_to_avoid}`);
  }

  // Find matched scenario
  const matchedScenario = matchedScenarioLabel
    ? flow.scenarios.find((sc) => sc.label === matchedScenarioLabel)
    : null;

  if (matchedScenario) {
    // Resolved style (scenario overrides + defaults)
    const resolved = resolveScenarioStyle(matchedScenario, flow.default_style);
    const styleDesc = formatStyleDescription(resolved, t);
    if (styleDesc) parts.push(`## Communication Style\n${styleDesc}`);

    // Single scenario block
    const scenarioLines: string[] = [];
    scenarioLines.push(`## Active Scenario: ${matchedScenario.label}`);
    if (matchedScenario.goal) scenarioLines.push(`**Goal**: ${matchedScenario.goal}`);
    if (matchedScenario.instructions) scenarioLines.push(`**Instructions**:\n${matchedScenario.instructions}`);

    // Inline context + KB attachments
    const contextParts: string[] = [];
    if (matchedScenario.context) contextParts.push(matchedScenario.context);
    if (matchedScenario.kb_attachments && matchedScenario.kb_attachments.length > 0) {
      const entriesByKBId = groupEntriesByKBId(kbEntries);
      for (const att of matchedScenario.kb_attachments) {
        const entries = entriesByKBId.get(att.kb_id) || [];
        for (const entry of entries) {
          const header = att.instructions
            ? `[${entry.title}] (${att.instructions})`
            : `[${entry.title}]`;
          contextParts.push(`${header}\n${entry.content}`);
        }
      }
    }
    if (contextParts.length > 0) scenarioLines.push(`**Context**:\n${contextParts.join('\n\n')}`);

    // Rules (support legacy field name)
    if (matchedScenario.rules) scenarioLines.push(`**Rules**:\n${matchedScenario.rules}`);
    else if (matchedScenario.response_rules) scenarioLines.push(`**Rules**: ${matchedScenario.response_rules}`);

    if (matchedScenario.example_response) scenarioLines.push(`**Example Response**:\n"${matchedScenario.example_response}"`);

    // Escalation
    if (matchedScenario.escalation_trigger || matchedScenario.escalation_rules) {
      const trigger = matchedScenario.escalation_trigger || matchedScenario.escalation_rules;
      scenarioLines.push(`**Escalation**:\n- **When**: ${trigger}`);
      if (matchedScenario.escalation_message) scenarioLines.push(`- **Say**: "${matchedScenario.escalation_message}"`);
    }

    parts.push(scenarioLines.join('\n'));
  } else {
    // No scenario matched — use default style + fallback behavior
    const styleDesc = formatStyleDescription(flow.default_style, t);
    if (styleDesc) parts.push(`## Communication Style\n${styleDesc}`);

    if (flow.fallback_mode === 'human_handle') {
      const fallbackMsg = flow.human_phone
        ? `Politely let the customer know that a human team member will assist them and provide this contact number: ${flow.human_phone}`
        : 'Politely let the customer know that a human team member will follow up with them shortly.';
      parts.push(`## Important\n${fallbackMsg}`);
    }

    // Fallback KB attachments
    if (flow.fallback_kb_attachments && flow.fallback_kb_attachments.length > 0) {
      const fallbackEntries: KBEntry[] = [];
      for (const att of flow.fallback_kb_attachments) {
        fallbackEntries.push(...kbEntries.filter((e) => e.knowledge_base_id === att.kb_id));
      }
      const kb = buildKBSection(fallbackEntries);
      if (kb) parts.push(kb);
    }
  }

  // Channel-specific instructions
  if (channelOverrides?.custom_instructions) {
    parts.push(`## Channel-Specific Instructions\n${channelOverrides.custom_instructions}`);
  }

  // Core rules
  parts.push(t.coreRules);

  return parts.join('\n\n');
}

// ── Public API ──────────────────────────────────────

export async function buildSystemPrompt(
  profile: ProfileData,
  kbEntries: KBEntry[] = [],
  channelOverrides?: ChannelOverrides,
): Promise<string> {
  const t = await getPromptTemplates();
  // New scenario-based flow
  if (profile.response_flow) {
    return buildResponseFlowPrompt(profile, kbEntries, t, channelOverrides);
  }
  // Legacy flat fields
  return buildLegacyPrompt(profile, kbEntries, t, channelOverrides);
}
