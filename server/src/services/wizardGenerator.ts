import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import type { ProfileData } from './promptBuilder.js';
import { sanitizeProfileData } from './conversationLogAnalyzer.js';

const anthropic = env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  : null;

const RESPONSE_MODEL = 'claude-sonnet-4-20250514';

export interface WizardInput {
  business_name: string;
  business_type: string;
  business_description: string;
  common_questions: string;
  instructions: string;
  tone: 'professional' | 'friendly' | 'casual' | 'formal';
  response_length: 'concise' | 'moderate' | 'detailed';
  emoji_usage: 'none' | 'minimal' | 'moderate';
  escalation_triggers: string[];
  escalation_custom?: string;
}

const SYSTEM_PROMPT = `You are an expert at configuring AI customer service agents for WhatsApp businesses.

You will receive structured information about a business collected from a setup wizard. Use this information to generate a complete agent configuration with smart, practical scenarios.

Return a JSON object with this EXACT structure:

{
  "name": "<string> A short agent name based on the business, e.g. 'Acme Support Agent'",
  "profile_data": {
    "use_case": "business",
    "business_name": "<string> The business name provided",
    "business_type": "<string> The business type provided",
    "business_description": "<string> The description provided",
    "language_preference": "match_customer",
    "response_flow": {
      "default_style": {
        "tone": "<string> Use the tone provided by the user",
        "response_length": "<string> Use the response length provided by the user",
        "emoji_usage": "<string> Use the emoji usage provided by the user"
      },
      "scenarios": [
        {
          "id": "<string> Generate a unique UUID v4",
          "label": "<string> Short name, e.g. 'Product Inquiry'",
          "detection_criteria": "<string> When this scenario activates",
          "goal": "<string> What the AI should accomplish",
          "instructions": "<string> Step-by-step handling instructions",
          "rules": "<string|null> Rules incorporating the user's instructions",
          "escalation_trigger": "<string|null> When to escalate based on the user's escalation preferences",
          "escalation_message": "<string|null> What to say when escalating"
        }
      ],
      "fallback_mode": "respond_basics"
    }
  }
}

## Generation Instructions

1. **Scenarios**: Generate 3-6 practical scenarios based on the common questions the user described. Each scenario should:
   - Have a clear, specific detection criteria
   - Include actionable instructions for how the AI should respond
   - Incorporate any rules or guidelines from the user's instructions
   - Include escalation triggers where appropriate based on the user's escalation preferences

2. **Instructions as Rules**: Distribute the user's instructions across the relevant scenarios as rules. If an instruction applies broadly, add it to multiple scenarios.

3. **Escalation**: Map the user's escalation preferences to appropriate escalation_trigger and escalation_message fields on scenarios. Common triggers:
   - "angry_customer" → detect frustration, anger, threats
   - "pricing_negotiation" → customer pushes back on price, asks for discounts
   - "unknown_question" → AI doesn't have enough information to answer
   - "human_request" → customer explicitly asks to speak with a human
   - "technical_issue" → complex technical problems
   - "refund_request" → customer wants money back

4. **Style**: Use the exact tone, response_length, and emoji_usage values provided. Do not override per-scenario unless it clearly makes sense (e.g., a complaint scenario might need a more formal tone).

5. **Fallback**: Set to "respond_basics" unless the user's escalation preferences suggest heavy human handoff, in which case use "human_handle".

Return ONLY valid JSON. No markdown fencing, no explanation text, no comments.`;

export async function generateFromWizard(
  input: WizardInput,
): Promise<{ name: string; profile_data: ProfileData }> {
  if (!anthropic) {
    throw Object.assign(new Error('AI service not configured'), { status: 500 });
  }

  const userMessage = buildUserMessage(input);

  const response = await anthropic.messages.create({
    model: RESPONSE_MODEL,
    max_tokens: 4096,
    temperature: 0.3,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw Object.assign(new Error('Failed to generate agent configuration'), { status: 500 });
  }

  let parsed: { name?: string; profile_data?: Record<string, unknown> };
  try {
    let jsonText = textBlock.text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }
    parsed = JSON.parse(jsonText);
  } catch {
    throw Object.assign(new Error('Failed to parse agent configuration'), { status: 500 });
  }

  const profileData = sanitizeProfileData(parsed.profile_data || {});
  const name = typeof parsed.name === 'string' && parsed.name.trim()
    ? parsed.name.trim()
    : `${input.business_name} Agent`;

  return { name, profile_data: profileData };
}

function buildUserMessage(input: WizardInput): string {
  const escalationList = input.escalation_triggers
    .map((t) => `- ${formatTrigger(t)}`)
    .join('\n');

  const customEscalation = input.escalation_custom?.trim()
    ? `\nAdditional escalation rules:\n${input.escalation_custom}`
    : '';

  return `## Business Information
- **Name**: ${input.business_name}
- **Type**: ${input.business_type}
- **Description**: ${input.business_description}

## Common Customer Questions
${input.common_questions}

## Instructions & Guidelines
${input.instructions || 'No specific instructions provided.'}

## Communication Style
- **Tone**: ${input.tone}
- **Response Length**: ${input.response_length}
- **Emoji Usage**: ${input.emoji_usage}

## Escalation Preferences
When should the AI hand off to a human?
${escalationList || '- No specific escalation triggers set'}${customEscalation}`;
}

function formatTrigger(trigger: string): string {
  const labels: Record<string, string> = {
    angry_customer: 'Customer is angry, frustrated, or threatening',
    pricing_negotiation: 'Customer is negotiating pricing or asking for discounts',
    unknown_question: "AI doesn't have enough information to answer",
    human_request: 'Customer explicitly asks to speak with a human',
    technical_issue: 'Complex technical problems or account issues',
    refund_request: 'Customer wants a refund or money back',
  };
  return labels[trigger] || trigger;
}
