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
  sectionHeading?: string | null;
}

export interface ChannelOverrides {
  custom_instructions?: string;
}

// ── Debug: prompt section tracking ──────────────────

export interface PromptSection {
  name: string;
  content: string;
}

export type OnSectionCallback = (section: PromptSection) => void;

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

const DEFAULT_IDENTITY: Record<string, string> = {
  business: 'You are an AI assistant for {name}. You help manage WhatsApp conversations on behalf of this business.',
  organization: 'You are an AI assistant for {name}. You help manage WhatsApp conversations on behalf of this organization.',
  personal: 'You are a personal AI assistant managing WhatsApp conversations.',
  default: 'You are a helpful AI assistant managing WhatsApp conversations. Respond professionally and concisely.',
};

const DEFAULT_LANGUAGE: Record<string, string> = {
  match_customer: 'Always respond in the same language the customer uses.',
  specific: 'Respond in {language}.',
};

const DEFAULT_KB_CONTEXT = 'The following is the most relevant information retrieved from the knowledge base for this query. Use it to answer questions accurately. If a question isn\'t covered by this information, say so honestly.';

const DEFAULT_GREETING = 'When this is the first message from a new contact, greet them with: "{greeting_message}"';

const DEFAULT_TOPICS_TO_AVOID_PREFIX = 'Never discuss or share information about the following:';

const DEFAULT_SCENARIO: Record<string, string> = {
  header: 'When you receive a message, identify which scenario best matches and apply its specific rules.\nIf multiple scenarios could match, choose the most specific one.',
  fallback_respond: 'Respond using your default communication style and the knowledge base.',
  fallback_human: 'Do not respond. A human team member will handle this conversation.',
  fallback_human_phone: 'Politely let the customer know that a human team member will assist them and provide this contact number: {human_phone}',
  fallback_human_followup: 'Politely let the customer know that a human team member will follow up with them shortly.',
};

const DEFAULT_CLASSIFIER = `You are a message classifier{business_context}. Given a customer message and conversation context, determine which scenario best matches.

## Available Scenarios
{scenario_list}

## Instructions
- Analyze the customer's latest message in the context of the conversation.
- Choose the single best matching scenario, or null if no scenario fits.
- Consider follow-up messages: if the conversation is continuing a previous topic, classify according to that topic.
- If multiple scenarios could match, choose the most specific one.

Respond with JSON only, no other text:
{"scenario_label": "<exact label or null>", "confidence": "high|medium|low"}`;

// ── DB-backed template cache ────────────────────────

export interface PromptTemplateCache {
  tone: Record<string, string>;
  length: Record<string, string>;
  emoji: Record<string, string>;
  coreRules: string;
  identity: Record<string, string>;
  language: Record<string, string>;
  kbContext: string;
  greeting: string;
  topicsToAvoidPrefix: string;
  scenario: Record<string, string>;
  classifier: string;
  loadedAt: number;
}

let templateCache: PromptTemplateCache | null = null;
const CACHE_TTL = 60_000; // 60 seconds

function buildDefaultCache(): PromptTemplateCache {
  return {
    tone: { ...DEFAULT_TONE_DESCRIPTIONS },
    length: { ...DEFAULT_LENGTH_DESCRIPTIONS },
    emoji: { ...DEFAULT_EMOJI_DESCRIPTIONS },
    coreRules: DEFAULT_CORE_RULES,
    identity: { ...DEFAULT_IDENTITY },
    language: { ...DEFAULT_LANGUAGE },
    kbContext: DEFAULT_KB_CONTEXT,
    greeting: DEFAULT_GREETING,
    topicsToAvoidPrefix: DEFAULT_TOPICS_TO_AVOID_PREFIX,
    scenario: { ...DEFAULT_SCENARIO },
    classifier: DEFAULT_CLASSIFIER,
    loadedAt: Date.now(),
  };
}

export async function getPromptTemplates(): Promise<PromptTemplateCache> {
  if (templateCache && Date.now() - templateCache.loadedAt < CACHE_TTL) {
    return templateCache;
  }

  try {
    const { data } = await supabaseAdmin
      .from('prompt_templates')
      .select('key, category, content');

    const cache = buildDefaultCache();

    for (const row of data || []) {
      const subKey = row.key.split('.')[1];
      switch (row.category) {
        case 'tone': if (subKey) cache.tone[subKey] = row.content; break;
        case 'length': if (subKey) cache.length[subKey] = row.content; break;
        case 'emoji': if (subKey) cache.emoji[subKey] = row.content; break;
        case 'core_rules': cache.coreRules = row.content; break;
        case 'identity': if (subKey) cache.identity[subKey] = row.content; break;
        case 'language': if (subKey) cache.language[subKey] = row.content; break;
        case 'kb_context': cache.kbContext = row.content; break;
        case 'greeting': cache.greeting = row.content; break;
        case 'topics_to_avoid': cache.topicsToAvoidPrefix = row.content; break;
        case 'scenario': if (subKey) cache.scenario[subKey] = row.content; break;
        case 'classifier': cache.classifier = row.content; break;
      }
    }

    templateCache = cache;
    return templateCache;
  } catch (err) {
    console.error('Failed to load prompt templates from DB, using defaults:', err);
    return buildDefaultCache();
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

function buildIdentitySection(profile: ProfileData, t: PromptTemplateCache): string {
  const sections: string[] = [];

  switch (profile.use_case) {
    case 'business': {
      const name = profile.business_name || 'the business';
      sections.push(t.identity.business.replace('{name}', name));
      if (profile.business_description) sections.push(`## About the Business\n${profile.business_description}`);
      if (profile.business_type) sections.push(`## Industry\nThis is a ${profile.business_type} business.`);
      break;
    }
    case 'organization': {
      const name = profile.business_name || 'the organization';
      sections.push(t.identity.organization.replace('{name}', name));
      if (profile.business_description) sections.push(`## About the Organization\n${profile.business_description}`);
      break;
    }
    case 'personal':
      sections.push(t.identity.personal);
      if (profile.business_description) sections.push(`## Context\n${profile.business_description}`);
      break;
    default:
      sections.push(t.identity.default);
      break;
  }

  return sections.join('\n\n');
}

function buildLanguageSection(profile: ProfileData, t: PromptTemplateCache): string | null {
  if (!profile.language_preference) return null;
  if (profile.language_preference === 'match_customer') {
    return `## Language\n${t.language.match_customer}`;
  }
  return `## Language\n${t.language.specific.replace('{language}', profile.language_preference)}`;
}

function buildKBSection(kbEntries: KBEntry[], t: PromptTemplateCache): string | null {
  if (kbEntries.length === 0) return null;
  const kbSection = kbEntries
    .map((entry) => `### ${entry.title}${entry.sectionHeading ? ' — ' + entry.sectionHeading : ''}\n${entry.content}`)
    .join('\n\n---\n\n');
  return `## Relevant Knowledge Base Context\n${t.kbContext}\n\n${kbSection}`;
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

function buildFallbackText(flow: ResponseFlow, t: PromptTemplateCache): string {
  if (flow.fallback_mode === 'respond_basics') {
    return t.scenario.fallback_respond;
  }
  if (flow.human_phone) {
    return t.scenario.fallback_human_phone.replace('{human_phone}', flow.human_phone);
  }
  return t.scenario.fallback_human;
}

function buildScenariosSection(flow: ResponseFlow, kbEntries: KBEntry[] = [], t: PromptTemplateCache): string | null {
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

  const fallbackText = buildFallbackText(flow, t);

  return `## Scenarios\n${t.scenario.header}\n\n${scenarioBlocks.join('\n\n')}\n\n### Messages that don't match any scenario\n${fallbackText}`;
}

function buildResponseFlowPrompt(
  profile: ProfileData,
  kbEntries: KBEntry[],
  t: PromptTemplateCache,
  channelOverrides?: ChannelOverrides,
  onSection?: OnSectionCallback,
): string {
  const flow = profile.response_flow!;
  const parts: string[] = [];

  const track = (name: string, content: string) => {
    parts.push(content);
    onSection?.({ name, content });
  };

  // Identity
  track('Identity', buildIdentitySection(profile, t));

  // Language
  const lang = buildLanguageSection(profile, t);
  if (lang) track('Language', lang);

  // Default communication style
  const styleDesc = formatStyleDescription(flow.default_style, t);
  if (styleDesc) track('CommunicationStyle', `## Communication Style\n${styleDesc}`);

  // Greeting
  if (flow.greeting_message) {
    track('FirstContactGreeting', `## First Contact Greeting\n${t.greeting.replace('{greeting_message}', flow.greeting_message)}`);
  }

  // General response rules
  if (flow.response_rules) {
    track('ResponseGuidelines', `## Response Guidelines\n${flow.response_rules}`);
  }

  // Topics to avoid
  if (flow.topics_to_avoid) {
    track('TopicsToAvoid', `## Topics to Avoid\n${t.topicsToAvoidPrefix}\n${flow.topics_to_avoid}`);
  }

  // Scenarios (pass KB entries so per-scenario attachments are inlined)
  const scenarios = buildScenariosSection(flow, kbEntries, t);
  if (scenarios) track('Scenarios', scenarios);

  // Fallback knowledge base (from fallback_kb_attachments)
  if (flow.fallback_kb_attachments && flow.fallback_kb_attachments.length > 0) {
    const fallbackEntries: KBEntry[] = [];
    for (const att of flow.fallback_kb_attachments) {
      const entries = kbEntries.filter((e) => e.knowledge_base_id === att.kb_id);
      fallbackEntries.push(...entries);
    }
    const kb = buildKBSection(fallbackEntries, t);
    if (kb) track('KBContext', kb);
  }

  // Channel-specific instructions
  if (channelOverrides?.custom_instructions) {
    track('ChannelInstructions', `## Channel-Specific Instructions\n${channelOverrides.custom_instructions}`);
  }

  // Core rules
  track('CoreRules', t.coreRules);

  return parts.join('\n\n');
}

// ── Legacy flat prompt builder ──────────────────────

function buildLegacyIdentitySection(profile: ProfileData, t: PromptTemplateCache): string {
  const sections: string[] = [];

  switch (profile.use_case) {
    case 'business': {
      const name = profile.business_name || 'the business';
      sections.push(t.identity.business.replace('{name}', name));
      if (profile.business_description) sections.push(`## About the Business\n${profile.business_description}`);
      if (profile.business_type) sections.push(`## Industry\nThis is a ${profile.business_type} business.`);
      break;
    }
    case 'organization': {
      const name = profile.business_name || 'the organization';
      sections.push(t.identity.organization.replace('{name}', name));
      if (profile.business_description) sections.push(`## About the Organization\n${profile.business_description}`);
      break;
    }
    case 'personal':
      sections.push(t.identity.personal);
      if (profile.business_description) sections.push(`## Context\n${profile.business_description}`);
      break;
    default:
      sections.push(t.identity.default);
      break;
  }

  const audience = buildAudienceSection(profile);
  if (audience) sections.push(audience);
  return sections.join('\n\n');
}

function buildLegacyPrompt(
  profile: ProfileData,
  kbEntries: KBEntry[],
  t: PromptTemplateCache,
  channelOverrides?: ChannelOverrides,
  onSection?: OnSectionCallback,
): string {
  const parts: string[] = [];

  const track = (name: string, content: string) => {
    parts.push(content);
    onSection?.({ name, content });
  };

  // Identity
  track('Identity', buildLegacyIdentitySection(profile, t));

  // Communication style
  const styleRules: string[] = [];
  if (profile.tone && t.tone[profile.tone]) styleRules.push(t.tone[profile.tone]);
  if (profile.response_length && t.length[profile.response_length]) styleRules.push(t.length[profile.response_length]);
  if (profile.emoji_usage && t.emoji[profile.emoji_usage]) styleRules.push(t.emoji[profile.emoji_usage]);
  if (profile.language_preference) {
    if (profile.language_preference === 'match_customer') {
      styleRules.push(t.language.match_customer);
    } else {
      styleRules.push(t.language.specific.replace('{language}', profile.language_preference));
    }
  }
  if (styleRules.length > 0) track('CommunicationStyle', `## Communication Style\n${styleRules.join('\n')}`);

  if (profile.response_rules) track('ResponseGuidelines', `## Response Guidelines\n${profile.response_rules}`);
  if (profile.topics_to_avoid) track('TopicsToAvoid', `## Topics to Avoid\n${t.topicsToAvoidPrefix}\n${profile.topics_to_avoid}`);
  if (profile.escalation_rules) track('EscalationGuidelines', `## Escalation Guidelines\n${profile.escalation_rules}`);
  if (profile.greeting_message) track('FirstContactGreeting', `## First Contact Greeting\n${t.greeting.replace('{greeting_message}', profile.greeting_message)}`);

  const kb = buildKBSection(kbEntries, t);
  if (kb) track('KBContext', kb);

  if (channelOverrides?.custom_instructions) {
    track('ChannelInstructions', `## Channel-Specific Instructions\n${channelOverrides.custom_instructions}`);
  }

  track('CoreRules', t.coreRules);
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

export async function buildClassificationPrompt(profile: ProfileData): Promise<string | null> {
  const flow = profile.response_flow;
  if (!flow || flow.scenarios.length === 0) return null;

  const t = await getPromptTemplates();

  const businessCtx = profile.business_name
    ? ` for ${profile.business_name}${profile.business_type ? ` (${profile.business_type})` : ''}`
    : '';

  const scenarioList = flow.scenarios
    .map((sc, i) => `${i + 1}. "${sc.label}" — ${sc.detection_criteria}`)
    .join('\n');

  return t.classifier
    .replace('{business_context}', businessCtx)
    .replace('{scenario_list}', scenarioList);
}

// ── Targeted response prompt (single matched scenario) ──

export async function buildScenarioResponsePrompt(
  profile: ProfileData,
  kbEntries: KBEntry[],
  matchedScenarioLabel: string | null,
  channelOverrides?: ChannelOverrides,
  onSection?: OnSectionCallback,
): Promise<string> {
  const t = await getPromptTemplates();
  const flow = profile.response_flow!;
  const parts: string[] = [];

  const track = (name: string, content: string) => {
    parts.push(content);
    onSection?.({ name, content });
  };

  // Identity
  track('Identity', buildIdentitySection(profile, t));

  // Language
  const lang = buildLanguageSection(profile, t);
  if (lang) track('Language', lang);

  // Greeting
  if (flow.greeting_message) {
    track('FirstContactGreeting', `## First Contact Greeting\n${t.greeting.replace('{greeting_message}', flow.greeting_message)}`);
  }

  // General response rules
  if (flow.response_rules) {
    track('ResponseGuidelines', `## Response Guidelines\n${flow.response_rules}`);
  }

  // Topics to avoid
  if (flow.topics_to_avoid) {
    track('TopicsToAvoid', `## Topics to Avoid\n${t.topicsToAvoidPrefix}\n${flow.topics_to_avoid}`);
  }

  // Find matched scenario
  const matchedScenario = matchedScenarioLabel
    ? flow.scenarios.find((sc) => sc.label === matchedScenarioLabel)
    : null;

  if (matchedScenario) {
    // Resolved style (scenario overrides + defaults)
    const resolved = resolveScenarioStyle(matchedScenario, flow.default_style);
    const styleDesc = formatStyleDescription(resolved, t);
    if (styleDesc) track('CommunicationStyle', `## Communication Style\n${styleDesc}`);

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

    track('ActiveScenario', scenarioLines.join('\n'));
  } else {
    // No scenario matched — use default style + fallback behavior
    const styleDesc = formatStyleDescription(flow.default_style, t);
    if (styleDesc) track('CommunicationStyle', `## Communication Style\n${styleDesc}`);

    if (flow.fallback_mode === 'human_handle') {
      const fallbackMsg = flow.human_phone
        ? t.scenario.fallback_human_phone.replace('{human_phone}', flow.human_phone)
        : t.scenario.fallback_human_followup;
      track('FallbackBehavior', `## Important\n${fallbackMsg}`);
    }

    // Fallback KB attachments
    if (flow.fallback_kb_attachments && flow.fallback_kb_attachments.length > 0) {
      const fallbackEntries: KBEntry[] = [];
      for (const att of flow.fallback_kb_attachments) {
        fallbackEntries.push(...kbEntries.filter((e) => e.knowledge_base_id === att.kb_id));
      }
      const kb = buildKBSection(fallbackEntries, t);
      if (kb) track('KBContext', kb);
    }
  }

  // Channel-specific instructions
  if (channelOverrides?.custom_instructions) {
    track('ChannelInstructions', `## Channel-Specific Instructions\n${channelOverrides.custom_instructions}`);
  }

  // Core rules
  track('CoreRules', t.coreRules);

  return parts.join('\n\n');
}

// ── Public API ──────────────────────────────────────

export async function buildSystemPrompt(
  profile: ProfileData,
  kbEntries: KBEntry[] = [],
  channelOverrides?: ChannelOverrides,
  onSection?: OnSectionCallback,
): Promise<string> {
  const t = await getPromptTemplates();
  // New scenario-based flow
  if (profile.response_flow) {
    return buildResponseFlowPrompt(profile, kbEntries, t, channelOverrides, onSection);
  }
  // Legacy flat fields
  return buildLegacyPrompt(profile, kbEntries, t, channelOverrides, onSection);
}
