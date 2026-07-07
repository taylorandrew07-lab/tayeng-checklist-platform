// Surveyor double-booking detection. A job describes a window from its start
// (scheduled_date + start_time) to its end (end_date/scheduled_date + end_time);
// two jobs for the same surveyor clash when those windows overlap. A job with no
// times spans the whole day(s) — an all-day booking — so two date-only jobs on
// the same day clash (correctly). Warn-but-allow: callers surface these, never block.
//
// The COALESCE defaults here MUST mirror surveyor_job_conflicts() in migration 132.

import { createClient } from '@/lib/supabase/client'

export interface JobSchedule {
  scheduled_date: string        // 'YYYY-MM-DD'
  end_date: string | null       // null = single day
  start_time: string | null     // 'HH:MM' / 'HH:MM:SS' / null = start of day
  end_time: string | null       // 'HH:MM' / 'HH:MM:SS' / null = end of day
}

export interface JobConflict {
  id: string
  title: string
  job_number: string | null
  vessel_name: string | null
  scheduled_date: string
  end_date: string | null
  start_time: string | null
  end_time: string | null
  workflow_status: string
}

// Minutes-since-epoch, timezone-free (UTC parts only), so ranges are comparable
// integers. Date → whole days; time → minutes within the day.
function dayIndex(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86_400_000)
}
function minutesOfDay(timeStr: string | null, fallback: number): number {
  if (!timeStr) return fallback
  const [h, min] = timeStr.split(':').map(Number)
  return (h || 0) * 60 + (min || 0)
}

/** Composes a schedule into an inclusive [start, end] range of absolute minutes. */
export function composeRange(s: JobSchedule): { start: number; end: number } {
  const start = dayIndex(s.scheduled_date) * 1440 + minutesOfDay(s.start_time, 0)
  const endDay = dayIndex(s.end_date ?? s.scheduled_date)
  const end = endDay * 1440 + minutesOfDay(s.end_time, 23 * 60 + 59)
  return { start, end }
}

/** True when two schedules overlap (inclusive) — mirrors the SQL tsrange && test. */
export function rangesOverlap(a: JobSchedule, b: JobSchedule): boolean {
  const ra = composeRange(a), rb = composeRange(b)
  return ra.start <= rb.end && rb.start <= ra.end
}

/** Authoritative check: a surveyor's other live jobs clashing with `schedule`. */
export async function checkSurveyorConflicts(
  surveyorId: string, schedule: JobSchedule, excludeJobId?: string,
): Promise<JobConflict[]> {
  const { data, error } = await createClient().rpc('surveyor_job_conflicts', {
    p_surveyor: surveyorId,
    p_date: schedule.scheduled_date,
    p_end_date: schedule.end_date,
    p_start_time: schedule.start_time,
    p_end_time: schedule.end_time,
    p_exclude_job: excludeJobId ?? null,
  })
  if (error) return []
  return (data as JobConflict[]) ?? []
}

/** Runs checkSurveyorConflicts for many surveyors; keyed by surveyor id (empty
 *  arrays omitted). */
export async function checkConflictsForSurveyors(
  surveyorIds: string[], schedule: JobSchedule, excludeJobId?: string,
): Promise<Map<string, JobConflict[]>> {
  const out = new Map<string, JobConflict[]>()
  if (!schedule.scheduled_date || surveyorIds.length === 0) return out
  const results = await Promise.all(
    surveyorIds.map(id => checkSurveyorConflicts(id, schedule, excludeJobId)),
  )
  surveyorIds.forEach((id, i) => { if (results[i].length) out.set(id, results[i]) })
  return out
}
