import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import { apiLimiter, webhookLimiter, sendLimiter } from './middleware/rateLimit.js';
import { sanitizeBody } from './middleware/sanitize.js';
import whatsappRouter from './routes/whatsapp.js';
import webhookRouter from './routes/webhook.js';
import messagesRouter from './routes/messages.js';
import conversationsRouter from './routes/conversations.js';
import labelsRouter from './routes/labels.js';
import contactsRouter from './routes/contacts.js';
import contactNotesRouter from './routes/contactNotes.js';
import aiRouter from './routes/ai.js';
import agentsRouter from './routes/agents.js';
import teamRouter from './routes/team.js';
import companyRouter from './routes/company.js';
import rolesRouter from './routes/roles.js';
import meRouter from './routes/me.js';
import superAdminRouter from './routes/superAdmin.js';

import contactImportExportRouter from './routes/contactImportExport.js';
import contactTagsRouter from './routes/contactTags.js';
import contactListsRouter from './routes/contactLists.js';
import customFieldsRouter from './routes/customFields.js';
import conversationNotesRouter from './routes/conversationNotes.js';
import conversationStatusesRouter from './routes/conversationStatuses.js';
import conversationPrioritiesRouter from './routes/conversationPriorities.js';
import cannedResponsesRouter from './routes/cannedResponses.js';
import billingRouter, { stripeWebhookHandler } from './routes/billing.js';
import accessRouter from './routes/access.js';
import autoAssignRouter from './routes/autoAssign.js';
import notificationsRouter from './routes/notifications.js';
import groupsRouter from './routes/groups.js';
import holidaysRouter from './routes/holidays.js';
import teamAvailabilityRouter from './routes/teamAvailability.js';
import affiliateAuthRouter from './routes/affiliateAuth.js';
import affiliatePortalRouter from './routes/affiliatePortal.js';
import affiliateAdminRouter from './routes/affiliateAdmin.js';
import classificationRouter from './routes/classification.js';
import complianceRouter from './routes/compliance.js';
import gmailRouter from './routes/gmail.js';
import { handleGoogleCallback } from './routes/gmail.js';
import gmailWebhookRouter from './routes/gmailWebhook.js';
import { startScheduler } from './services/scheduler.js';
import { startAvailabilityScheduler } from './services/availabilityScheduler.js';
import { startPayoutScheduler } from './cron/affiliatePayouts.js';
import { startGmailWatchCron } from './services/gmailWatchCron.js';

const app = express();
app.set('trust proxy', 1);

const allowedClientOrigins = new Set(
  [env.CLIENT_URL, process.env.CLIENT_URL]
    .filter((value): value is string => Boolean(value))
);

const isAllowedDevOrigin = (origin: string) => {
  try {
    const url = new URL(origin);
    return ['localhost', '127.0.0.1'].includes(url.hostname);
  } catch {
    return false;
  }
};

app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (allowedClientOrigins.has(origin) || isAllowedDevOrigin(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
}));

// Stripe webhook must receive the raw body for signature verification —
// register it BEFORE express.json() parses the body.
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);

app.use(express.json({ limit: '12mb' }));

// Whapi webhook must receive the raw parsed JSON without sanitization —
// register it BEFORE sanitizeBody so link_preview payloads aren't modified.
app.use('/api/channels/whatsapp/webhook', webhookLimiter, webhookRouter);

// Gmail Pub/Sub webhook — no auth, registered before sanitizeBody
app.use('/api/webhooks/gmail', webhookLimiter, gmailWebhookRouter);

app.use(sanitizeBody);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Google OAuth callback — no auth middleware (user is redirected here from Google)
app.get('/api/auth/google/callback', handleGoogleCallback);

// Apply general rate limit to all other API routes
app.use('/api', apiLimiter);

app.use('/api/channels/whatsapp', whatsappRouter);
app.use('/api/messages/send', sendLimiter);
app.use('/api/messages/schedule', sendLimiter);
app.use('/api/messages', messagesRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/labels', labelsRouter);
app.use('/api/contacts', contactImportExportRouter);
app.use('/api/contacts', contactsRouter);
app.use('/api/contact-notes', contactNotesRouter);
app.use('/api/contact-tags', contactTagsRouter);
app.use('/api/contact-lists', contactListsRouter);
app.use('/api/custom-fields', customFieldsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/team', teamRouter);
app.use('/api/company', companyRouter);
app.use('/api/roles', rolesRouter);
app.use('/api/me', meRouter);
app.use('/api/super-admin', superAdminRouter);

app.use('/api/conversation-notes', conversationNotesRouter);
app.use('/api/conversation-statuses', conversationStatusesRouter);
app.use('/api/conversation-priorities', conversationPrioritiesRouter);
app.use('/api/canned-responses', cannedResponsesRouter);
app.use('/api/billing', billingRouter);
app.use('/api/access', accessRouter);
app.use('/api/auto-assign', autoAssignRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/holidays', holidaysRouter);
app.use('/api/team/availability', teamAvailabilityRouter);
app.use('/api/affiliate/admin', affiliateAdminRouter);
app.use('/api/affiliate', affiliateAuthRouter);
app.use('/api/affiliate', affiliatePortalRouter);
app.use('/api/classification', classificationRouter);
app.use('/api/compliance', complianceRouter);
app.use('/api/channels/gmail', gmailRouter);

app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`Server running on port ${env.PORT} (smart-kb)`);
  startScheduler();
  startAvailabilityScheduler();
  startPayoutScheduler();
  if (env.GOOGLE_CLIENT_ID) {
    startGmailWatchCron();
  }
});

export default app;
