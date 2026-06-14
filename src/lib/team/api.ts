// Team hub — one person record composing profile + work/hours (their assigned
// jobs from job_surveyors). Credentials are rendered via CredentialsManager.

import { createClient } from '@/lib/supabase/client'

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
  created_at: string
  regular_hours: number
  overtime_hours: number
}

export interface PersonDetail {
  profile: PersonProfile
  totalRegular: number
  totalOvertime: number
  pay: { currency: string; total: number }[]
  jobs: PersonWorkJob[]
}

export async function getPersonDetail(id: string): Promise<PersonDetail | null> {
  const supabase = createClient()
  const [{ data: profile }, { data: js }] = await Promise.all([
    supabase.from('profiles')
      .select('id, full_name, email, phone, role, display_title, is_active, is_super_admin, employee_number, vehicle_number')
      .eq('id', id).single(),
    supabase.from('job_surveyors')
      .select('regular_hours, overtime_hours, regular_pay, overtime_pay, pay_currency, job:jobs(id, report_number, title, workflow_status, scheduled_date, created_at)')
      .eq('surveyor_id', id),
  ])
  if (!profile) return null

  let totalRegular = 0, totalOvertime = 0
  const pay = new Map<string, number>()
  const jobs: PersonWorkJob[] = []
  for (const r of (js ?? []) as any[]) {
    totalRegular += Number(r.regular_hours ?? 0)
    totalOvertime += Number(r.overtime_hours ?? 0)
    const t = Number(r.regular_pay ?? 0) + Number(r.overtime_pay ?? 0)
    if (t) pay.set(r.pay_currency ?? 'TTD', (pay.get(r.pay_currency ?? 'TTD') ?? 0) + t)
    if (r.job) jobs.push({
      id: r.job.id, report_number: r.job.report_number, title: r.job.title,
      workflow_status: r.job.workflow_status, scheduled_date: r.job.scheduled_date, created_at: r.job.created_at,
      regular_hours: Number(r.regular_hours ?? 0), overtime_hours: Number(r.overtime_hours ?? 0),
    })
  }
  jobs.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))

  return {
    profile: profile as PersonProfile,
    totalRegular, totalOvertime,
    pay: [...pay.entries()].map(([currency, total]) => ({ currency, total })),
    jobs,
  }
}
