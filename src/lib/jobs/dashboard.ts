// Cross-ledger dashboard: the billing side (what clients owe us) and the labour
// side (hours + overtime we pay surveyors). Money is grouped by currency — TTD
// and USD totals are never summed together.

import { createClient } from '@/lib/supabase/client'
import { aggregateBilling, aggregateLabour, aggregatePipeline } from '@/lib/jobs/metrics'
import type { WorkflowStatus } from '@/lib/types/database'

export interface CurrencyBilling { currency: string; paid: number; outstanding: number; overdue: number; draft: number; count: number }
export interface SurveyorLabour { surveyor_id: string; name: string; regular_hours: number; overtime_hours: number; pay: { currency: string; total: number }[] }
export interface ClientOutstanding { client_id: string; name: string; amounts: { currency: string; amount: number }[] }

export interface InvoicingDashboard {
  billing: CurrencyBilling[]
  jobsByWorkflow: { status: WorkflowStatus; count: number }[]
  openJobs: number
  labour: SurveyorLabour[]
  clients: ClientOutstanding[]
}

export async function getInvoicingDashboard(): Promise<InvoicingDashboard> {
  const supabase = createClient()
  const [{ data: invoices }, { data: jobs }, { data: js }] = await Promise.all([
    supabase.from('invoices').select('status, currency, total, due_date, client_id, client:clients(name)'),
    supabase.from('jobs').select('workflow_status'),
    supabase.from('job_surveyors').select('surveyor_id, regular_hours, overtime_hours, regular_pay, overtime_pay, pay_currency, surveyor:profiles!job_surveyors_surveyor_id_fkey(full_name, display_title)'),
  ])

  // ── Billing, per currency (shared definition) ──
  const billing: CurrencyBilling[] = [...aggregateBilling((invoices ?? []) as any[]).values()]
    .map(b => ({ currency: b.currency, paid: b.paid, outstanding: b.outstanding, overdue: b.overdue, draft: b.draft, count: b.count }))
    .sort((a, b) => b.outstanding - a.outstanding)

  // ── Outstanding per client, per currency (sent/overdue invoices only) ──
  const clientMap = new Map<string, { name: string; cur: Map<string, number> }>()
  for (const inv of (invoices ?? []) as any[]) {
    if (inv.status === 'void' || inv.status === 'paid' || inv.status === 'draft' || !inv.client_id) continue
    const total = Number(inv.total ?? 0)
    let c = clientMap.get(inv.client_id)
    if (!c) { c = { name: inv.client?.name ?? 'Unknown client', cur: new Map() }; clientMap.set(inv.client_id, c) }
    c.cur.set(inv.currency, (c.cur.get(inv.currency) ?? 0) + total)
  }

  // ── Jobs pipeline (shared definition) ──
  const { byStatus: jobsByWorkflow, openJobs } = aggregatePipeline((jobs ?? []) as any[])

  // ── Labour, per surveyor (shared definition) ──
  const labour: SurveyorLabour[] = [...aggregateLabour((js ?? []) as any[]).values()]
    .map(l => ({ surveyor_id: l.surveyor_id, name: l.name, regular_hours: l.regular_hours, overtime_hours: l.overtime_hours, pay: [...l.pay.entries()].map(([currency, total]) => ({ currency, total })) }))
    .filter(s => s.regular_hours || s.overtime_hours)
    .sort((a, b) => b.overtime_hours - a.overtime_hours || b.regular_hours - a.regular_hours)

  const clients: ClientOutstanding[] = [...clientMap.entries()]
    .map(([client_id, c]) => ({ client_id, name: c.name, amounts: [...c.cur.entries()].map(([currency, amount]) => ({ currency, amount })) }))
    .sort((a, b) => b.amounts.reduce((s, x) => s + x.amount, 0) - a.amounts.reduce((s, x) => s + x.amount, 0))

  return { billing, jobsByWorkflow, openJobs, labour, clients }
}
