// Team hub — one person record composing profile + work/hours (their assigned
// jobs from job_surveyors). Credentials are rendered via CredentialsManager.

import { createClient } from '@/lib/supabase/client'
import { asLabourUnit, type LabourUnit } from '@/lib/jobs/labourUnit'
import { byLastDateDesc } from '@/lib/jobs/jobDate'

export interface PersonProfile {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  role: string
  display_title: string | null
  is_active: boolean
  is_super_admin: boolean | null
  employee_number: string | null
  vehicle_number: string | null
}

export interface PersonWorkJob {
  id: string
  report_number: string | null
  title: string
  workflow_status: string
  scheduled_date: string | null
  end_date: string | null
  created_at: string
  /** The job's own unit (migration 148) — the quantities below are in it. */
  labour_unit: LabourUnit
  regular_hours: number
  overtime_hours: number
}

export interface PersonDetail {
  profile: PersonProfile
  /** Totals are kept per unit: a person can work hours-billed and day-billed jobs
   *  in the same period and the two may never be added together (migration 148). */
  totalRegular: number
  totalOvertime: number
  totalRegularDays: number
  totalOvertimeDays: number
  pay: { currency: string; total: number }[]
  jobs: PersonWorkJob[]
}

export async function getPersonDetail(id: string): Promise<PersonDetail | null> {
  const supabase = createClient()
  const [{ data: profile }, { data: js }, { data: kmRows }, { data: settings }] = await Promise.all([
    supabase.from('profiles')
      .select('id, full_name, email, phone, role, display_title, is_active, is_super_admin, employee_number, vehicle_number')
      .eq('id', id).single(),
    supabase.from('job_surveyors')
      .select('regular_hours, overtime_hours, regular_pay, overtime_pay, pay_currency, job:jobs(id, report_number, title, workflow_status, scheduled_date, end_date, labour_unit, created_at)')
      .eq('surveyor_id', id),
    // Travel: all this surveyor's km trips, priced by the company rate below.
    supabase.from('job_surveyor_km').select('km, js:job_surveyors!inner(surveyor_id)').eq('js.surveyor_id', id),
    supabase.from('app_settings').select('surveyor_km_rate, surveyor_km_currency').eq('id', true).maybeSingle(),
  ])
  if (!profile) return null

  let totalRegular = 0, totalOvertime = 0, totalRegularDays = 0, totalOvertimeDays = 0
  const pay = new Map<string, number>()
  const jobs: PersonWorkJob[] = []
  for (const r of (js ?? []) as any[]) {
    // Quantities accumulate into their own job's unit bucket (migration 148); pay
    // is money and stays a single total whatever the unit.
    const unit = asLabourUnit(r.job?.labour_unit)
    if (unit === 'days') {
      totalRegularDays += Number(r.regular_hours ?? 0)
      totalOvertimeDays += Number(r.overtime_hours ?? 0)
    } else {
      totalRegular += Number(r.regular_hours ?? 0)
      totalOvertime += Number(r.overtime_hours ?? 0)
    }
    const t = Number(r.regular_pay ?? 0) + Number(r.overtime_pay ?? 0)
    if (t) pay.set(r.pay_currency ?? 'TTD', (pay.get(r.pay_currency ?? 'TTD') ?? 0) + t)
    if (r.job) jobs.push({
      id: r.job.id, report_number: r.job.report_number, title: r.job.title,
      workflow_status: r.job.workflow_status, scheduled_date: r.job.scheduled_date,
      end_date: r.job.end_date ?? null, created_at: r.job.created_at, labour_unit: unit,
      regular_hours: Number(r.regular_hours ?? 0), overtime_hours: Number(r.overtime_hours ?? 0),
    })
  }
  // Latest last-day first, matching every other job list.
  jobs.sort(byLastDateDesc)

  // Travel pay = total km × the company rate, added to the configured currency
  // bucket so it lines up with the Finance Overview labour totals.
  const kmTotal = ((kmRows ?? []) as any[]).reduce((s, r) => s + Number(r.km ?? 0), 0)
  const kmPay = kmTotal * Number(settings?.surveyor_km_rate ?? 0)
  if (kmPay) {
    const kmCur = (settings?.surveyor_km_currency as string) ?? 'TTD'
    pay.set(kmCur, (pay.get(kmCur) ?? 0) + kmPay)
  }

  return {
    profile: profile as PersonProfile,
    totalRegular, totalOvertime, totalRegularDays, totalOvertimeDays,
    pay: [...pay.entries()].map(([currency, total]) => ({ currency, total })),
    jobs,
  }
}
