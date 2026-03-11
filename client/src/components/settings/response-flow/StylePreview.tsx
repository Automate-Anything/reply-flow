import type { CommunicationStyle } from '@/hooks/useCompanyAI';

const PREVIEW_MESSAGES: Record<string, Record<string, string>> = {
  tone: {
    professional: "Thank you for reaching out. I'd be happy to assist you with that.",
    friendly: "Hey there! Great to hear from you — let me help with that!",
    casual: "Sure thing! Let me look into that for you real quick.",
    formal: "Good day. I shall be pleased to assist you with your inquiry.",
  },
  response_length: {
    concise: "Your order ships tomorrow.",
    moderate: "Your order is confirmed and scheduled to ship tomorrow. You'll receive a tracking number by email.",
    detailed: "Your order is confirmed and scheduled to ship tomorrow morning via express delivery. You'll receive a tracking number by email once it's dispatched. Delivery typically takes 2-3 business days.",
  },
  emoji_usage: {
    none: '',
    minimal: ' 👋',
    moderate: ' 😊🎉',
  },
};

function generatePreview(style: CommunicationStyle): string {
  const tone = style.tone || 'friendly';
  const length = style.response_length || 'moderate';
  const emoji = style.emoji_usage || 'minimal';

  const greeting = PREVIEW_MESSAGES.tone[tone] || PREVIEW_MESSAGES.tone.friendly;
  const detail = PREVIEW_MESSAGES.response_length[length] || '';
  const emojiSuffix = PREVIEW_MESSAGES.emoji_usage[emoji] || '';

  // Build a realistic preview combining all three
  if (length === 'concise') {
    return `${greeting}${emojiSuffix}`;
  }
  return `${greeting}${emojiSuffix}\n\n${detail}`;
}

export default function StylePreview({ style }: { style: CommunicationStyle }) {
  const preview = generatePreview(style);

  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Preview</p>
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2 text-primary-foreground">
          <p className="text-sm whitespace-pre-line">{preview}</p>
        </div>
      </div>
    </div>
  );
}
