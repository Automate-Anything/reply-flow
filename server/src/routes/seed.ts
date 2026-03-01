import { Router } from 'express';
import { randomUUID } from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(requireAuth);

// POST /api/seed — insert dummy conversations into the inbox
router.post('/', async (req, res, next) => {
  try {
    const companyId = req.companyId!;
    const userId = req.userId!;

    // Find an existing channel for this company, or create a dummy one
    let { data: channels } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('id')
      .eq('company_id', companyId)
      .limit(1);

    let channelId: number;

    if (channels && channels.length > 0) {
      channelId = channels[0].id;
    } else {
      // Create a dummy channel
      const { data: ch, error: chErr } = await supabaseAdmin
        .from('whatsapp_channels')
        .insert({
          user_id: userId,
          company_id: companyId,
          channel_id: 'demo-channel',
          channel_token: 'demo-token',
          channel_name: 'Demo WhatsApp',
          channel_status: 'connected',
          phone_number: '+1555000000',
        })
        .select('id')
        .single();
      if (chErr) throw chErr;
      channelId = ch.id;
    }

    // ── Dummy contacts ──
    const contactDefs = [
      { phone: '+972501234567', first: 'Sarah', last: 'Cohen', whatsapp: 'Sarah Cohen', email: 'sarah@example.com', company: 'TechStart Ltd' },
      { phone: '+972529876543', first: 'David', last: 'Levi', whatsapp: 'David L', email: 'david.levi@gmail.com', company: null },
      { phone: '+14155551234', first: 'Emily', last: 'Chen', whatsapp: 'Emily ✨', email: 'emily.chen@acme.com', company: 'Acme Corp' },
      { phone: '+447700900123', first: 'James', last: 'Wilson', whatsapp: 'James W', email: null, company: 'Wilson & Sons' },
      { phone: '+972541112222', first: 'Maya', last: 'Goldstein', whatsapp: 'Maya G 🌸', email: 'maya@designstudio.io', company: 'Design Studio' },
      { phone: '+14085559999', first: 'Alex', last: 'Rodriguez', whatsapp: 'Alex R', email: 'alex@startup.io', company: 'Startup.io' },
      { phone: '+972508887766', first: 'Noa', last: 'Shapira', whatsapp: 'Noa', email: 'noa.shapira@mail.com', company: null },
      { phone: '+61412345678', first: 'Liam', last: 'O\'Brien', whatsapp: 'Liam OB', email: 'liam@downunder.au', company: 'DownUnder Tech' },
    ];

    const contactIds: string[] = [];

    for (const c of contactDefs) {
      const id = randomUUID();
      const { error } = await supabaseAdmin
        .from('contacts')
        .upsert(
          {
            id,
            company_id: companyId,
            user_id: userId,
            created_by: userId,
            phone_number: c.phone,
            first_name: c.first,
            last_name: c.last,
            whatsapp_name: c.whatsapp,
            email: c.email,
            company: c.company,
          },
          { onConflict: 'company_id,phone_number' }
        );
      if (error) throw error;

      // Fetch actual id (upsert may have matched existing)
      const { data: existing } = await supabaseAdmin
        .from('contacts')
        .select('id')
        .eq('company_id', companyId)
        .eq('phone_number', c.phone)
        .single();
      contactIds.push(existing!.id);
    }

    // ── Conversations with messages ──
    const now = new Date();
    const mins = (n: number) => new Date(now.getTime() - n * 60_000).toISOString();
    const hours = (n: number) => new Date(now.getTime() - n * 3600_000).toISOString();
    const days = (n: number) => new Date(now.getTime() - n * 86400_000).toISOString();

    interface MsgDef {
      body: string;
      direction: 'inbound' | 'outbound';
      sender: 'contact' | 'human' | 'ai';
      time: string;
      read?: boolean;
    }

    interface ConvDef {
      contactIdx: number;
      status: string;
      priority: string;
      starred: boolean;
      messages: MsgDef[];
    }

    const conversations: ConvDef[] = [
      // 1. Active support conversation — Sarah asking about pricing
      {
        contactIdx: 0,
        status: 'open',
        priority: 'medium',
        starred: false,
        messages: [
          { body: 'Hi! I saw your product online and I\'m interested in the business plan. Can you tell me more about pricing?', direction: 'inbound', sender: 'contact', time: hours(2) },
          { body: 'Hello Sarah! Thanks for reaching out. Our business plan starts at $49/month and includes up to 5 team members, unlimited conversations, and priority support. Would you like me to send you a detailed breakdown?', direction: 'outbound', sender: 'ai', time: hours(1.9) },
          { body: 'Yes please! Also, do you have an annual plan with a discount?', direction: 'inbound', sender: 'contact', time: hours(1.5) },
          { body: 'Absolutely! With annual billing you get 20% off, so the business plan comes to $39/month billed annually. I can also set up a free trial if you\'d like to test it out first.', direction: 'outbound', sender: 'ai', time: hours(1.4) },
          { body: 'That sounds great. Let me discuss with my team and get back to you. One more question — do you integrate with Salesforce?', direction: 'inbound', sender: 'contact', time: mins(45), read: false },
        ],
      },
      // 2. Resolved conversation — David had a login issue
      {
        contactIdx: 1,
        status: 'resolved',
        priority: 'high',
        starred: false,
        messages: [
          { body: 'I can\'t log into my account. I keep getting "invalid credentials" but I\'m sure my password is correct', direction: 'inbound', sender: 'contact', time: days(1) },
          { body: 'Hi David, I\'m sorry to hear that. Let me look into your account. Can you confirm the email address you\'re using to log in?', direction: 'outbound', sender: 'human', time: hours(23) },
          { body: 'david.levi@gmail.com', direction: 'inbound', sender: 'contact', time: hours(22.5) },
          { body: 'I found the issue — your account was temporarily locked due to multiple failed login attempts. I\'ve unlocked it now. Please try logging in again and let me know if it works.', direction: 'outbound', sender: 'human', time: hours(22) },
          { body: 'It works now! Thank you so much for the quick help 🙏', direction: 'inbound', sender: 'contact', time: hours(21.5) },
          { body: 'You\'re welcome! Happy to help. Don\'t hesitate to reach out if you need anything else.', direction: 'outbound', sender: 'human', time: hours(21) },
        ],
      },
      // 3. New unread conversation — Emily asking about API
      {
        contactIdx: 2,
        status: 'open',
        priority: 'none',
        starred: true,
        messages: [
          { body: 'Hey there! We\'re evaluating your platform for our company. Does your API support webhooks for real-time message delivery?', direction: 'inbound', sender: 'contact', time: mins(30), read: false },
          { body: 'Also, what\'s your rate limit on the API? We process about 10k messages per day', direction: 'inbound', sender: 'contact', time: mins(28), read: false },
        ],
      },
      // 4. Pending conversation — James with a billing issue
      {
        contactIdx: 3,
        status: 'pending',
        priority: 'urgent',
        starred: true,
        messages: [
          { body: 'I was charged twice for my subscription this month. Order #WS-4892 and #WS-4893. Please refund the duplicate charge ASAP.', direction: 'inbound', sender: 'contact', time: hours(5) },
          { body: 'Hi James, I sincerely apologize for the inconvenience. I can see the duplicate charge on your account. I\'ve initiated a refund for the extra charge — it should reflect in 3-5 business days. I\'ll also flag this with our billing team to prevent it from happening again.', direction: 'outbound', sender: 'human', time: hours(4.5) },
          { body: 'Thanks. Can you send me a confirmation email for the refund?', direction: 'inbound', sender: 'contact', time: hours(4), read: false },
        ],
      },
      // 5. Long conversation — Maya discussing a design project
      {
        contactIdx: 4,
        status: 'open',
        priority: 'low',
        starred: false,
        messages: [
          { body: 'Hi! I\'m Maya from Design Studio. We spoke last week about the rebranding project.', direction: 'inbound', sender: 'contact', time: days(3) },
          { body: 'Hi Maya! Yes, I remember. How can I help you today?', direction: 'outbound', sender: 'human', time: days(3) },
          { body: 'I\'ve finalized the mood board and color palette. Can I send the files over WhatsApp or do you prefer email?', direction: 'inbound', sender: 'contact', time: days(3) },
          { body: 'WhatsApp is fine for a preview, but please also email the high-res files to projects@company.com so we have them on record.', direction: 'outbound', sender: 'human', time: days(2.9) },
          { body: 'Perfect, I\'ll send both. Also, we\'re thinking of going with a sans-serif font family — either Inter or Plus Jakarta Sans. Any preference?', direction: 'inbound', sender: 'contact', time: days(2) },
          { body: 'We generally prefer Inter for its readability across platforms. Plus Jakarta Sans is beautiful too but Inter has better multilingual support which might be important for us.', direction: 'outbound', sender: 'human', time: days(1.9) },
          { body: 'Good point! I\'ll go with Inter then. Expect the first draft by end of this week 🎨', direction: 'inbound', sender: 'contact', time: days(1.5) },
          { body: 'Looking forward to it!', direction: 'outbound', sender: 'human', time: days(1.5) },
          { body: 'Quick update — the draft is almost ready. I just need to finalize the icon set. Should be done by tomorrow morning', direction: 'inbound', sender: 'contact', time: hours(6), read: false },
        ],
      },
      // 6. AI-handled conversation — Alex asking general questions
      {
        contactIdx: 5,
        status: 'open',
        priority: 'none',
        starred: false,
        messages: [
          { body: 'What are your business hours?', direction: 'inbound', sender: 'contact', time: hours(8) },
          { body: 'Our team is available Sunday through Thursday, 9:00 AM to 6:00 PM (IST). For urgent matters outside business hours, you can reach us via email at support@company.com and we\'ll get back to you first thing in the morning.', direction: 'outbound', sender: 'ai', time: hours(7.9) },
          { body: 'Do you offer phone support?', direction: 'inbound', sender: 'contact', time: hours(7.5) },
          { body: 'Currently we provide support through WhatsApp and email. Phone support is available on our Enterprise plan. Would you like to learn more about our Enterprise offering?', direction: 'outbound', sender: 'ai', time: hours(7.4) },
          { body: 'No thanks, WhatsApp works fine for now. One more thing — can I add multiple users to my account?', direction: 'inbound', sender: 'contact', time: hours(3) },
          { body: 'Yes! Depending on your plan, you can add team members to your account. The Starter plan supports up to 3 users, Business supports up to 10, and Enterprise has unlimited seats. You can manage team members from Settings > Team in your dashboard.', direction: 'outbound', sender: 'ai', time: hours(2.9) },
        ],
      },
      // 7. Short new conversation — Noa just said hi
      {
        contactIdx: 6,
        status: 'open',
        priority: 'none',
        starred: false,
        messages: [
          { body: 'שלום, אני מעוניינת לשמוע על השירות שלכם', direction: 'inbound', sender: 'contact', time: mins(10), read: false },
        ],
      },
      // 8. Closed old conversation — Liam from Australia
      {
        contactIdx: 7,
        status: 'closed',
        priority: 'none',
        starred: false,
        messages: [
          { body: 'G\'day! Quick question — does your platform support Australian phone numbers?', direction: 'inbound', sender: 'contact', time: days(7) },
          { body: 'Hello Liam! Yes, we fully support Australian phone numbers (+61). You can connect your Australian WhatsApp Business number right away. Would you like help setting it up?', direction: 'outbound', sender: 'ai', time: days(7) },
          { body: 'That\'s brilliant, cheers! I\'ll set it up this arvo and let you know if I run into any trouble', direction: 'inbound', sender: 'contact', time: days(6.9) },
          { body: 'Sounds good! Feel free to reach out anytime if you need help with the setup. Welcome aboard! 🎉', direction: 'outbound', sender: 'ai', time: days(6.9) },
          { body: 'All set up, works like a charm. Thanks for the help mate!', direction: 'inbound', sender: 'contact', time: days(5) },
        ],
      },
    ];

    const createdSessions: string[] = [];

    for (const conv of conversations) {
      const contact = contactDefs[conv.contactIdx];
      const contactId = contactIds[conv.contactIdx];
      const chatId = `${contact.phone.replace('+', '')}@s.whatsapp.net`;
      const lastMsg = conv.messages[conv.messages.length - 1];
      const sessionId = randomUUID();

      // Upsert chat session
      const { error: sessErr } = await supabaseAdmin
        .from('chat_sessions')
        .upsert(
          {
            id: sessionId,
            company_id: companyId,
            user_id: userId,
            channel_id: channelId,
            contact_id: contactId,
            chat_id: chatId,
            phone_number: contact.phone,
            contact_name: `${contact.first} ${contact.last}`,
            status: conv.status,
            priority: conv.priority,
            is_starred: conv.starred,
            is_archived: false,
            last_message: lastMsg.body,
            last_message_at: lastMsg.time,
            last_message_direction: lastMsg.direction,
            last_message_sender: lastMsg.sender,
            human_takeover: false,
            marked_unread: false,
          },
          { onConflict: 'channel_id,chat_id' }
        );
      if (sessErr) throw sessErr;

      // Re-fetch in case of conflict (get the actual session id)
      const { data: actualSession } = await supabaseAdmin
        .from('chat_sessions')
        .select('id')
        .eq('channel_id', channelId)
        .eq('chat_id', chatId)
        .single();

      const actualSessionId = actualSession!.id;
      createdSessions.push(actualSessionId);

      // Insert messages
      const msgRows = conv.messages.map((m) => ({
        id: randomUUID(),
        session_id: actualSessionId,
        company_id: companyId,
        user_id: userId,
        message_body: m.body,
        message_type: 'text',
        message_id_normalized: `demo_${randomUUID().slice(0, 8)}`,
        direction: m.direction,
        sender_type: m.sender,
        status: m.direction === 'outbound' ? 'sent' : 'received',
        read: m.read !== undefined ? m.read : true,
        message_ts: m.time,
        created_at: m.time,
      }));

      const { error: msgErr } = await supabaseAdmin
        .from('chat_messages')
        .insert(msgRows);
      if (msgErr) throw msgErr;
    }

    res.json({
      success: true,
      created: {
        contacts: contactIds.length,
        conversations: createdSessions.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
