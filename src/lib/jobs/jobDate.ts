// A job's date for ordering and display. Jobs can span a range —
// jobs.scheduled_date (start) → jobs.end_date (end, nullable, migration 111) —
// and every list orders and shows a job by its LAST day, with the start
// relegated to fine print: a 12→19 Jul loadout reads (and sorts) as 19 Jul.
//
// This is the ONE place that rule lives; don't re-spell the COALESCE anywhere else.
// Four families of date logic deliberately stay keyed off the START date and must
// NOT be routed through here: report-number sequencing (YY-MM-NNN follows when the
// work started), the calendar's day-spanning + get_calendar_jobs (needs BOTH
// bounds), double-booking windows (lib/jobs/conflicts.ts + migration 132, also both
// bounds), and the labour/analytics attribution windows (migrations 123/125/126/107,
// which decide which pay month a job's hours land in).

import { dayKey } from '@/lib/utils'

/** The date fields any job row carries. All optional so a query that doesn't
 *  select end_date still type-checks — it just degrades to the start date. */
export interface JobDateFields {
  scheduled_date?: string | null
  end_date?: string | null
  created_at?: string | null
}

/** The job's last day: its end date when it spans a range, otherwise the day it
 *  is scheduled for. Null when the job has no dates — callers decide whether to
 *  show a dash or fall back to the job's own created_at. */
export function jobLastDate(j: JobDateFields): string | null {
  return j.end_date ?? j.scheduled_date ?? null
}

/** Sort key for a job list: the last day as a local calendar day, so the order
 *  matches the dates actually shown (raw date-vs-timestamp strings don't compare
 *  — see dayKey). Falls back to created_at, matching the long-standing
 *  `scheduled_date ?? created_at` display fallback. */
export function jobLastDateKey(j: JobDateFields): string {
  return dayKey(jobLastDate(j) ?? j.created_at)
}

/** True when the job runs over more than one day, i.e. it has a start date worth
 *  showing underneath the last date. */
export function jobSpansDays(j: JobDateFields): boolean {
  return !!j.end_date && !!j.scheduled_date && dayKey(j.end_date) !== dayKey(j.scheduled_date)
}

/** Comparator for job lists: latest last-day first. */
export function byLastDateDesc(a: JobDateFields, b: JobDateFields): number {
  const ka = jobLastDateKey(a), kb = jobLastDateKey(b)
  return ka < kb ? 1 : ka > kb ? -1 : 0
}
