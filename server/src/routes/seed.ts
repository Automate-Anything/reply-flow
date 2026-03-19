import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(requireAuth);

// POST /api/seed — insert dummy conversations into the inbox
router.post('/', async (req, res) => {
  try {
    const companyId = req.companyId!;
    const userId = req.userId!;

    // Ensure a WhatsApp channel exists
    const { data: existingChannels } = await supabaseAdmin
      .from('channels')
      .select('id')
      .eq('company_id', companyId)
      .limit(1);

    if (!existingChannels || existingChannels.length === 0) {
      await supabaseAdmin
        .from('channels')
        .insert({
          user_id: userId,
          company_id: companyId,
          channel_id: 'demo-channel',
          channel_token: 'demo-token',
          channel_name: 'Demo WhatsApp',
          channel_status: 'connected',
          phone_number: '+18455550100',
        });
    } else {
      await supabaseAdmin
        .from('channels')
        .update({ phone_number: '+18455550100', channel_status: 'connected' })
        .eq('id', existingChannels[0].id);
    }

    const now = new Date();
    const mins = (n: number) => new Date(now.getTime() - n * 60_000).toISOString();
    const hours = (n: number) => new Date(now.getTime() - n * 3600_000).toISOString();
    const days = (n: number) => new Date(now.getTime() - n * 86400_000).toISOString();

    const contacts = [
      { phone: '+972501234567', first_name: 'Sarah', last_name: 'Cohen', whatsapp_name: 'Sarah Cohen', email: 'sarah@example.com', company: 'TechStart Ltd' },
      { phone: '+972529876543', first_name: 'David', last_name: 'Levi', whatsapp_name: 'David L', email: 'david.levi@gmail.com', company: null },
      { phone: '+14155551234', first_name: 'Emily', last_name: 'Chen', whatsapp_name: 'Emily ✨', email: 'emily.chen@acme.com', company: 'Acme Corp' },
      { phone: '+447700900123', first_name: 'James', last_name: 'Wilson', whatsapp_name: 'James W', email: null, company: 'Wilson & Sons' },
      { phone: '+972541112222', first_name: 'Maya', last_name: 'Goldstein', whatsapp_name: 'Maya G 🌸', email: 'maya@designstudio.io', company: 'Design Studio' },
      { phone: '+14085559999', first_name: 'Alex', last_name: 'Rodriguez', whatsapp_name: 'Alex R', email: 'alex@startup.io', company: 'Startup.io' },
      { phone: '+18455551234', first_name: 'Noa', last_name: 'Shapira', whatsapp_name: 'Noa', email: 'noa.shapira@mail.com', company: null },
      { phone: '+61412345678', first_name: 'Liam', last_name: "O'Brien", whatsapp_name: 'Liam OB', email: 'liam@downunder.au', company: 'DownUnder Tech' },
    ];

    const conversations = [
      {
        contact_idx: 0, phone: '+972501234567', contact_name: 'Sarah Cohen',
        status: 'open', priority: 'medium', is_starred: false,
        messages: [
          { body: "Hi! I saw your product online and I'm interested in the business plan. Can you tell me more about pricing?", direction: 'inbound', sender: 'contact', time: hours(2), read: true },
          { body: 'Hello Sarah! Thanks for reaching out. Our business plan starts at $49/month and includes up to 5 team members, unlimited conversations, and priority support.', direction: 'outbound', sender: 'ai', time: hours(1.9), read: true },
          { body: 'Yes please! Also, do you have an annual plan with a discount?', direction: 'inbound', sender: 'contact', time: hours(1.5), read: true },
          { body: "Absolutely! With annual billing you get 20% off — $39/month billed annually. I can also set up a free trial if you'd like.", direction: 'outbound', sender: 'ai', time: hours(1.4), read: true },
          { body: 'That sounds great. Let me discuss with my team. One more question — do you integrate with Salesforce?', direction: 'inbound', sender: 'contact', time: mins(45), read: false },
        ],
      },
      {
        contact_idx: 1, phone: '+972529876543', contact_name: 'David Levi',
        status: 'resolved', priority: 'high', is_starred: false,
        messages: [
          { body: "I can't log into my account. I keep getting invalid credentials but I'm sure my password is correct", direction: 'inbound', sender: 'contact', time: days(1), read: true },
          { body: "Hi David, I'm sorry to hear that. Can you confirm the email address you're using to log in?", direction: 'outbound', sender: 'human', time: hours(23), read: true },
          { body: 'david.levi@gmail.com', direction: 'inbound', sender: 'contact', time: hours(22.5), read: true },
          { body: "I found the issue — your account was temporarily locked. I've unlocked it now. Please try again.", direction: 'outbound', sender: 'human', time: hours(22), read: true },
          { body: 'It works now! Thank you so much 🙏', direction: 'inbound', sender: 'contact', time: hours(21.5), read: true },
          { body: "You're welcome! Don't hesitate to reach out if you need anything else.", direction: 'outbound', sender: 'human', time: hours(21), read: true },
        ],
      },
      {
        contact_idx: 2, phone: '+14155551234', contact_name: 'Emily Chen',
        status: 'open', priority: 'none', is_starred: true,
        messages: [
          { body: "Hey there! We're evaluating your platform. Does your API support webhooks for real-time message delivery?", direction: 'inbound', sender: 'contact', time: mins(30), read: false },
          { body: "Also, what's your rate limit on the API? We process about 10k messages per day", direction: 'inbound', sender: 'contact', time: mins(28), read: false },
        ],
      },
      {
        contact_idx: 3, phone: '+447700900123', contact_name: 'James Wilson',
        status: 'pending', priority: 'urgent', is_starred: true,
        messages: [
          { body: 'I was charged twice for my subscription this month. Order #WS-4892 and #WS-4893. Please refund ASAP.', direction: 'inbound', sender: 'contact', time: hours(5), read: true },
          { body: "Hi James, I apologize for the inconvenience. I've initiated a refund — it should reflect in 3-5 business days.", direction: 'outbound', sender: 'human', time: hours(4.5), read: true },
          { body: 'Thanks. Can you send me a confirmation email for the refund?', direction: 'inbound', sender: 'contact', time: hours(4), read: false },
        ],
      },
      {
        contact_idx: 4, phone: '+972541112222', contact_name: 'Maya Goldstein',
        status: 'open', priority: 'low', is_starred: false,
        messages: [
          { body: "Hi! I'm Maya from Design Studio. We spoke last week about the rebranding project.", direction: 'inbound', sender: 'contact', time: days(3), read: true },
          { body: 'Hi Maya! Yes, I remember. How can I help you today?', direction: 'outbound', sender: 'human', time: days(3), read: true },
          { body: "I've finalized the mood board and color palette. WhatsApp or email for files?", direction: 'inbound', sender: 'contact', time: days(3), read: true },
          { body: 'WhatsApp is fine for a preview, but please also email high-res files to projects@company.com.', direction: 'outbound', sender: 'human', time: days(2.9), read: true },
          { body: "We're thinking Inter or Plus Jakarta Sans. Any preference?", direction: 'inbound', sender: 'contact', time: days(2), read: true },
          { body: 'We prefer Inter for readability and multilingual support.', direction: 'outbound', sender: 'human', time: days(1.9), read: true },
          { body: "Good point! I'll go with Inter. Expect the first draft by end of this week 🎨", direction: 'inbound', sender: 'contact', time: days(1.5), read: true },
          { body: 'Looking forward to it!', direction: 'outbound', sender: 'human', time: days(1.5), read: true },
          { body: 'Quick update — the draft is almost ready. Should be done by tomorrow morning', direction: 'inbound', sender: 'contact', time: hours(6), read: false },
        ],
      },
      {
        contact_idx: 5, phone: '+14085559999', contact_name: 'Alex Rodriguez',
        status: 'open', priority: 'none', is_starred: false,
        messages: [
          { body: 'What are your business hours?', direction: 'inbound', sender: 'contact', time: hours(8), read: true },
          { body: 'Our team is available Sunday through Thursday, 9 AM to 6 PM (IST). For urgent matters, email support@company.com.', direction: 'outbound', sender: 'ai', time: hours(7.9), read: true },
          { body: 'Do you offer phone support?', direction: 'inbound', sender: 'contact', time: hours(7.5), read: true },
          { body: 'Phone support is available on our Enterprise plan. Would you like to learn more?', direction: 'outbound', sender: 'ai', time: hours(7.4), read: true },
          { body: 'No thanks. Can I add multiple users to my account?', direction: 'inbound', sender: 'contact', time: hours(3), read: true },
          { body: 'Yes! Starter supports 3 users, Business 10, and Enterprise unlimited. Manage from Settings > Team.', direction: 'outbound', sender: 'ai', time: hours(2.9), read: true },
        ],
      },
      {
        contact_idx: 6, phone: '+18455551234', contact_name: 'Noa Shapira',
        status: 'open', priority: 'none', is_starred: false,
        messages: [
          { body: "Hi, I'd like to learn more about your service", direction: 'inbound', sender: 'contact', time: mins(10), read: false },
        ],
      },
      {
        contact_idx: 7, phone: '+61412345678', contact_name: "Liam O'Brien",
        status: 'closed', priority: 'none', is_starred: false,
        messages: [
          { body: "G'day! Does your platform support Australian phone numbers?", direction: 'inbound', sender: 'contact', time: days(7), read: true },
          { body: 'Yes, we fully support Australian numbers (+61). Would you like help setting it up?', direction: 'outbound', sender: 'ai', time: days(7), read: true },
          { body: "Brilliant, cheers! I'll set it up this arvo", direction: 'inbound', sender: 'contact', time: days(6.9), read: true },
          { body: 'Feel free to reach out anytime. Welcome aboard! 🎉', direction: 'outbound', sender: 'ai', time: days(6.9), read: true },
          { body: 'All set up, works like a charm. Thanks mate!', direction: 'inbound', sender: 'contact', time: days(5), read: true },
        ],
      },
    ];

    const { data, error } = await supabaseAdmin.rpc('seed_demo_data', {
      p_company_id: companyId,
      p_user_id: userId,
      p_contacts: contacts,
      p_conversations: conversations,
    });

    if (error) throw error;

    res.json({ success: true, created: data });
  } catch (err: any) {
    console.error('Seed error:', err);
    res.status(500).json({ error: err.message || 'Seed failed', details: err.details || err.hint || null });
  }
});

export default router;
