// Cross-ledger dashboard: the billing side (what clients owe us) and the labour
// side (hours + overtime we pay surveyors). Money is grouped by currency — TTD
// and USD totals are never summed together.

import { createClient } from '@/lib/supabase/client'
import { isOverdue } from '@/lib/jobs/invoicing'
import { WORKFLOW_ORDER } from '@/lib/jobs/tracker'
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

  // ── Billing, per currency ──
  const billMap = new Map<string, CurrencyBilling>()
  const bill = (cur: string) => {
    let b = billMap.get(cur)
    if (!b) { b = { currency: cur, paid: 0, outstanding: 0, overdue: 0, draft: 0, count: 0 }; billMap.set(cur, b) }
    return b
  }
  // Outstanding per client, per currency.
  const clientMap = new Map<string, { name: string; cur: Map<string, number> }>()

  for (const inv of (invoices ?? []) as any[]) {
    if (inv.status === 'void') continue
    const total = Number(inv.total ?? 0)
    const b = bill(inv.currency)
    b.count++
    if (inv.status === 'paid') { b.paid += total; continue }
    if (inv.status === 'draft') { b.draft += total; continue }
    // sent / overdue → outstanding
    b.outstanding += total
    if (inv.status === 'overdue' || isOverdue(inv)) b.overdue += total
    // accrue to the client's outstanding
    if (inv.client_id) {
      let c = clientMap.get(inv.client_id)
      if (!c) { c = { name: inv.client?.name ?? 'Unknown client', cur: new Map() }; clientMap.set(inv.client_id, c) }
      c.cur.set(inv.currency, (c.cur.get(inv.currency) ?? 0) + total)
    }
  }
  const billing = [...billMap.values()].sort((a, b) => b.outstanding - a.outstanding)

  // ── Jobs pipeline ──
  const wfCount = new Map<WorkflowStatus, number>()
  for (const j of (jobs ?? []) as any[]) wfCount.set(j.workflow_status, (wfCount.get(j.workflow_status) ?? 0) + 1)
  const jobsByWorkflow = WORKFLOW_ORDER.map(status => ({ status, count: wfCount.get(status) ?? 0 }))
  const openJobs = (jobs ?? []).filter((j: any) => j.workflow_status !== 'paid' && j.workflow_status !== 'closed').length

  // ── Labour, per surveyor ──
  const labMap = new Map<string, { name: string; reg: number; ot: number; pay: Map<string, number> }>()
  for (const r of (js ?? []) as any[]) {
    let l = labMap.get(r.surveyor_id)
    if (!l) { l = { name: r.surveyor?.display_title ?? r.surveyor?.full_name ?? 'Unknown', reg: 0, ot: 0, pay: new Map() }; labMap.set(r.surveyor_id, l) }
    l.reg += Number(r.regular_hours ?? 0)
    l.ot += Number(r.overtime_hours ?? 0)
    const total = Number(r.regular_pay ?? 0) + Number(r.overtime_pay ?? 0)
    if (total) l.pay.set(r.pay_currency ?? 'TTD', (l.pay.get(r.pay_currency ?? 'TTD') ?? 0) + total)
  }
  const labour: SurveyorLabour[] = [...labMap.entries()]
    .map(([surveyor_id, l]) => ({ surveyor_id, name: l.name, regular_hours: l.reg, overtime_hours: l.ot, pay: [...l.pay.entries()].map(([currency, total]) => ({ currency, total })) }))
    .filter(s => s.regular_hours || s.overtime_hours)
    .sort((a, b) => b.overtime_hours - a.overtime_hours || b.regular_hours - a.regular_hours)

  const clients: ClientOutstanding[] = [...clientMap.entries()]
    .map(([client_id, c]) => ({ client_id, name: c.name, amounts: [...c.cur.entries()].map(([currency, amount]) => ({ currency, amount })) }))
    .sort((a, b) => b.amounts.reduce((s, x) => s + x.amount, 0) - a.amounts.reduce((s, x) => s + x.amount, 0))

  return { billing, jobsByWorkflow, openJobs, labour, clients }
}
