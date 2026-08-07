// Voyage structure helpers: the calendar of monitoring dates, which rounds each of
// those days has, and the page-splitting rules that lay holds out across photo pages.
//
// periodsForDate() is THE answer to "what rounds does this day have" — the grid,
// photo slots, charts and PDF all ask it rather than iterating BASE_PERIODS.

import { addDays, eachDayOfInterval, parseISO, format, isValid } from 'date-fns'
import { BASE_PERIODS, type ExtraRound, type Period } from './types'

/** Inclusive list of monitoring dates (ISO yyyy-mm-dd) between start and end. */
export function monitoringDates(startISO: string, endISO: string): string[] {
  const start = parseISO(startISO)
  const end = parseISO(endISO)
  if (!isValid(start) || !isValid(end) || end < start) return []
  return eachDayOfInterval({ start, end }).map(d => format(d, 'yyyy-MM-dd'))
}

/** The fields these helpers read — structural so periods.ts stays free of the Voyage type. */
interface DatedVoyage {
  startDate: string
  endDate?: string
  readings?: Record<string, unknown>
  periodMeta?: Record<string, unknown>
  readingSchedule?: ExtraRound[]
}

/**
 * The date a voyage's calendar runs to.
 *
 * `endDate` is OPTIONAL: when a voyage is opened dockside nobody knows yet when
 * the job will finish. An open-ended voyage (endDate '') lays out to today — or
 * to its last day of data if that is later, so a wrong device clock can never
 * hide days already recorded. The grid, photo slots, charts and PDF therefore
 * grow one day at a time instead of forcing a guessed finish date up front.
 */
export function effectiveEndDate(v: DatedVoyage): string {
  if (v.endDate) return v.endDate
  const days = [
    v.startDate,
    format(new Date(), 'yyyy-MM-dd'),
    ...Object.keys(v.readings ?? {}),
    ...Object.keys(v.periodMeta ?? {}),
  ].filter(Boolean).sort() // ISO yyyy-mm-dd sorts lexicographically
  return days[days.length - 1] ?? ''
}

// ── Monitoring rounds ────────────────────────────────────────────────────────

/**
 * The rounds a single monitoring day has, sorted ('HHmm' sorts as text).
 *
 * The base three plus every extra round whose window covers this day. A voyage
 * with no schedule returns exactly BASE_PERIODS — that is what keeps every
 * voyage doc written before this feature rendering byte-identically, including
 * on the client read path, which builds a Voyage straight from JSONB with no
 * migration hook.
 */
export function periodsForDate(v: DatedVoyage, dateISO: string): Period[] {
  const extra = (v.readingSchedule ?? [])
    .filter(r => r.time && r.from <= dateISO && (!r.until || dateISO <= r.until))
    .map(r => r.time)
  if (!extra.length) return [...BASE_PERIODS]
  return [...new Set([...BASE_PERIODS, ...extra])].sort()
}

/**
 * Every round used anywhere in [fromISO, toISO], sorted — for surfaces that span
 * a range rather than one day (the charts filter). A round the range only partly
 * covers still appears; it simply has no points on the days it didn't apply.
 */
export function periodsInRange(v: DatedVoyage, fromISO: string, toISO: string): Period[] {
  const extra = (v.readingSchedule ?? [])
    .filter(r => r.time && r.from <= toISO && (!r.until || fromISO <= r.until))
    .map(r => r.time)
  if (!extra.length) return [...BASE_PERIODS]
  return [...new Set([...BASE_PERIODS, ...extra])].sort()
}

/** Display label for a round: '2200' → '2200 hrs'. */
export function periodLabel(time: Period): string {
  return `${time} hrs`
}

/** 'HHmm' → 'HH:MM' for an <input type="time">. */
export function hhmmToInput(time: string): string {
  return /^\d{4}$/.test(time) ? `${time.slice(0, 2)}:${time.slice(2)}` : ''
}

/** 'HH:MM' from an <input type="time"> → 'HHmm'. Returns '' if unparseable. */
export function inputToHhmm(value: string): string {
  const m = /^(\d{2}):(\d{2})/.exec(value)
  return m ? `${m[1]}${m[2]}` : ''
}

/**
 * Add an extra round applying from `dateISO` onwards. Re-adding a round that was
 * stopped earlier appends a second window rather than reopening the old one, so
 * the gap in between stays a true record of when it wasn't being taken.
 */
export function addExtraRound<T extends { readingSchedule?: ExtraRound[] }>(v: T, time: Period, dateISO: string): T {
  return { ...v, readingSchedule: [...(v.readingSchedule ?? []), { time, from: dateISO }] }
}

/**
 * Stop a round from `dateISO` onwards. Windows that started on or after that day
 * are dropped outright — added and stopped the same day means it never ran —
 * and an earlier window is closed on the day before, keeping its own days intact.
 */
export function removeExtraRound<T extends { readingSchedule?: ExtraRound[] }>(v: T, time: Period, dateISO: string): T {
  const dayBefore = format(addDays(parseISO(dateISO), -1), 'yyyy-MM-dd')
  const kept: ExtraRound[] = []
  for (const r of v.readingSchedule ?? []) {
    if (r.time !== time || (r.until && r.until < dateISO)) { kept.push(r); continue }
    if (r.from >= dateISO) continue // never ran
    kept.push({ ...r, until: dayBefore })
  }
  return { ...v, readingSchedule: kept }
}

/**
 * The day a voyage date picker should open on.
 *
 * Always the NEWEST day, never day 1: a voyage runs open-ended and grows daily,
 * so the newest day is the one being worked — opening on the start date meant
 * scrolling the whole list on every visit by the second week.
 *
 * Read-only views pass `hasData` so a viewer lands on the newest day that has
 * something to show rather than on a day the surveyor hasn't walked yet.
 */
export function defaultPickerDate(dates: string[], hasData?: (dateISO: string) => boolean): string {
  if (hasData) {
    for (let i = dates.length - 1; i >= 0; i--) if (hasData(dates[i])) return dates[i]
  }
  return dates[dates.length - 1] ?? ''
}

/** Human label for a date, e.g. "07 June 2026". */
export function formatVoyageDate(iso: string): string {
  const d = parseISO(iso)
  return isValid(d) ? format(d, 'dd MMMM yyyy') : iso
}

/** "07 June 2026 – 12 June 2026", or "… – ongoing" while the end date is unknown. */
export function formatVoyageRange(v: { startDate: string; endDate?: string }): string {
  return `${v.startDate ? formatVoyageDate(v.startDate) : '—'} – ${v.endDate ? formatVoyageDate(v.endDate) : 'ongoing'}`
}

/** 1..n list of hold numbers. */
export function holdNumbers(holdCount: number): number[] {
  return Array.from({ length: holdCount }, (_, i) => i + 1)
}

/**
 * Split holds into photo pages per the spec:
 *   1–6 holds  → a single page (all holds on one page).
 *   7 holds    → [1–4], [5–7]
 *   8 holds    → [1–4], [5–8]
 *   9 holds    → [1–5], [6–9]
 *   10 holds   → [1–5], [6–10]
 * Returns an array of hold-number arrays, one per page.
 */
export function holdsToPages(holdCount: number): number[][] {
  const all = holdNumbers(holdCount)
  if (holdCount <= 6) return [all]
  const firstPageSize = holdCount <= 8 ? 4 : 5
  return [all.slice(0, firstPageSize), all.slice(firstPageSize)]
}
