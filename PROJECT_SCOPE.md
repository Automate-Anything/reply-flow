# Reply Flow — Project Scope

## Structure

```
reply-flow/
├── client/                    # React frontend (Vite)
│   └── src/
│       ├── components/        # UI components by domain
│       │   ├── ui/            # Radix + shadcn primitives
│       │   ├── layout/        # AppLayout, Sidebar, Header
│       │   ├── auth/          # ProtectedRoute, PermissionGate, PlanGate
│       │   ├── inbox/         # Chat UI (filters, messages, contact panel)
│       │   ├── contacts/      # Contact CRUD, import, dedup, tags
│       │   ├── agents/        # AI agent components
│       │   ├── settings/      # Channel, company, role settings
│       │   └── access/        # Access control UI
│       ├── contexts/          # SessionContext, PlanContext, FormGuardContext
│       ├── hooks/             # 24+ custom data-fetching hooks
│       ├── pages/             # 18+ route pages
│       └── lib/               # api.ts, supabase.ts, timezone.ts
├── server/                    # Express backend (Node.js)
│   └── src/
│       ├── routes/            # 24 API routers
│       ├── services/          # 18 business logic services
│       ├── middleware/        # auth, permissions, rateLimit, sanitize
│       ├── config/            # env validation (Zod), supabase admin client
│       └── types/             # TypeScript interfaces
├── supabase/
│   └── migrations/            # 49 numbered migration files (002–049)
├── plans/                     # Implementation plans
└── render.yaml                # Render deployment config
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript 5.9 + Vite 7.3 |
| UI | Radix UI + shadcn + Tailwind CSS 4.2 |
| Routing | react-router-dom 7 |
| HTTP Client | Axios 1.13 |
| Backend | Express 5.2 + TypeScript 5.9 (tsx runner) |
| Database | Supabase (Postgres + RLS + Realtime) |
| AI | Anthropic SDK 0.78 + OpenAI SDK 4.103 |
| Payments | Stripe SDK 20.4 |
| File Processing | multer, pdf-parse, mammoth (docx), xlsx |
| Validation | Zod 4.3 (server) |
| Icons | Lucide React |
| Toast | sonner |
| Drag & Drop | @dnd-kit |
| Hosting | Render |
| Package Manager | npm workspaces (root + client + server) |

## Key Database Tables

- `companies` — multi-tenant orgs (name, slug, logo, timezone)
- `profiles` — user profiles (full_name, avatar_url, email)
- `company_members` — user → company membership with roles
- `roles` / `role_permissions` — RBAC (resource, action, hierarchy_level)
- `invitations` — token-based team invites
- `contacts` — CRM contacts (phone, name, email, company, tags, custom fields)
- `contact_lists` — contact groupings
- `custom_field_definitions` — dynamic contact fields
- `chat_sessions` — WhatsApp conversations (contact_id FK)
- `chat_messages` — individual messages
- `conversation_statuses` / `conversation_priorities` — custom status/priority types
- `labels` — message labels/tags
- `scheduled_messages` — delayed send queue
- `canned_responses` — pre-written message templates
- `ai_agents` — reusable AI agent configs
- `ai_profiles` — AI agent configs per channel
- `knowledge_bases` — RAG document collections (embeddings)
- `billing_subscriptions` — Stripe subscriptions
- `media_storage`, `session_boundaries`, `activity_logs`

## Project Structure Conventions

- One component per file, PascalCase naming (e.g., `ContactList.tsx`)
- Radix UI primitives in `client/src/components/ui/` — use existing before creating custom
- API calls via `api.get()` / `api.post()` from `client/src/lib/api.ts`
- Hooks return `{ data, loading, error, refetch }` pattern
- Contexts at top level in App.tsx: `SessionProvider > PlanProvider > AppLayout`
- Server routes: `router.use(requireAuth)` then `requirePermission('resource', 'action')`
- All DB queries via `supabaseAdmin.from('table')...` — no raw SQL
- Multi-tenant isolation: every query filters by `company_id`
- Soft deletes via `is_deleted` or `deleted_at`
- Permissions: `resource.action` granular model; owner role short-circuits all checks
- Plan gating: `<PlanGate>` wrapper or `usePlan().hasActivePlan` for subscription checks

## Code Style Rules

- Use existing UI components from `client/src/components/ui/` before creating custom ones
- Use Supabase SDK for all DB queries — no raw SQL outside migrations
- Use Zod for server-side input validation
- Toast notifications via `sonner` — `toast.success()` / `toast.error()`
- Use `useSession().hasPermission(resource, action)` or `<PermissionGate>` for access control
- Use `<PlanGate>` or `usePlan()` for subscription gating

## Documentation Guide

| Document | Purpose | When to Read |
|----------|---------|-------------|
| `plans/phase-*.md` | Task breakdowns, schemas, acceptance criteria | Primary reference — read before any work |

## Hub Files (Parallel Agent Coordination)

These files are modified by nearly every feature. When running parallel agents, handle these centrally:

- `client/src/App.tsx` — router + providers; all new pages added here
- `client/src/contexts/SessionContext.tsx` — auth, user, permissions, company
- `client/src/components/layout/AppLayout.tsx` — main layout shell
- `client/src/lib/api.ts` — Axios instance + auth headers
- `server/src/index.ts` — Express app init; all routes registered here
- `server/src/middleware/auth.ts` — JWT validation + company ID
- `server/src/config/supabase.ts` — Supabase admin client
- `server/src/types/index.ts` — core TypeScript interfaces

## Migration File Naming

Migrations in `supabase/migrations/` are numbered sequentially (currently up to 049).
When running parallel agents with DB migrations, each agent must use a unique prefix to avoid collisions.

## Dev Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Run client (Vite :5173) + server (Express :3000) concurrently |
| `npm run build` | Build both client and server to dist/ |
| `npm run start` | Run compiled server |
