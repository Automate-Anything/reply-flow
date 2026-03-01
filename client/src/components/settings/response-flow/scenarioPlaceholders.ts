export interface PlaceholderSet {
  detection_criteria: string;
  goal: string;
  instructions: string;
  context: string;
  rules: string;
  example_response: string;
  escalation_trigger: string;
  escalation_message: string;
}

type ScenarioType =
  | 'appointment'
  | 'product_inquiry'
  | 'pricing'
  | 'complaint'
  | 'order_status'
  | 'hours_location'
  | 'technical_support'
  | 'returns'
  | 'follow_up'
  | 'general';

function detectScenarioType(label: string): ScenarioType {
  const l = label.toLowerCase();
  if (/book|appointment|schedule|reserv/.test(l)) return 'appointment';
  if (/product|catalog|menu|item|inquir/.test(l)) return 'product_inquiry';
  if (/pric|cost|quote|rate|fee/.test(l)) return 'pricing';
  if (/complaint|issue|problem|unhappy|dissatisfied/.test(l)) return 'complaint';
  if (/order|status|track|ship|deliver/.test(l)) return 'order_status';
  if (/hour|location|address|direction|open|close|where/.test(l)) return 'hours_location';
  if (/tech|support|troubleshoot|bug|error|not working/.test(l)) return 'technical_support';
  if (/return|refund|exchange|money back/.test(l)) return 'returns';
  if (/follow.?up|remind|check.?in/.test(l)) return 'follow_up';
  return 'general';
}

const PLACEHOLDERS: Record<ScenarioType, PlaceholderSet> = {
  appointment: {
    detection_criteria: 'When someone wants to book, reschedule, or cancel an appointment. Includes asking about availability, open slots, or mentioning specific dates and times.',
    goal: 'Help the customer book an appointment by collecting the service, date, and time.',
    instructions: '1. Ask what service they need\n2. Ask for their preferred date and time\n3. Confirm the details and share the booking link',
    context: 'Services: Haircut ($30, 30min), Color ($80, 90min)\nBooking link: calendly.com/your-business\nHours: Mon-Sat 9am-7pm, closed Sundays',
    rules: 'Always confirm the service and time before sharing the booking link. Never promise a specific stylist or provider.',
    example_response: 'Hi! I\'d love to help you book an appointment. What service are you interested in? We offer haircuts, coloring, and more.',
    escalation_trigger: 'Customer wants to reschedule a past appointment, requests a refund, or needs a time outside business hours.',
    escalation_message: 'Let me connect you with our team — they\'ll sort this out for you right away.',
  },
  product_inquiry: {
    detection_criteria: 'When a customer asks about a product or service — features, specs, availability, sizes, colors, or comparisons between items.',
    goal: 'Help the customer find the right product by answering their questions accurately.',
    instructions: '1. Identify which product they\'re asking about\n2. Share relevant details from the product info\n3. If out of stock, suggest similar alternatives\n4. Offer to help with ordering',
    context: 'Product catalog: [list your main products/services with prices]\nAvailability: [how to check stock]\nOrder link: [your store URL]',
    rules: 'Only share information about products you carry. Never make up specs or availability. If unsure, say you\'ll check and follow up.',
    example_response: 'Great question! The Classic Model comes in three sizes (S, M, L) and is available in black and navy. It\'s currently in stock. Would you like to order one?',
    escalation_trigger: 'Customer needs a custom order, wants bulk pricing, or asks about a product you don\'t have information on.',
    escalation_message: 'That\'s a great question — let me get someone from our team who can help with the specifics.',
  },
  pricing: {
    detection_criteria: 'When a customer asks about pricing, costs, packages, plans, quotes, discounts, or payment options.',
    goal: 'Provide clear pricing information and help the customer choose the right option.',
    instructions: '1. Identify what service or product they need pricing for\n2. Share the relevant pricing tiers or rates\n3. Highlight what\'s included in each option\n4. Offer to help them get started',
    context: 'Pricing tiers: [list your plans/packages with prices]\nPayment methods: [accepted payment options]\nDiscounts: [any current offers or loyalty programs]',
    rules: 'Always quote official prices — never invent or round numbers. Don\'t offer discounts unless authorized. Direct custom pricing requests to the team.',
    example_response: 'Our Standard plan is $49/month and includes up to 5 users. The Pro plan is $99/month with unlimited users and priority support. Would either of these work for you?',
    escalation_trigger: 'Customer needs enterprise or custom pricing, wants to negotiate, or asks about payment plans not listed.',
    escalation_message: 'For custom pricing, let me connect you with our sales team — they can put together something that fits your needs.',
  },
  complaint: {
    detection_criteria: 'When a customer expresses dissatisfaction, reports a problem with their experience, or wants to file a complaint. Includes frustration, anger, or requests for a manager.',
    goal: 'Acknowledge the issue, collect details, and work toward a resolution or connect them with the right person.',
    instructions: '1. Acknowledge the issue and apologize sincerely\n2. Ask for specifics: what happened, when, order/reference number\n3. Offer a solution from your available options\n4. If you can\'t resolve it, escalate with full context',
    context: 'Resolution options: [what you can offer — refund, replacement, discount, credit]\nCompensation policy: [what the AI is authorized to offer]\nManager contact: [phone or email for escalation]',
    rules: 'Never be defensive. Always validate the customer\'s feelings first. Don\'t promise anything beyond your authorized resolution options. Never blame the customer.',
    example_response: 'I\'m really sorry to hear about this experience — that\'s definitely not the standard we aim for. Can you tell me a bit more about what happened so I can help make it right?',
    escalation_trigger: 'Customer mentions legal action, demands a full refund beyond policy, asks for a manager by name, or is extremely upset after initial response.',
    escalation_message: 'I completely understand your frustration. Let me get a team member involved right away who has the authority to resolve this for you.',
  },
  order_status: {
    detection_criteria: 'When a customer asks where their order is, wants a tracking update, asks about delivery time, or reports a missing or delayed package.',
    goal: 'Help the customer get the status of their order quickly and set clear expectations.',
    instructions: '1. Ask for their order number or the email they used\n2. Share the current order status\n3. Provide tracking info or estimated delivery date\n4. If there\'s a delay, explain why and what to expect',
    context: 'Order lookup: [how customers can check — e.g., yourstore.com/orders]\nShipping times: Standard 5-7 days, Express 2-3 days\nTracking: [carrier and tracking page URL]',
    rules: 'If you don\'t have order lookup access, direct them to the tracking page. Never guess delivery dates — share only confirmed information.',
    example_response: 'I\'d be happy to check on your order! Could you share your order number? It should be in your confirmation email.',
    escalation_trigger: 'Order is lost, more than 7 days late, or customer reports receiving the wrong item.',
    escalation_message: 'I\'m sorry for the trouble. Let me get our shipping team involved — they\'ll track this down and make sure it\'s resolved.',
  },
  hours_location: {
    detection_criteria: 'When someone asks about your hours, location, address, directions, parking, or whether you\'re currently open.',
    goal: 'Provide accurate hours and location information quickly.',
    instructions: '1. Share the relevant hours based on what they asked\n2. If they ask about location, share the address and directions\n3. Mention parking options if relevant',
    context: 'Address: [your full address]\nHours: Mon-Fri 9am-6pm, Sat 10am-4pm, Sun Closed\nParking: [parking details]\nGoogle Maps: [your maps link]',
    rules: 'Always mention both weekday and weekend hours unless the customer specifies a day. For holiday hours, say you\'ll confirm and follow up.',
    example_response: 'We\'re at 123 Main Street! Our hours are Mon-Fri 9am-6pm and Sat 10am-4pm. There\'s free parking right out front.',
    escalation_trigger: 'Customer needs to book a private event or asks about accessibility accommodations you\'re unsure about.',
    escalation_message: 'Great question! Let me connect you with someone who can give you the full details on that.',
  },
  technical_support: {
    detection_criteria: 'When a customer reports a technical issue — something not working, an error message, a bug, or needs help using a feature.',
    goal: 'Help the customer resolve their technical issue through troubleshooting steps.',
    instructions: '1. Ask them to describe the issue and any error messages\n2. Ask what device/browser/version they\'re using\n3. Walk through the relevant troubleshooting steps\n4. If unresolved after 2 attempts, escalate with the details collected',
    context: 'Common fixes: [list your top troubleshooting steps]\nStatus page: [link to system status]\nDocumentation: [link to help docs]\nSupported browsers/devices: [list]',
    rules: 'Always ask for the error message or screenshot before suggesting fixes. Don\'t assume the customer\'s technical level — explain steps clearly.',
    example_response: 'I\'m sorry you\'re running into that! Can you tell me what error message you\'re seeing, and which browser you\'re using? That\'ll help me point you in the right direction.',
    escalation_trigger: 'Issue involves data loss, security concerns, account access, or persists after 2 troubleshooting attempts.',
    escalation_message: 'This looks like it needs our technical team to take a closer look. Let me get them involved — they\'ll have access to the tools needed to fix this.',
  },
  returns: {
    detection_criteria: 'When a customer wants to return a product, request a refund, exchange an item, or report a defective or wrong item received.',
    goal: 'Guide the customer through the return process and set clear expectations.',
    instructions: '1. Ask for the order number\n2. Ask what the issue is (wrong item, defective, changed mind)\n3. Explain the return process and timeline\n4. Provide the return portal link if eligible',
    context: 'Return policy: 30 days from delivery, items must be unused\nReturn portal: [your returns URL]\nRefund timeline: 5-7 business days after we receive the item\nNon-returnable items: [list any exceptions]',
    rules: 'Never promise a refund before verifying eligibility. Always mention the return window. If the item is non-returnable, explain why politely.',
    example_response: 'I\'m sorry to hear that! I can definitely help with your return. Could you share your order number so I can look into it?',
    escalation_trigger: 'Customer claims fraud, wants to dispute a charge, or the return is past the return window and they\'re unhappy.',
    escalation_message: 'I understand your frustration. Let me get a team member involved who can review your case personally.',
  },
  follow_up: {
    detection_criteria: 'When a customer follows up on a previous conversation, checks on a pending request, or asks for an update on something that was promised.',
    goal: 'Provide an update on the customer\'s pending issue and set expectations for next steps.',
    instructions: '1. Ask for context about their previous request\n2. Check if there\'s an update available\n3. If resolved, confirm the resolution\n4. If still pending, give a timeline and next steps',
    context: 'Typical resolution times: [e.g., 24-48 hours for support tickets]\nHow to check ticket status: [link or instructions]',
    rules: 'Never dismiss a follow-up — the customer has already waited. Acknowledge their patience. If no update is available, give a realistic timeline.',
    example_response: 'Thanks for following up! Can you share the reference number or details from your previous conversation so I can check on the status for you?',
    escalation_trigger: 'Customer has followed up more than twice without resolution, or the issue has been open longer than the promised timeline.',
    escalation_message: 'I apologize for the delay. Let me escalate this to make sure it gets resolved today.',
  },
  general: {
    detection_criteria: 'Describe when this scenario should activate. What types of messages or questions should trigger it?',
    goal: 'What should the AI accomplish when this scenario is triggered?',
    instructions: '1. What should the AI do first?\n2. What information should it provide or collect?\n3. How should it wrap up the conversation?',
    context: 'List any relevant information the AI needs to reference:\n- Links, prices, policies, hours, contact info\n- Product/service details\n- Key facts or data',
    rules: 'What must the AI always do or never do in this scenario?',
    example_response: 'Write an example of an ideal AI response for this scenario.',
    escalation_trigger: 'Under what conditions should the AI hand off to a human?',
    escalation_message: 'What should the AI say when handing off to a human?',
  },
};

export function getPlaceholders(label: string): PlaceholderSet {
  const type = detectScenarioType(label);
  return PLACEHOLDERS[type];
}
