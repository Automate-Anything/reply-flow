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
  title: string;
  content: string;
}

// ── Shared constants ────────────────────────────────

const TONE_DESCRIPTIONS: Record<string, string> = {
  professional: 'Maintain a professional, polished tone. Be respectful and business-appropriate.',
  friendly: 'Be warm, approachable, and personable. Use a conversational but helpful tone.',
  casual: 'Keep things relaxed and informal. Use everyday language and be easygoing.',
  formal: 'Use formal language and proper etiquette. Be courteous and dignified.',
};

const LENGTH_DESCRIPTIONS: Record<string, string> = {
  concise: 'Keep responses short and to the point. Aim for 1-3 sentences when possible.',
  moderate: 'Provide clear, balanced responses. Use enough detail to be helpful without being verbose.',
  detailed: 'Give thorough, comprehensive responses. Include relevant details and explanations.',
};

const EMOJI_DESCRIPTIONS: Record<string, string> = {
  none: 'Do not use emojis in your responses.',
  minimal: 'Use emojis sparingly, only when they add warmth or clarity.',
  moderate: 'Feel free to use emojis to add personality and friendliness.',
};

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
  return `## Knowledge Base\nUse the following reference information to answer questions accurately. If a question isn't covered by this information, say so honestly.\n\n${kbSection}`;
}

const CORE_RULES = `## Core Rules
- You are chatting via WhatsApp. Keep messages appropriate for mobile messaging.
- Never reveal that you are an AI unless directly asked.
- If you don't know the answer to something, be honest about it rather than making up information.
- Never share sensitive business information like internal processes, pricing strategies, or employee details unless explicitly covered in the knowledge base.
- If a conversation requires human attention (complaints, complex issues, urgent matters), politely let the customer know that a team member will follow up.`;

// ── New: Scenario-based prompt builder ──────────────

function formatStyleDescription(style: CommunicationStyle): string {
  const parts: string[] = [];
  if (style.tone && TONE_DESCRIPTIONS[style.tone]) parts.push(TONE_DESCRIPTIONS[style.tone]);
  if (style.response_length && LENGTH_DESCRIPTIONS[style.response_length]) parts.push(LENGTH_DESCRIPTIONS[style.response_length]);
  if (style.emoji_usage && EMOJI_DESCRIPTIONS[style.emoji_usage]) parts.push(EMOJI_DESCRIPTIONS[style.emoji_usage]);
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

function buildScenariosSection(flow: ResponseFlow): string | null {
  if (flow.scenarios.length === 0) return null;

  const scenarioBlocks = flow.scenarios.map((sc) => {
    const resolved = resolveScenarioStyle(sc, flow.default_style);
    const lines: string[] = [];
    lines.push(`### ${sc.label}`);
    lines.push(`**Detect**: ${sc.detection_criteria}`);
    if (sc.goal) lines.push(`**Goal**: ${sc.goal}`);
    lines.push(`**Style**: ${formatStyleBrief(resolved)}`);
    if (sc.instructions) lines.push(`**Instructions**:\n${sc.instructions}`);
    if (sc.context) lines.push(`**Key Information**:\n${sc.context}`);
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
  const styleDesc = formatStyleDescription(flow.default_style);
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

  // Scenarios
  const scenarios = buildScenariosSection(flow);
  if (scenarios) parts.push(scenarios);

  // Knowledge base
  const kb = buildKBSection(kbEntries);
  if (kb) parts.push(kb);

  // Channel-specific instructions
  if (channelOverrides?.custom_instructions) {
    parts.push(`## Channel-Specific Instructions\n${channelOverrides.custom_instructions}`);
  }

  // Core rules
  parts.push(CORE_RULES);

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
  if (profile.tone && TONE_DESCRIPTIONS[profile.tone]) styleRules.push(TONE_DESCRIPTIONS[profile.tone]);
  if (profile.response_length && LENGTH_DESCRIPTIONS[profile.response_length]) styleRules.push(LENGTH_DESCRIPTIONS[profile.response_length]);
  if (profile.emoji_usage && EMOJI_DESCRIPTIONS[profile.emoji_usage]) styleRules.push(EMOJI_DESCRIPTIONS[profile.emoji_usage]);
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

  parts.push(CORE_RULES);
  return parts.join('\n\n');
}

// ── Public API ──────────────────────────────────────

export interface ChannelOverrides {
  custom_instructions?: string;
}

export function buildSystemPrompt(
  profile: ProfileData,
  kbEntries: KBEntry[] = [],
  channelOverrides?: ChannelOverrides,
): string {
  // New scenario-based flow
  if (profile.response_flow) {
    return buildResponseFlowPrompt(profile, kbEntries, channelOverrides);
  }
  // Legacy flat fields
  return buildLegacyPrompt(profile, kbEntries, channelOverrides);
}
