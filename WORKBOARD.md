# Workboard

## Active Work
- **Quick Setup Wizard for AI agents** — Claude — Started 2026-03-13. Status: active.
  Files: server/src/services/wizardGenerator.ts, server/src/routes/agents.ts, client/src/components/agents/QuickSetupWizardDialog.tsx, client/src/hooks/useAgents.ts, client/src/pages/AIAgentsPage.tsx.
  Branch: feature/quick-setup-wizard.
- **Fix self-sent messages showing as unread** — Claude — Started 2026-03-12. Files: server/src/services/messageProcessor.ts. Branch: fix-outbound-unread.
- **Gmail Channel Integration — Planning** — Claude — Started 2026-03-16. Status: active.
  Files: plans/2026-03-16-gmail-channel-integration.md. Branch: feat/gmail-channel-integration (not yet created).
  Depends on: none.
## Completed
- **Group Chat Criteria Alerts** — Claude — Completed 2026-03-17. Branch: feat/group-chat-criteria-alerts. Merged: no (pending push).
  Files modified: server/src/routes/groups.ts, server/src/routes/webhook.ts, server/src/services/groupCriteriaService.ts, server/src/services/groupMessageProcessor.ts, server/src/services/notificationService.ts, server/src/types/index.ts, server/src/index.ts, client/src/pages/GroupsPage.tsx, client/src/components/groups/*.tsx, client/src/hooks/useGroup*.ts, client/src/components/layout/Sidebar.tsx, client/src/components/layout/NotificationBell.tsx, client/src/App.tsx, supabase/migrations/063_group_chat_criteria.sql.
- **Company Branding (logo + color scheme)** — Claude — Completed 2026-03-16. Branch: feat/company-branding. Merged: yes.
  Logo upload to Supabase Storage, brand color picker (presets + custom hex), full-theme OKLCH hue rotation (all CSS variables), sidebar dynamic logo/name. Migration: 062_company_branding.sql.
- **Contact Detail v2 — Full Redesign** — Claude — Completed 2026-03-15. Branch: main. Merged: yes.
  Overview tab (stats + recent activity), Conversations tab (inline message viewer), Notes tab (CRUD), Memories editing, backend extensions.
- **Task 14: Clean up old access control code + migration 060** — Claude — Completed 2026-03-15. Branch: feature/access-permissions-redesign. Merged: no.
- **Handoff notifications (Tasks 6-7)** — Claude — Completed 2026-03-15. Branch: main. Merged: yes.
- **Labels & Quick Replies Visibility + Auto-Assign + Notifications** — Claude — Completed 2026-03-15. Branch: feature/labels-autoassign-notifications. Merged: yes.
- **Contact list membership in edit contact form** — Claude — Completed 2026-03-15. Branch: feature/contact-list-membership-in-form. Merged: yes.
- **Remove demo data and seed button** — Claude — Completed 2026-03-13. Branch: remove-demo-data. Merged: no.
