/**
 * Centralized timezone utilities.
 *
 * All "wall clock" operations (e.g. "tomorrow 9 AM") use the company timezone
 * so that every team member sees consistent times regardless of their browser's
 * local timezone.
 */

const DEFAULT_TZ = 'UTC';

// ─── Helpers ──────────────────────────────────────────────

/** Get date parts (year, month, day, hour, minute, weekday) in a given timezone. */
function partsIn(date: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month) - 1, // 0-indexed
    day: Number(parts.day),
    hour: Number(parts.hour === '24' ? '0' : parts.hour),
    minute: Number(parts.minute),
    weekday: parts.weekday as string, // "Mon", "Tue", etc.
  };
}

/**
 * Create a UTC Date that corresponds to the given wall-clock time in `tz`.
 *
 * E.g. `createInTimezone('America/New_York', 2026, 2, 12, 9, 0)` returns a
 * Date whose UTC value equals 2026-03-12T14:00:00Z (when EST = UTC-5).
 */
export function createInTimezone(
  tz: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): Date {
  // Start with a rough UTC guess
  const guess = new Date(Date.UTC(year, month, day, hour, minute, 0, 0));
  // See what wall-clock time that guess maps to in the target tz
  const actual = partsIn(guess, tz);
  // Calculate offset between desired and actual
  const diffMs =
    (hour - actual.hour) * 3_600_000 + (minute - actual.minute) * 60_000;
  // Also handle day wrap (e.g. if offset crossed midnight)
  let dayDiff = day - actual.day;
  // Handle month boundary (e.g. desired day 1, actual day 31)
  if (dayDiff > 15) dayDiff -= 31;
  if (dayDiff < -15) dayDiff += 31;
  return new Date(guess.getTime() + diffMs + dayDiff * 86_400_000);
}

// ─── Preset Builders ──────────────────────────────────────

/** Returns a Date for "tomorrow at {hour}:00" in the company timezone. */
export function getTomorrowAt(tz: string | undefined, hour: number): Date {
  const t = tz || DEFAULT_TZ;
  const now = partsIn(new Date(), t);
  return createInTimezone(t, now.year, now.month, now.day + 1, hour, 0);
}

/** Returns a Date for "next Monday at {hour}:00" in the company timezone. */
export function getNextMondayAt(tz: string | undefined, hour: number): Date {
  const t = tz || DEFAULT_TZ;
  const now = new Date();
  const { year, month, day, weekday } = partsIn(now, t);
  const dayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
  const daysUntilMonday = dayIndex === 0 ? 1 : dayIndex === 1 ? 7 : 8 - dayIndex;
  return createInTimezone(t, year, month, day + daysUntilMonday, hour, 0);
}

// ─── Formatting ──────────────────────────────────────────

/** Format a date in the company timezone using Intl options. */
export function formatInTz(
  date: Date | string,
  tz: string | undefined,
  options: Intl.DateTimeFormatOptions
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString(undefined, { timeZone: tz || DEFAULT_TZ, ...options });
}

/** Short time: "2:30 PM" */
export function formatTime(date: Date | string, tz?: string): string {
  return formatInTz(date, tz, { hour: '2-digit', minute: '2-digit' });
}

/** Smart relative timestamp for conversation lists. */
export function formatRelativeDate(dateStr: string | null, tz?: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const dayMs = 86_400_000;

  if (diff < dayMs) {
    return formatTime(date, tz);
  }
  if (diff < 7 * dayMs) {
    return formatInTz(date, tz, { weekday: 'short' });
  }
  return formatInTz(date, tz, { month: 'short', day: 'numeric' });
}

/** Format a scheduled time with relative prefix. */
export function formatScheduledTime(ts: string, tz?: string): string {
  const date = new Date(ts);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffH = Math.floor(diffMs / 3_600_000);

  if (diffMs <= 0) return 'Sending...';
  if (diffH < 1) return `in ${Math.ceil(diffMs / 60_000)}m`;
  if (diffH < 24) return `in ${diffH}h`;
  return formatInTz(date, tz, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Format snooze remaining time. */
export function formatSnoozeUntil(dateStr: string, tz?: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  if (diffMs <= 0) return 'Snoozed';
  const diffH = Math.floor(diffMs / 3_600_000);
  if (diffH < 1) return `Snoozed · ${Math.ceil(diffMs / 60_000)}m`;
  if (diffH < 24) return `Snoozed · ${diffH}h`;
  return `Snoozed · ${formatInTz(date, tz, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`;
}
