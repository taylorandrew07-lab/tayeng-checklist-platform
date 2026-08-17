// Calibration and expiry dates. PURE — unit-tested in calibration.test.ts.
//
// Both signals band identically, so both reuse expiryStatus() from
// lib/personal-docs/api.ts rather than growing a second copy of the same maths.
//
// The reminder-ladder decision lives here, out of the cron route, because it is
// the one piece of that route worth testing and the route itself cannot be.

import { addMonths, differenceInCalendarDays, format, isValid, parseISO } from 'date-fns'
import { expiryStatus, type ExpiryStatus } from '@/lib/personal-docs/api'

/**
 * The reminder ladder, in days before due. 0 = "due today or already overdue" —
 * a gauge going out of certification with no message is the exact failure this
 * feature exists to prevent, so it is a rung, not an afterthought.
 *
 * Mirrored by the CHECK on inventory_reminders.days_out (migration 190).
 * Change one, change both.
 */
export const REMINDER_BUCKETS = [60, 30, 7, 0] as const
export type ReminderBucket = (typeof REMINDER_BUCKETS)[number]

/** America/Port_of_Spain, UTC-4, FIXED — Trinidad has never observed DST. */
const TZ_OFFSET_MS = 4 * 60 * 60 * 1000

/**
 * Today's date in Trinidad, as YYYY-MM-DD, on any host.
 *
 * Load-bearing: Vercel and GitHub Actions both run in UTC, so a naive
 * `new Date()` here is up to four hours ahead of Trinidad and fires the 7-day
 * reminder a day early roughly one run in six. Same fixed-offset trick as
 * lib/jobs/reminderWindow.ts.
 */
export function trinidadToday(now: Date = new Date()): string {
  return format(new Date(now.getTime() - TZ_OFFSET_MS), 'yyyy-MM-dd')
}

/** Whole days from Trinidad-today until `due`. Negative = overdue. */
export function daysUntil(due: string | null, now: Date = new Date()): number | null {
  if (!due) return null
  const d = parseISO(due)
  if (!isValid(d)) return null
  return differenceInCalendarDays(d, parseISO(trinidadToday(now)))
}

/**
 * Banded status for a calibration date, reusing the personal-documents helper so
 * a gauge and a passport read the same way.
 */
export function calibrationStatus(
  due: string | null,
  leadDays = 60,
): { status: ExpiryStatus; days: number | null } {
  return expiryStatus(due, leadDays)
}

/**
 * Which rungs of the ladder this due date has CROSSED as of `now`.
 *
 * "Crossed" (days <= bucket), never "equalled" (days === bucket). This is the
 * whole reason the function exists: with an equality test, a cron that misses a
 * day — a GitHub outage, a deploy, a slow queue — SKIPS that reminder entirely
 * rather than sending it late. It also makes the newly-added-gauge case correct:
 * an item entered 20 days from due has crossed 60 and 30 at once.
 *
 * Returns widest-first: [60, 30, 7, 0].
 */
export function crossedBuckets(due: string | null, now: Date = new Date()): ReminderBucket[] {
  const days = daysUntil(due, now)
  if (days === null) return []
  return REMINDER_BUCKETS.filter(b => days <= b)
}

/**
 * The tightest crossed rung — the one a message should actually be ABOUT.
 *
 * The caller latches every crossed bucket but talks about this one only, so a
 * gauge entered at 20 days out sends one message (about 30) instead of two, and
 * does not nag about 60 tomorrow.
 */
export function tightestBucket(due: string | null, now: Date = new Date()): ReminderBucket | null {
  const crossed = crossedBuckets(due, now)
  return crossed.length ? crossed[crossed.length - 1] : null
}

/** "Due in 12 days" · "Due today" · "Overdue by 3 days" · "No date set". */
export function dueLabel(due: string | null, now: Date = new Date()): string {
  const days = daysUntil(due, now)
  if (days === null) return 'No date set'
  if (days === 0) return 'Due today'
  if (days < 0) return `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`
  return `Due in ${days} day${days === 1 ? '' : 's'}`
}

/**
 * The next due date after a calibration, when an interval is known. Returned as
 * a suggestion for the item form — never written behind the user's back, since
 * the certificate is the authority on when the next one is due.
 */
export function nextDueDate(calibratedAt: string | null, intervalMonths: number | null): string | null {
  if (!calibratedAt || !intervalMonths || intervalMonths <= 0) return null
  const d = parseISO(calibratedAt)
  if (!isValid(d)) return null
  return format(addMonths(d, intervalMonths), 'yyyy-MM-dd')
}
