export interface ProfileData {
  use_case?: 'business' | 'personal' | 'organization';
  business_name?: string;
  business_type?: string;
  business_description?: string;
  target_audience?: string;
  tone?: 'professional' | 'friendly' | 'casual' | 'formal';
  language_preference?: 'match_customer' | string;
  response_length?: 'concise' | 'moderate' | 'detailed';
  response_rules?: string;
  greeting_message?: string;
}

export interface KBEntry {
  title: string;
  content: string;
}

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

function buildBusinessPrompt(profile: ProfileData): string {
  const sections: string[] = [];

  const name = profile.business_name || 'the business';
  sections.push(`You are an AI assistant for ${name}. You help manage WhatsApp conversations on behalf of this business.`);

  if (profile.business_description) {
    sections.push(`## About the Business\n${profile.business_description}`);
  }

  if (profile.business_type) {
    sections.push(`## Industry\nThis is a ${profile.business_type} business.`);
  }

  if (profile.target_audience) {
    sections.push(`## Target Audience\n${profile.target_audience}`);
  }

  return sections.join('\n\n');
}

function buildPersonalPrompt(profile: ProfileData): string {
  const sections: string[] = [];

  sections.push('You are a personal AI assistant managing WhatsApp conversations.');

  if (profile.business_description) {
    sections.push(`## Context\n${profile.business_description}`);
  }

  return sections.join('\n\n');
}

function buildOrganizationPrompt(profile: ProfileData): string {
  const sections: string[] = [];

  const name = profile.business_name || 'the organization';
  sections.push(`You are an AI assistant for ${name}. You help manage WhatsApp conversations on behalf of this organization.`);

  if (profile.business_description) {
    sections.push(`## About the Organization\n${profile.business_description}`);
  }

  if (profile.target_audience) {
    sections.push(`## Audience\n${profile.target_audience}`);
  }

  return sections.join('\n\n');
}

export interface ChannelOverrides {
  custom_instructions?: string;
  greeting_override?: string;
}

export function buildSystemPrompt(
  profile: ProfileData,
  kbEntries: KBEntry[] = [],
  channelOverrides?: ChannelOverrides,
): string {
  const parts: string[] = [];

  // Identity section based on use case
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

  if (profile.tone && TONE_DESCRIPTIONS[profile.tone]) {
    styleRules.push(TONE_DESCRIPTIONS[profile.tone]);
  }

  if (profile.response_length && LENGTH_DESCRIPTIONS[profile.response_length]) {
    styleRules.push(LENGTH_DESCRIPTIONS[profile.response_length]);
  }

  if (profile.language_preference) {
    if (profile.language_preference === 'match_customer') {
      styleRules.push('Always respond in the same language the customer uses.');
    } else {
      styleRules.push(`Respond in ${profile.language_preference}.`);
    }
  }

  if (styleRules.length > 0) {
    parts.push(`## Communication Style\n${styleRules.join('\n')}`);
  }

  // Response rules
  if (profile.response_rules) {
    parts.push(`## Response Guidelines\n${profile.response_rules}`);
  }

  // Greeting (channel override takes precedence)
  const greeting = channelOverrides?.greeting_override || profile.greeting_message;
  if (greeting) {
    parts.push(`## First Contact Greeting\nWhen this is the first message from a new contact, greet them with: "${greeting}"`);
  }

  // Knowledge base
  if (kbEntries.length > 0) {
    const kbSection = kbEntries
      .map((entry) => `### ${entry.title}\n${entry.content}`)
      .join('\n\n---\n\n');
    parts.push(`## Knowledge Base\nUse the following reference information to answer questions accurately. If a question isn't covered by this information, say so honestly.\n\n${kbSection}`);
  }

  // Channel-specific instructions
  if (channelOverrides?.custom_instructions) {
    parts.push(`## Channel-Specific Instructions\n${channelOverrides.custom_instructions}`);
  }

  // Core behavioral rules (always included)
  parts.push(`## Core Rules
- You are chatting via WhatsApp. Keep messages appropriate for mobile messaging.
- Never reveal that you are an AI unless directly asked.
- If you don't know the answer to something, be honest about it rather than making up information.
- Never share sensitive business information like internal processes, pricing strategies, or employee details unless explicitly covered in the knowledge base.
- If a conversation requires human attention (complaints, complex issues, urgent matters), politely let the customer know that a team member will follow up.`);

  return parts.join('\n\n');
}
