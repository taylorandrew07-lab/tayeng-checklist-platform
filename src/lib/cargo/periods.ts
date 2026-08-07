// Voyage structure helpers: the calendar of monitoring dates and the page-splitting
// rules that control how holds are laid out across photo pages.

import { eachDayOfInterval, parseISO, format, isValid } from 'date-fns'

/** Inclusive list of monitoring dates (ISO yyyy-mm-dd) between start and end. */
export function monitoringDates(startISO: string, endISO: string): string[] {
  const start = parseISO(startISO)
  const end = parseISO(endISO)
  if (!isValid(start) || !isValid(end) || end < start) return []
  return eachDayOfInterval({ start, end }).map(d => format(d, 'yyyy-MM-dd'))
}

/** The fields effectiveEndDate reads — structural so periods.ts stays free of the Voyage type. */
interface DatedVoyage {
  startDate: string
  endDate?: string
  readings?: Record<string, unknown>
  periodMeta?: Record<string, unknown>
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
