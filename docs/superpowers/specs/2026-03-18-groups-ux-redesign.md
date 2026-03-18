# Groups Page UX Redesign + Whapi Auto-Sync

**Date:** 2026-03-18
**Status:** Draft

## Problem

1. Groups only appear after a webhook message arrives from a WhatsApp group — users expect to see all their groups immediately.
2. The configuration UX is confusing: global criteria live in a separate tab, group-specific criteria are hidden behind clicking into a group's detail view, and the distinction between the two isn't clear.

## Design

Replace the current 2-tab layout (Groups | Global Criteria) + GroupDetail drill-in with a flat 3-tab layout where everything is visible and configurable without navigating into sub-views.

### Tab 1: Groups

A flat list of all WhatsApp groups the company's channels belong to.

**Each group row shows:**
- Group name (from Whapi API or JID as fallback)
- Channel name (which WhatsApp number it belongs to)
- Monitoring toggle (on/off)
- Alert rule count badge (how many rules apply to this group, including "All Groups" rules)

**Auto-sync from Whapi:**
- New server endpoint: `POST /api/groups/sync`
- Calls `GET /groups` on the Whapi Gate API for each connected channel
- Upserts discovered groups into `group_chats` table (creates new groups with `monitoring_enabled: false`, updates names for existing groups, never changes `monitoring_enabled` for existing groups)
- Returns `{ groups: GroupChat[], new_count: number }`

**Sync triggers:**
- **First visit** (zero groups in DB): auto-sync fires immediately on page load
- **Subsequent visits**: show cached groups from DB instantly, fire background sync to pick up new groups
- **Manual**: "Sync Groups" button in the page header. Shows loading spinner while syncing, then toast: "Synced — N new groups found" or "All groups up to date"

**Whapi API details:**
- Gate API base: `https://gate.whapi.cloud`
- Auth: `Authorization: Bearer {channelToken}` (per-channel)
- Endpoint: `GET /groups` — returns list of groups the channel is a member of
- Existing `getGroupInfo(channelToken, groupId)` fetches a single group; the sync endpoint uses the list endpoint instead

### Tab 2: Alert Rules

A unified table of ALL alert rules (what was previously split between "Global Criteria" and per-group criteria). The global vs group-specific distinction becomes a "scope" field on each rule.

**Table columns:**
| Column | Description |
|--------|-------------|
| Name | Rule name (e.g., "Competitor mentions") |
| Type | Badge: "Keyword" or "AI" |
| Scope | "All Groups" or specific group name(s) |
| Notify | Avatar(s) / names of team members notified |
| Enabled | Toggle |
| Actions | Edit / Delete buttons |

**"Add Rule" button** opens a dialog with:
- **Name** (text input)
- **Type** selector: Keyword / AI
- **Scope** selector: "All monitored groups" (default) or multi-select specific groups
- **If Keyword**: keywords list + AND/OR operator toggle
- **If AI**: natural language description textarea
- **Notify**: team member multi-select

**Data model:** No schema changes needed. The existing `group_criteria` table already has:
- `group_chat_id UUID NULLABLE` — null means "all groups" (global), a specific ID means group-specific
- `match_type`, `keyword_config`, `ai_description`, `notify_user_ids`, `is_enabled` — all stay the same

The "scope" field in the UI maps directly to `group_chat_id`: null = "All Groups", non-null = specific group(s).

**Note on multi-group scope:** The current DB schema supports only single-group or all-groups scope (one `group_chat_id` per criteria row). Multi-group selection (e.g., "apply to groups A and C but not B") would require either:
- Creating one criteria row per selected group (simple, works with current schema)
- Adding a `group_chat_ids UUID[]` array column (schema change)

**Decision:** Use option A (one row per selected group) for v1. The UI shows multi-select but creates/deletes individual rows behind the scenes. Rules created together share the same name/config — the UI groups them by name for display.

### Tab 3: Matched Messages

A cross-group view of all matched messages, replacing the old per-group "Matched Messages" sub-tab in GroupDetail.

**Each row shows:**
- Group name
- Sender name / phone
- Message text
- Which rule(s) matched (badge with rule name)
- Timestamp

**Filters:**
- Filter by group (dropdown)
- Filter by rule (dropdown)

**Data source:** `GET /api/groups/matches` — a new endpoint that returns `group_criteria_matches` with embedded `group_chat_messages` and `group_criteria` data, scoped to the company. Paginated, newest first.

**Existing endpoint change:** The current `GET /api/groups/:id/matches` stays for backward compatibility but the new cross-group endpoint is used by the redesigned UI.

### Removed Components

- **GroupDetail view** (`GroupDetail.tsx`) — no longer needed; criteria config moves to Alert Rules tab, matched messages move to Matched Messages tab
- **Global Criteria tab** (`GlobalCriteriaList.tsx`) — replaced by unified Alert Rules tab
- **`useGroupMessages` hook** — matched messages now come from the cross-group matches endpoint

### New/Modified Files

**Server:**
| File | Change |
|------|--------|
| `server/src/routes/groups.ts` | Add `POST /sync` endpoint, add `GET /matches` (cross-group), update `GET /` to include rule count |
| `server/src/services/whapi.ts` | Add `listGroups(channelToken)` function |

**Client:**
| File | Change |
|------|--------|
| `client/src/pages/GroupsPage.tsx` | Rewrite: 3-tab layout, sync button, no GroupDetail drill-in |
| `client/src/components/groups/GroupsList.tsx` | Simplify: remove click-to-navigate, just toggles + info |
| `client/src/components/groups/AlertRulesList.tsx` | **New**: unified rules table |
| `client/src/components/groups/AlertRuleDialog.tsx` | **New**: create/edit rule dialog with scope selector |
| `client/src/components/groups/MatchedMessagesList.tsx` | **New**: cross-group matched messages view |
| `client/src/components/groups/GroupDetail.tsx` | **Delete** |
| `client/src/components/groups/GlobalCriteriaList.tsx` | **Delete** |
| `client/src/hooks/useGroups.ts` | Add `syncGroups()` function |
| `client/src/hooks/useGroupCriteria.ts` | Rename/adapt to `useAlertRules.ts`, fetch all rules (not per-group) |
| `client/src/hooks/useGroupMessages.ts` | Replace with `useMatchedMessages.ts` for cross-group matches |
| `client/src/hooks/useGroupRealtime.ts` | Keep, update callbacks for new state shape |

### No Database Changes

The existing `group_chats`, `group_criteria`, `group_criteria_matches`, and `group_chat_messages` tables support the new design without schema modifications.
