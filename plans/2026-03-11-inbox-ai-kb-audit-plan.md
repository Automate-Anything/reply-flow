# Inbox / AI / KB Audit Plan

Date: 2026-03-11

## Findings

### 1. Quick replies
- The quick reply picker is wired in `client/src/components/inbox/MessageInput.tsx`.
- It opens on `/`, filters from `useCannedResponses()`, and inserts content through `insertCannedResponse`.
- I did not find an obvious hard failure in the input logic itself.
- Most likely causes:
  - the canned responses hook or API is returning empty/stale data
  - the slash trigger is working but not matching expected shortcuts/content
- This needs a targeted runtime repro and inspection of the canned responses data path.

### 2. Priority levels editable/addable like quick replies and labels
- Priority is currently hard-coded in multiple places:
  - `client/src/components/inbox/ConversationFilters.tsx`
  - `client/src/components/inbox/ConversationHeader.tsx`
  - `client/src/components/inbox/ConversationContextMenu.tsx`
  - `client/src/components/inbox/BulkActionBar.tsx`
  - `server/src/routes/conversations.ts`
- This is not data-driven today.
- Supporting editable/addable priorities will require a new managed resource, not just UI tweaks.

### 3. "Show Notes" should say "Notes"
- Confirmed.
- The notes action still says `Show Notes` in `client/src/components/inbox/ConversationHeader.tsx`.
- The panel already says `Notes` in `client/src/components/inbox/ConversationNotes.tsx`.

### 4. Assignee filter: add "assigned to others", make filters multi-select
- Confirmed current filter UI is single-select for status, assignee, and priority in `client/src/components/inbox/ConversationFilters.tsx`.
- Confirmed backend only accepts a single `assignee` and single `priority` in:
  - `client/src/hooks/useConversations.ts`
  - `server/src/routes/conversations.ts`
- `assigned to others` does not exist today.
- This requires coordinated client and backend changes.

### 5. Scheduled send not working
- Scheduling UI exists in `client/src/components/inbox/MessageInput.tsx`.
- Scheduling API exists in `server/src/routes/messages.ts`.
- Background scheduler exists in `server/src/services/scheduler.ts`.
- So the feature exists end-to-end in code.
- Most likely runtime failure points:
  - scheduled rows are created but the scheduler worker is not executing/sending
  - the scheduling request fails at runtime
- This needs runtime verification.

### 6. Scheduled view clears search and filters
- Confirmed by structure in `client/src/pages/InboxPage.tsx`.
- When `activeTab === 'scheduled'`, the UI swaps `ConversationList` out for `ScheduledMessagesList`.
- Search and filters live inside `ConversationList`, so they disappear on the scheduled tab.
- This is a structural UX issue, not a one-line bug.

### 7. AI scenario dialog safeguards
- Confirmed in `client/src/components/settings/response-flow/ScenarioDialog.tsx`:
  - `Goal` is not required
  - `Step-by-Step Instructions` is not required
  - save validity only checks scenario name + trigger condition
  - close behavior directly uses `onOpenChange`
  - no unsaved-changes protection exists for close/click-out

### 8. Knowledge base upload size message mismatch
- Confirmed backend KB upload limit is 10 MB in `server/src/routes/ai.ts` via multer.
- The reported mismatch means either:
  - the UI is showing the wrong message
  - another layer is enforcing a lower real limit
- The exact frontend message still needs a targeted follow-up search in the KB UI markup.

## Additional Notes

- Quick replies and scheduled send appear to be runtime/regression issues, not missing features.
- Priority management and multi-select filtering are feature expansions and need deliberate design/data-model work.

## Fix Plan

### 1. Reproduce and isolate runtime failures first
- Quick replies
- Scheduled send
- Knowledge base upload limit mismatch

Reason:
- These likely need real bug fixes rather than UI-only changes.
- They affect core daily behavior.

### 2. Fix low-risk inbox UX/text regressions
- Rename `Show Notes` to `Notes`
- Preserve or redesign search/filter visibility on the Scheduled tab

### 3. Redesign filtering end-to-end
- Convert assignee/priority/status filters to multi-select
- Add `assigned to others` option
- Define how `All` behaves alongside multi-select values
- Update backend query format and filtering logic

### 4. Add configurable priority levels
- Create a managed priority model similar to labels/statuses
- Replace hard-coded priority lists in inbox UI and backend validation
- Decide migration path for existing values

### 5. Harden AI scenario dialog
- Require `Goal`
- Require `Step-by-Step Instructions`
- Disable save until valid
- Add unsaved-changes confirmation on close, click-out, and dismiss flows

### 6. Verify all changed flows
- Quick replies insert and render
- Scheduled send create + worker execution + scheduled list behavior
- Multi-select filter combinations
- Priority create/edit/delete
- Scenario dialog save/discard/close flows
- KB upload messaging vs real enforced limit

## Recommended Order

1. Quick replies + scheduled send + scheduled tab/search behavior
2. Notes label
3. Scenario dialog safeguards
4. Assignee multi-select + `assigned to others`
5. Priority levels system
6. KB upload size message correction

## Naming Note

For the shorter assignee option label, best candidates are:
- `Others`
- `Assigned Elsewhere`
- `Other Assignees`

Best current pick:
- `Others`
