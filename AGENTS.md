# AGENTS.md

## Cross-Sync Rule (MANDATORY)

This project maintains parallel instruction files for different AI tools: `CLAUDE.md`, `AGENTS.md`, and `GEMINI.md`. Whenever you add, modify, or remove a rule in THIS file, you MUST ask the user: **"Do you want me to apply this change to the other instruction files too? (CLAUDE.md, GEMINI.md)"**. Do not silently sync — always ask first.

## Documentation Guide

| Document | Purpose | When to Read |
|----------|---------|-------------|
| `plans/phase-*.md` | **How to build** — task breakdowns, file structure, schemas, acceptance criteria, implementation order | **Primary reference.** Read the relevant phase plan FIRST before any work. |

## Communication Style

### Thinking Out Loud
- While thinking through a problem, write out your reasoning and thought process so the user can follow along and course-correct early if needed.

### Planning
- When presenting plans, make them user-friendly and detailed:
  - Explain what will change in plain language so a non-technical stakeholder could understand.
  - Include important technical details: which files are being changed, added, or removed.
  - Call out any database changes (migrations, schema changes, new tables/columns, etc.).
  - Highlight any breaking changes or things that need manual steps (env vars, deployments, etc.).

### Summarizing Work
- After completing a task, provide a user-friendly summary of what was done.
- Include important technical details alongside the summary: files changed, new dependencies, database migrations, API changes, etc.
- If a SQL migration file was created, include a clickable link to it and remind the user to run the migration.

## Problem-Solving Approach (MANDATORY)

**Prefer proper solutions over workarounds.** Always use the right tool for the job rather than hacking around limitations. If a proper approach requires installing a safe, standard tool or dependency (e.g., `psql`, a CLI utility, an npm package), install it rather than writing a fragile workaround. Workarounds accumulate tech debt — proper solutions don't.

When unsure how to implement something, follow this process strictly:

1. **Brainstorm options** — Come up with a few possible approaches before writing any code. Briefly list them and evaluate trade-offs.
2. **Pick the most likely** — Choose the approach that seems most likely to work and try it.
3. **If it fails, understand why** — Do NOT blindly try the next option. Diagnose the root cause of the failure first.
4. **Undo before retrying** — Revert all incorrect or partial changes from the failed attempt before trying a different approach. Do not leave broken or dead code behind from failed experiments.
5. **Try the next option** — Only after cleaning up, move on to the next most likely approach. Repeat steps 3-5 as needed.

Never stack failed attempts on top of each other. Each retry should start from a clean state. However, it is fine to explore multiple independent paths in parallel if the problem naturally splits — just don't let a failed path's code pollute another path's attempt.

## Git Branching (MANDATORY)

Before starting a new plan, phase, or major feature:

1. **Commit first** — Ensure all changes from the previous task are committed. Do not leave uncommitted work behind.
2. **Create a feature branch** — Branch off `main` with a descriptive name (e.g., `phase-1e-knowledge-base-rag`). Never work directly on `main` for feature work.
3. **One branch per phase/feature** — Keep branches focused. Commit and push before switching to a different feature.

## Pre-Code Checklist (MANDATORY)

Before writing ANY new code, you MUST complete the following checks:

### 1. Read the Phase Plan
- Read the relevant phase plan from `plans/` — this is your primary guide
- Follow the implementation order specified in the plan — dependencies matter
- Check the acceptance criteria to know what "done" looks like

### 2. Check Existing Code
- Search the codebase for existing implementations related to the task
- Read any files you plan to modify before editing them
- Identify existing patterns, utilities, and conventions already in use — follow them
- Check for existing types, interfaces, and schemas that cover your use case

### 3. Check Database Schema
- Review the current schema files and migrations in `supabase/migrations/`
- Confirm the tables, columns, and relationships you need already exist
- If schema changes are needed, create proper migrations — never modify the DB directly
- Check RLS policies if the feature involves multi-tenant data access
- To inspect the **live Supabase schema**, use `pg_dump` (see "Inspecting Live Supabase Schema" below)

### 4. Check API Contracts
- Review existing API routes and endpoints before creating new ones
- Verify request/response shapes match the frontend's expectations

## Post-Code Verification (MANDATORY)

After finishing ANY task or feature, you MUST verify the work before considering it done:

### 1. Build Check
- Run `npm run build` to confirm there are no compile or type errors
- Fix any errors before moving on

### 2. Lint & Format
- Run linting to catch code quality issues
- Ensure no new warnings or errors are introduced

### 3. Functional Verification
- If the feature has a UI component, describe what to check visually or run the dev server to confirm it renders correctly
- If the feature is an API endpoint, test it with a sample request
- If the feature involves database changes, verify the schema/migrations apply cleanly

### 4. Acceptance Criteria
- Re-read the acceptance criteria from the phase plan
- Confirm every criterion is met — do not skip any
- If a criterion cannot be verified automatically, explicitly call it out

### 5. Integration Check
- Verify the new code doesn't break existing functionality
- Check that imports, exports, and cross-module references are correct
- Run tests if they exist for the affected area

## Implementation Plans

Detailed phase plans are in `plans/`. Always read the relevant plan before starting work on a phase.

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
