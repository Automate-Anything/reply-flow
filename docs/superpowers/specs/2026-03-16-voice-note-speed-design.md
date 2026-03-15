# Voice Note Playback Speed

**Date**: 2026-03-16
**Status**: Approved

## Summary

Add playback speed control to voice note messages in the inbox, following WhatsApp's UX pattern. Users can cycle through 1x, 1.25x, 1.5x, 1.75x, and 2x speeds. Speed preference persists across voice notes and page refreshes via localStorage.

## Behavior

1. **Before first play**: No speed badge visible if stored speed is 1x. If a non-1x speed is stored, badge shows immediately.
2. **After playback starts** (playing or paused mid-track): A speed badge appears to the right of the duration text, showing current speed (e.g., `1.5x`).
3. **Clicking the badge**: Cycles through `1x → 1.25x → 1.5x → 1.75x → 2x → 1x`.
4. **On audio end**: Player resets to start position, badge stays visible showing current speed (sticky).
5. **Persistence**: Speed stored in `localStorage` under key `voiceNoteSpeed`. All voice notes use this speed. Survives refresh.

## UI Details

- **Badge placement**: Small rounded pill between the duration text (left) and the `timeSlot` timestamp (right) in the bottom row. The bottom row becomes a 3-item flex: `[duration] [speed badge] [timeSlot]`. Badge takes no space when hidden (not rendered).
- **Outbound bubbles**: `bg-white/20 text-white` (matches existing play button style).
- **Inbound bubbles**: `bg-primary/10 text-primary` (matches existing play button style).
- **Font**: `text-[11px] font-medium tabular-nums` for crisp number rendering.
- **Visibility logic**: Badge shows when `hasStarted === true` OR stored speed !== 1x.

## State Management

- Module-level helpers `getStoredSpeed()` / `setStoredSpeed(speed)` read/write `localStorage('voiceNoteSpeed')`. `getStoredSpeed()` returns `1` on any read error (private browsing, corrupted value). `setStoredSpeed()` silently ignores write failures.
- `VoiceNotePlayer` component gets:
  - `playbackRate` state (local to each instance) initialized from `getStoredSpeed()`.
  - `hasStarted` boolean (local state) — true after first play, or if stored speed !== 1.
- On speed change (badge click): immediately set `audio.playbackRate`, save to localStorage, update local state. This applies even before first play.
- On play: always set `audio.playbackRate` to current `playbackRate` state before calling `audio.play()` (some browsers may reset playbackRate on seek).

## Speed Options

| Speed | Label |
|-------|-------|
| 1     | 1x    |
| 1.25  | 1.25x |
| 1.5   | 1.5x  |
| 1.75  | 1.75x |
| 2     | 2x    |

## Files Changed

- `client/src/components/inbox/MessageBubble.tsx` — Only file modified. Changes to `VoiceNotePlayer` component (~30 lines added).

## What Does NOT Change

- No new files, hooks, or contexts.
- Waveform visualization, seek, play/pause all unchanged.
- `ReadOnlyMessageList` (contact detail view) unaffected.
