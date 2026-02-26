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
import teamRouter from './routes/team.js';
import companyRouter from './routes/company.js';
import rolesRouter from './routes/roles.js';
import meRouter from './routes/me.js';

const app = express();
app.set('trust proxy', 1);

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? [process.env.CLIENT_URL || ''].filter(Boolean)
    : true,
  credentials: true,
}));
app.use(express.json({ limit: '12mb' }));
app.use(sanitizeBody);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Webhook has its own rate limit (no auth, higher threshold)
app.use('/api/whatsapp/webhook', webhookLimiter, webhookRouter);

// Apply general rate limit to all other API routes
app.use('/api', apiLimiter);

app.use('/api/whatsapp', whatsappRouter);
app.use('/api/messages', sendLimiter, messagesRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/labels', labelsRouter);
app.use('/api/contacts', contactsRouter);
app.use('/api/contact-notes', contactNotesRouter);
app.use('/api/ai', aiRouter);
app.use('/api/team', teamRouter);
app.use('/api/company', companyRouter);
app.use('/api/roles', rolesRouter);
app.use('/api/me', meRouter);

app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`Server running on port ${env.PORT}`);
});

export default app;
