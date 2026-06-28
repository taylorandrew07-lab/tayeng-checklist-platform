import { createClient } from '@/lib/supabase/client'

// Overtime work across surveyors — one line per (surveyor, job) where any overtime
// was logged. The job's scheduled_date is the period bucket (so the report can be
// filtered by month/year). overtime_pay is the generated column on job_surveyors
// (overtime_hours * overtime_rate), so it's blank until an OT rate is set.
export interface OvertimeLine {
  surveyor_id: string
  name: string
  job_id: string
  job_title: string
  vessel_name: string | null
  report_number: string | null
  date: string | null
  overtime_hours: number
  overtime_pay: number
  currency: string
}

export async function listOvertimeWork(): Promise<OvertimeLine[]> {
  const { data } = await createClient()
    .from('job_surveyors')
    .select('surveyor_id, overtime_hours, overtime_pay, pay_currency, surveyor:profiles!job_surveyors_surveyor_id_fkey(full_name), job:jobs(id, title, vessel_name, report_number, scheduled_date)')
    .gt('overtime_hours', 0)
  return ((data ?? []) as any[]).map(r => ({
    surveyor_id: r.surveyor_id,
    name: r.surveyor?.full_name ?? '—',
    job_id: r.job?.id ?? '',
    job_title: r.job?.title ?? '',
    vessel_name: r.job?.vessel_name ?? null,
    report_number: r.job?.report_number ?? null,
    date: r.job?.scheduled_date ?? null,
    overtime_hours: Number(r.overtime_hours ?? 0),
    overtime_pay: Number(r.overtime_pay ?? 0),
    currency: r.pay_currency ?? 'TTD',
  }))
}
