# Implementation Plans

## How to Use
Before starting any phase, check its **status** and **dependencies** below.
Do not start a phase marked `TODO` if its dependencies are not `DONE`.
After completing a phase, update its status here and in `MEMORY.md`.

---

## Audit & Bug Fixes

| Phase | Status | Plan File | Scope | Dependencies |
|-------|--------|-----------|-------|--------------|
| Audit | IN PROGRESS | `plans/2026-03-11-inbox-ai-kb-audit-plan.md` | Inbox, AI, KB audit — quick replies, scheduled send, filters, priorities, scenario dialog, KB upload | None |

## New Features

| Phase | Status | Plan File | Scope | Dependencies |
|-------|--------|-----------|-------|--------------|
| Labels/Quick Replies Visibility | TODO | `plans/2026-03-15-labels-quick-replies-visibility.md` | Per-user/per-company visibility toggle for labels and canned responses | None |
| Auto-Assign Conversations | TODO | `plans/2026-03-15-auto-assign-conversations.md` | Round-robin, least-busy, tag-based auto-assignment per channel | None |
| Notifications + Assigned Tab | TODO | `plans/2026-03-15-notifications-and-assigned-tab.md` | In-app notifications, preferences, "Assigned to Me" inbox tab | None (but benefits from Auto-Assign being done first) |
| Personal Hours & Availability | TODO | `plans/2026-03-15-personal-hours-availability.md` | User timezone, personal working hours, auto-availability, company/user holidays | None (but benefits from Auto-Assign being done first) |
