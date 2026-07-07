// Upcoming (future / in-flight) jobs for the dashboards. A job counts as
// "upcoming" until it ends: end_date >= today, or (single-day) scheduled_date >=
// today. RLS scopes the rows — admins see all, a surveyor sees only theirs — so
// the same query powers both the admin and surveyor panels.

import { createClient } from '@/lib/supabase/client'
import { rangesOverlap, type JobSchedule } from '@/lib/jobs/conflicts'

export interface UpcomingRow {
  id: string
  title: string
  job_number: string | null
  workflow_status: string
  scheduled_date: string
  end_date: string | null
  start_time: string | null
  end_time: string | null
  vessel_name: string | null
  surveyorNames: string[]
  surveyorIds: string[]
  clientName: string | null
  clientColor: string | null
  templateColor: string | null
  /** True when this row shares a surveyor with another upcoming row and their
   *  windows overlap (a likely double-booking). Computed client-side below. */
  conflict: boolean
}

// Local yyyy-mm-dd — avoids the UTC off-by-one around midnight in Trinidad (UTC-4).
function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const schedOf = (r: UpcomingRow): JobSchedule => ({
  scheduled_date: r.scheduled_date, end_date: r.end_date,
  start_time: r.start_time, end_time: r.end_time,
})

export async function listUpcomingJobs(limit = 10): Promise<UpcomingRow[]> {
  const today = todayLocal()
  const { data } = await createClient()
    .from('jobs')
    .select(`
      id, title, job_number, workflow_status, scheduled_date, end_date, start_time, end_time, vessel_name,
      client:clients(name, color),
      template:checklist_templates(color),
      job_surveyors(surveyor_id, surveyor:profiles(full_name))
    `)
    .or(`end_date.gte.${today},and(end_date.is.null,scheduled_date.gte.${today})`)
    .not('scheduled_date', 'is', null)
    .neq('workflow_status', 'closed')
    .order('scheduled_date', { ascending: true })
    .limit(limit)

  const rows: UpcomingRow[] = ((data as any[]) ?? []).map(j => ({
    id: j.id,
    title: j.title,
    job_number: j.job_number,
    workflow_status: j.workflow_status,
    scheduled_date: j.scheduled_date,
    end_date: j.end_date,
    start_time: j.start_time,
    end_time: j.end_time,
    vessel_name: j.vessel_name,
    surveyorNames: (j.job_surveyors ?? []).map((s: any) => s.surveyor?.full_name).filter(Boolean),
    surveyorIds: (j.job_surveyors ?? []).map((s: any) => s.surveyor_id).filter(Boolean),
    clientName: j.client?.name ?? null,
    clientColor: j.client?.color ?? null,
    templateColor: j.template?.color ?? null,
    conflict: false,
  }))

  // Flag rows that share a surveyor with another row and overlap in time.
  for (let i = 0; i < rows.length; i++) {
    for (let k = i + 1; k < rows.length; k++) {
      const shares = rows[i].surveyorIds.some(id => rows[k].surveyorIds.includes(id))
      if (shares && rangesOverlap(schedOf(rows[i]), schedOf(rows[k]))) {
        rows[i].conflict = true
        rows[k].conflict = true
      }
    }
  }
  return rows
}
