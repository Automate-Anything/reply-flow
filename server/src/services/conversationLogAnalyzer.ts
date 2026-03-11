import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { processDocument } from './documentProcessor.js';
import type { ProfileData, Scenario } from './promptBuilder.js';
import crypto from 'crypto';

const anthropic = env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  : null;

const RESPONSE_MODEL = 'claude-sonnet-4-20250514';
const MAX_COMBINED_CHARS = 180_000;
const MIN_TEXT_CHARS = 200;

const SYSTEM_PROMPT = `You are an expert at analyzing customer conversation logs and configuring AI customer service agents.

You will receive raw conversation logs from a business's customer interactions. Analyze these conversations carefully to understand how the business communicates with customers, what topics come up, and how different situations are handled.

Return a JSON object with this EXACT structure. Every field is explained below.

{
  "name": "<string> A short suggested agent name, e.g. 'Acme Support Agent'",
  "profile_data": {
    "use_case": "business",
    "business_name": "<string|null> The company/business name. Extract from conversations if mentioned.",
    "business_type": "<string|null> The type/industry of business, e.g. 'E-commerce', 'Restaurant', 'SaaS', 'Real Estate'. Infer from conversation topics.",
    "business_description": "<string|null> A 1-3 sentence description of what this business does, based on the conversations. What products/services do they offer? Who are their customers?",
    "language_preference": "<REQUIRED> Either 'match_customer' (if conversations are in multiple languages) or a specific language like 'English', 'Spanish', 'Hebrew'. Set to the primary language used in the logs.",
    "response_flow": {
      "default_style": {
        "tone": "<REQUIRED> One of: 'professional', 'friendly', 'casual', 'formal'. Analyze the business's actual tone in the conversations.",
        "response_length": "<REQUIRED> One of: 'concise', 'moderate', 'detailed'. Based on how long the business's replies typically are.",
        "emoji_usage": "<REQUIRED> One of: 'none', 'minimal', 'moderate'. Based on whether/how much the business uses emojis."
      },
      "scenarios": [
        {
          "id": "<string> Generate a unique UUID v4 for each scenario",
          "label": "<REQUIRED string> Short name for this scenario, e.g. 'Product Inquiry', 'Complaint Handling', 'Order Status'",
          "detection_criteria": "<REQUIRED string> When should this scenario activate? Describe the customer message patterns. Example: 'Customer asks about product features, availability, specifications, or comparisons'",
          "goal": "<string|null> What should the AI try to accomplish in this scenario? Example: 'Provide accurate product information and guide toward a purchase decision'",
          "instructions": "<string|null> Step-by-step instructions for handling this scenario, based on how the business handles it in the logs. Example: '1. Acknowledge the customer\\'s interest\\n2. Provide relevant product details\\n3. Mention current promotions if applicable\\n4. Ask if they\\'d like to place an order'",
          "rules": "<string|null> Specific rules or restrictions for this scenario. Example: 'Never quote exact prices without checking the latest price list. Always mention the return policy when discussing purchases.'",
          "example_response": "<string|null> A real or representative example response from the conversations that shows the ideal tone and style for this scenario.",
          "escalation_trigger": "<string|null> When should this scenario escalate to a human? Example: 'Customer is angry, requests a refund over $100, or asks to speak with a manager'",
          "escalation_message": "<string|null> What to say when escalating. Example: 'I understand your concern. Let me connect you with a team member who can help you further.'",
          "tone": "<optional> Override the default tone for this scenario. One of: 'professional', 'friendly', 'casual', 'formal'. Only set if this scenario needs a different tone than the default.",
          "response_length": "<optional> Override. One of: 'concise', 'moderate', 'detailed'. Only set if different from default.",
          "emoji_usage": "<optional> Override. One of: 'none', 'minimal', 'moderate'. Only set if different from default."
        }
      ],
      "fallback_mode": "<REQUIRED> One of: 'respond_basics' (AI handles unmatched messages with general knowledge) or 'human_handle' (hand off to human for unmatched). Set to 'respond_basics' unless conversations show heavy human-escalation patterns."
    }
  }
}

## Analysis Instructions

1. **Identity**: Look for the business name, what they sell/do, and their industry. If not explicitly mentioned, infer from context.
2. **Communication Style**: Analyze the BUSINESS's messages (not the customer's). Look at tone, message length, emoji usage, and formality level.
3. **Scenarios**: Identify the 3-8 most common/important conversation patterns. For each one:
   - What triggers it (customer asks about X)
   - How the business typically responds
   - Any rules or patterns they follow
   - When they escalate to a human
   - Include a real example response if possible
4. **Language**: What language(s) are the conversations in?

## Important Rules

- Only include fields you can confidently infer from the conversations. Set optional fields to null if uncertain.
- Do NOT include kb_attachments or fallback_kb_attachments fields (these reference knowledge bases that don't exist yet).
- Do NOT include deprecated fields: response_rules (on scenario), escalation_rules (on scenario), audiences, target_audience, greeting_message, response_rules (on response_flow), topics_to_avoid.
- Scenario style overrides (tone/response_length/emoji_usage) should only be set when a scenario clearly needs a DIFFERENT style than the default.
- Return ONLY valid JSON. No markdown fencing, no explanation text, no comments.`;

// ── Valid enum values for validation ─────────────────

const VALID_USE_CASES = new Set(['business']);
const VALID_TONES = new Set(['professional', 'friendly', 'casual', 'formal']);
const VALID_LENGTHS = new Set(['concise', 'moderate', 'detailed']);
const VALID_EMOJIS = new Set(['none', 'minimal', 'moderate']);
const VALID_FALLBACK_MODES = new Set(['respond_basics', 'human_handle']);

// ── Main export ──────────────────────────────────────

export async function analyzeConversationLogs(
  files: Array<{ buffer: Buffer; originalname: string; mimetype: string }>
): Promise<{ name: string; profile_data: ProfileData }> {
  if (!anthropic) {
    throw Object.assign(new Error('AI service not configured'), { status: 500 });
  }
  if (!files || files.length === 0) {
    throw Object.assign(new Error('Please upload at least one file'), { status: 400 });
  }

  // 1. Extract text from each file
  const textParts: string[] = [];
  const errors: string[] = [];

  for (const file of files) {
    try {
      const result = await processDocument(file.buffer, file.originalname, file.mimetype);
      if (result.cleanedText && result.cleanedText.trim().length > 0) {
        textParts.push(`=== File: ${file.originalname} ===\n${result.cleanedText}`);
      }
    } catch (err) {
      errors.push(file.originalname);
      console.warn(`Failed to extract text from ${file.originalname}:`, err);
    }
  }

  if (textParts.length === 0) {
    const detail = errors.length > 0
      ? ` Failed files: ${errors.join(', ')}`
      : '';
    throw Object.assign(
      new Error(`Could not extract text from the uploaded files.${detail}`),
      { status: 400 },
    );
  }

  // 2. Combine and truncate
  let combinedText = textParts.join('\n\n');
  if (combinedText.length > MAX_COMBINED_CHARS) {
    const truncatedChars = combinedText.length - MAX_COMBINED_CHARS;
    combinedText =
      combinedText.slice(0, MAX_COMBINED_CHARS) +
      `\n\n[Content truncated — ${truncatedChars.toLocaleString()} more characters not included]`;
  }

  if (combinedText.length < MIN_TEXT_CHARS) {
    throw Object.assign(
      new Error('Not enough conversation content found in the uploaded files. Please upload files with more conversation data.'),
      { status: 400 },
    );
  }

  // 3. Call Claude
  const response = await anthropic.messages.create({
    model: RESPONSE_MODEL,
    max_tokens: 4096,
    temperature: 0.3,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Analyze these conversation logs and generate an agent configuration:\n\n${combinedText}`,
      },
    ],
  });

  // 4. Parse response
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw Object.assign(new Error('Failed to generate agent configuration. Please try again.'), { status: 500 });
  }

  let parsed: { name?: string; profile_data?: Record<string, unknown> };
  try {
    // Strip markdown fencing if present
    let jsonText = textBlock.text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }
    parsed = JSON.parse(jsonText);
  } catch {
    throw Object.assign(new Error('Failed to parse agent configuration. Please try again.'), { status: 500 });
  }

  // 5. Validate and sanitize
  const profileData = sanitizeProfileData(parsed.profile_data || {});
  const name = typeof parsed.name === 'string' && parsed.name.trim()
    ? parsed.name.trim()
    : 'New Agent';

  return { name, profile_data: profileData };
}

// ── Sanitization / validation ────────────────────────

function sanitizeProfileData(raw: Record<string, unknown>): ProfileData {
  const pd: ProfileData = {};

  // Identity
  if (typeof raw.use_case === 'string' && VALID_USE_CASES.has(raw.use_case)) {
    pd.use_case = raw.use_case as ProfileData['use_case'];
  }
  if (typeof raw.business_name === 'string' && raw.business_name.trim()) {
    pd.business_name = raw.business_name.trim();
  }
  if (typeof raw.business_type === 'string' && raw.business_type.trim()) {
    pd.business_type = raw.business_type.trim();
  }
  if (typeof raw.business_description === 'string' && raw.business_description.trim()) {
    pd.business_description = raw.business_description.trim();
  }

  // Language
  if (typeof raw.language_preference === 'string' && raw.language_preference.trim()) {
    pd.language_preference = raw.language_preference.trim();
  }

  // Response flow
  if (raw.response_flow && typeof raw.response_flow === 'object') {
    pd.response_flow = sanitizeResponseFlow(raw.response_flow as Record<string, unknown>);
  }

  return pd;
}

function sanitizeResponseFlow(raw: Record<string, unknown>) {
  const rf: ProfileData['response_flow'] = {
    default_style: sanitizeStyle((raw.default_style as Record<string, unknown>) || {}),
    scenarios: [],
    fallback_mode: VALID_FALLBACK_MODES.has(raw.fallback_mode as string)
      ? (raw.fallback_mode as 'respond_basics' | 'human_handle')
      : 'respond_basics',
  };

  // Scenarios
  if (Array.isArray(raw.scenarios)) {
    rf!.scenarios = raw.scenarios
      .filter((s): s is Record<string, unknown> => s && typeof s === 'object')
      .map(sanitizeScenario)
      .filter((s) => s.label && s.detection_criteria);
  }

  return rf!;
}

function sanitizeStyle(raw: Record<string, unknown>) {
  return {
    tone: (VALID_TONES.has(raw.tone as string) ? raw.tone : 'friendly') as 'professional' | 'friendly' | 'casual' | 'formal',
    response_length: (VALID_LENGTHS.has(raw.response_length as string) ? raw.response_length : 'moderate') as 'concise' | 'moderate' | 'detailed',
    emoji_usage: (VALID_EMOJIS.has(raw.emoji_usage as string) ? raw.emoji_usage : 'minimal') as 'none' | 'minimal' | 'moderate',
  };
}

function sanitizeScenario(raw: Record<string, unknown>): Scenario {
  const scenario: Scenario = {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : crypto.randomUUID(),
    label: typeof raw.label === 'string' ? raw.label.trim() : '',
    detection_criteria: typeof raw.detection_criteria === 'string' ? raw.detection_criteria.trim() : '',
  };

  if (typeof raw.do_not_respond === 'boolean') scenario.do_not_respond = raw.do_not_respond;

  // Optional string fields
  if (typeof raw.goal === 'string' && raw.goal.trim()) scenario.goal = raw.goal.trim();
  if (typeof raw.instructions === 'string' && raw.instructions.trim()) scenario.instructions = raw.instructions.trim();
  if (typeof raw.rules === 'string' && raw.rules.trim()) scenario.rules = raw.rules.trim();
  if (typeof raw.example_response === 'string' && raw.example_response.trim()) scenario.example_response = raw.example_response.trim();
  if (typeof raw.escalation_trigger === 'string' && raw.escalation_trigger.trim()) scenario.escalation_trigger = raw.escalation_trigger.trim();
  if (typeof raw.escalation_message === 'string' && raw.escalation_message.trim()) scenario.escalation_message = raw.escalation_message.trim();

  // Optional style overrides
  if (VALID_TONES.has(raw.tone as string)) scenario.tone = raw.tone as Scenario['tone'];
  if (VALID_LENGTHS.has(raw.response_length as string)) scenario.response_length = raw.response_length as Scenario['response_length'];
  if (VALID_EMOJIS.has(raw.emoji_usage as string)) scenario.emoji_usage = raw.emoji_usage as Scenario['emoji_usage'];

  return scenario;
}
