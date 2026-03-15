# GEMINI.md

## Cross-Sync Rule (MANDATORY)

This project maintains parallel instruction files for different AI tools: `CLAUDE.md`, `AGENTS.md`, and `GEMINI.md`. Whenever you add, modify, or remove a rule in THIS file, you MUST ask the user: **"Do you want me to apply this change to the other instruction files too? (CLAUDE.md, AGENTS.md)"**. Do not silently sync — always ask first.

## Summarizing Work

- If a SQL migration file was created, include a clickable link to it and remind the user to run the migration.

## Project-Specific Pre-Code Checks

In addition to the global pre-code checklist, always:

- Review migrations in `supabase/migrations/` — confirm tables/columns exist before writing queries
- Check RLS policies if the feature involves multi-tenant data access
- To inspect the **live Supabase schema**, use `pg_dump` (see below)

## Project-Specific Build & Verify

- **Build**: `npm run build` (builds both client and server)
- **Dev**: `npm run dev` (Vite :5173 + Express :3000)

## Inspecting Live Supabase Schema (MANDATORY)

Whenever the user asks for the "Supabase schema", "database schema", "database details", or anything related to the current state of the database, you MUST return the **complete** schema — not a summary. This includes:
- Tables, columns, and column types (with defaults and nullability)
- Primary keys, foreign keys, and unique constraints
- Indexes (including vector/ivfflat/hnsw indexes)
- RLS policies (with full USING/WITH CHECK expressions)
- Row-level security enabled status
- Functions and triggers
- Enums and custom types
- Extensions (pgvector, pgcrypto, etc.)
- Storage buckets and storage policies
- Views
- Grants and ACLs

**Command** — use `pg_dump` with the DB connection string from `server/.env`:

```bash
source server/.env && pg_dump --schema-only --schema=public "$SUPABASE_DB_URL"
```

If `pg_dump` is not available on the system PATH, check for it at `~/scoop/apps/postgresql/current/bin/pg_dump.exe` or install it.

Show the full `pg_dump` output to the user — do NOT summarize or abbreviate it. If the user wants a summary, they will ask for one.

For other schemas (e.g., storage, auth), change `--schema=public` accordingly.
