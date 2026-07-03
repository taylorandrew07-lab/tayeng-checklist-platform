// Cross-ledger dashboard: the billing side (what clients owe us) and the labour
// side (hours + overtime we pay surveyors). Money is grouped by currency — TTD
// and USD totals are never summed together.

import { createClient } from '@/lib/supabase/client'
import { WORKFLOW_ORDER } from '@/lib/jobs/tracker'
import type { WorkflowStatus } from '@/lib/types/database'

export interface CurrencyBilling { currency: string; paid: number; outstanding: number; overdue: number; draft: number; count: number }
export interface SurveyorLabour { surveyor_id: string; name: string; regular_hours: number; overtime_hours: number; km: number; pay: { currency: string; total: number }[] }
export interface SurveyorJobLabour {
  surveyor_id: string; job_id: string
  job_title: string; vessel_name: string | null; report_number: string | null; job_date: string | null
  regular_hours: number; overtime_hours: number; km: number
  pay: { currency: string; total: number }[]
}
export interface ClientOutstanding { client_id: string; name: string; amounts: { currency: string; amount: number }[] }

export interface InvoicingDashboard {
  billing: CurrencyBilling[]
  jobsByWorkflow: { status: WorkflowStatus; count: number }[]
  openJobs: number
  clients: ClientOutstanding[]
}

/** Labour per surveyor (hours, OT, km, pay), optionally windowed to a date range
 *  (YYYY-MM-DD, inclusive) for the monthly pay run. Day-worked attribution: OT
 *  shifts count on their own date, km on the trip date, regular on the job date
 *  (see mig 125). */
export async function metricsLabour(from?: string | null, to?: string | null): Promise<SurveyorLabour[]> {
  const { data } = await createClient().rpc('metrics_labour', { p_from: from ?? null, p_to: to ?? null })
  return ((data ?? []) as any[])
    .map(l => ({
      surveyor_id: l.surveyor_id, name: l.name,
      regular_hours: Number(l.regular_hours), overtime_hours: Number(l.overtime_hours),
      km: Number(l.km ?? 0),
      pay: Object.entries((l.pay ?? {}) as Record<string, number>).map(([currency, total]) => ({ currency, total: Number(total) })),
    }))
    .filter(s => s.regular_hours || s.overtime_hours || s.km)
    .sort((a, b) => b.overtime_hours - a.overtime_hours || b.regular_hours - a.regular_hours || b.km - a.km)
}

/** The per-job breakdown behind a surveyor's labour row (same window + same
 *  day-worked rule as metricsLabour, at job grain — mig 126). The rows for a
 *  surveyor sum exactly to that surveyor's metricsLabour totals. Returned as a
 *  Map keyed by surveyor_id so the Overview can expand one row at a time. */
export async function metricsLabourByJob(from?: string | null, to?: string | null): Promise<Map<string, SurveyorJobLabour[]>> {
  const { data } = await createClient().rpc('metrics_labour_by_job', { p_from: from ?? null, p_to: to ?? null })
  const byS = new Map<string, SurveyorJobLabour[]>()
  for (const l of (data ?? []) as any[]) {
    const row: SurveyorJobLabour = {
      surveyor_id: l.surveyor_id, job_id: l.job_id,
      job_title: l.job_title ?? '', vessel_name: l.vessel_name ?? null,
      report_number: l.report_number ?? null, job_date: l.job_date ?? null,
      regular_hours: Number(l.regular_hours), overtime_hours: Number(l.overtime_hours),
      km: Number(l.km ?? 0),
      pay: Object.entries((l.pay ?? {}) as Record<string, number>).map(([currency, total]) => ({ currency, total: Number(total) })),
    }
    const arr = byS.get(row.surveyor_id); if (arr) arr.push(row); else byS.set(row.surveyor_id, [row])
  }
  // Most recent job first within each surveyor's breakdown.
  for (const arr of byS.values()) arr.sort((a, b) => (b.job_date ?? '').localeCompare(a.job_date ?? ''))
  return byS
}

export async function getInvoicingDashboard(): Promise<InvoicingDashboard> {
  const supabase = createClient()
  // Aggregated server-side (migration 055) — RLS-scoped, no whole-table fetches.
  // Labour is fetched separately (metricsLabour) so the overview can window it.
  const [billingRes, pipelineRes, clientsRes] = await Promise.all([
    supabase.rpc('metrics_billing'),
    supabase.rpc('metrics_pipeline'),
    supabase.rpc('metrics_client_outstanding'),
  ])

  // ── Billing, per currency ──
  const billing: CurrencyBilling[] = ((billingRes.data ?? []) as any[])
    .map(b => ({ currency: b.currency, paid: Number(b.paid), outstanding: Number(b.outstanding), overdue: Number(b.overdue), draft: Number(b.draft), count: Number(b.count) }))
    .sort((a, b) => b.outstanding - a.outstanding)

  // ── Jobs pipeline (fill every stage from the counts) ──
  const wf = new Map<string, number>()
  for (const r of (pipelineRes.data ?? []) as any[]) wf.set(r.workflow_status, Number(r.count))
  const jobsByWorkflow = WORKFLOW_ORDER.map(status => ({ status, count: wf.get(status) ?? 0 }))
  const openJobs = WORKFLOW_ORDER.filter(s => s !== 'paid' && s !== 'closed').reduce((n, s) => n + (wf.get(s) ?? 0), 0)

  // ── Outstanding per client (one row per client+currency → group) ──
  const cmap = new Map<string, { name: string; amounts: Map<string, number> }>()
  for (const r of (clientsRes.data ?? []) as any[]) {
    let c = cmap.get(r.client_id)
    if (!c) { c = { name: r.name, amounts: new Map() }; cmap.set(r.client_id, c) }
    c.amounts.set(r.currency, (c.amounts.get(r.currency) ?? 0) + Number(r.amount))
  }
  const clients: ClientOutstanding[] = [...cmap.entries()]
    .map(([client_id, c]) => ({ client_id, name: c.name, amounts: [...c.amounts.entries()].map(([currency, amount]) => ({ currency, amount })) }))
    .sort((a, b) => b.amounts.reduce((s, x) => s + x.amount, 0) - a.amounts.reduce((s, x) => s + x.amount, 0))

  return { billing, jobsByWorkflow, openJobs, clients }
}
