// Company-wide analytics across every job: operational (pipeline, types, volume
// over time, surveyor workload, overtime) and financial (revenue / outstanding /
// overdue per currency, top clients). All money is grouped by currency.

import { createClient } from '@/lib/supabase/client'
import { isOverdue } from '@/lib/jobs/invoicing'
import { WORKFLOW_ORDER } from '@/lib/jobs/tracker'
import type { WorkflowStatus } from '@/lib/types/database'

export interface MoneyByCurrency { currency: string; amount: number }
export interface CurrencyBilling { currency: string; invoiced: number; paid: number; outstanding: number; overdue: number }

export interface Analytics {
  kpis: { totalJobs: number; openJobs: number; thisMonth: number; awaitingInvoice: number; overdueCount: number; otJobs: number }
  byStatus: { status: WorkflowStatus; count: number }[]
  byType: { type: string; count: number }[]
  byMonth: { label: string; count: number }[]
  topClients: { client_id: string; name: string; jobs: number; revenue: MoneyByCurrency[] }[]
  billing: CurrencyBilling[]
  labour: { surveyor_id: string; name: string; jobs: number; regular_hours: number; overtime_hours: number; pay: MoneyByCurrency[] }[]
  overtimeHours: number
}

export async function getAnalytics(monthsBack = 12): Promise<Analytics> {
  const supabase = createClient()
  const [{ data: jobs }, { data: js }, { data: invoices }] = await Promise.all([
    supabase.from('jobs').select('id, job_type, client_id, workflow_status, is_overtime, scheduled_date, created_at, client:clients(name)'),
    supabase.from('job_surveyors').select('job_id, surveyor_id, regular_hours, overtime_hours, regular_pay, overtime_pay, pay_currency, surveyor:profiles!job_surveyors_surveyor_id_fkey(full_name, display_title)'),
    supabase.from('invoices').select('job_id, client_id, status, total, currency, due_date'),
  ])

  const allJobs = (jobs ?? []) as any[]
  const now = new Date()
  const ym = (iso: string) => { const d = new Date(iso); return d.getFullYear() * 12 + d.getMonth() }
  const nowYm = now.getFullYear() * 12 + now.getMonth()
  const jobDate = (j: any): string => j.scheduled_date ?? j.created_at

  // Invoices indexed by job (first per job) for "awaiting invoice".
  const invByJob = new Set<string>()
  for (const inv of (invoices ?? []) as any[]) if (inv.job_id) invByJob.add(inv.job_id)

  // ── KPIs ──
  const totalJobs = allJobs.length
  const openJobs = allJobs.filter(j => j.workflow_status !== 'paid' && j.workflow_status !== 'closed').length
  const thisMonth = allJobs.filter(j => ym(jobDate(j)) === nowYm).length
  const awaitingInvoice = allJobs.filter(j => j.workflow_status === 'approved' && !invByJob.has(j.id)).length
  const overdueCount = ((invoices ?? []) as any[]).filter(inv => inv.status === 'overdue' || isOverdue(inv)).length
  const otJobs = allJobs.filter(j => j.is_overtime).length

  // ── By status ──
  const statusCount = new Map<WorkflowStatus, number>()
  for (const j of allJobs) statusCount.set(j.workflow_status, (statusCount.get(j.workflow_status) ?? 0) + 1)
  const byStatus = WORKFLOW_ORDER.map(status => ({ status, count: statusCount.get(status) ?? 0 }))

  // ── By type ──
  const typeCount = new Map<string, number>()
  for (const j of allJobs) { const t = j.job_type || 'Unspecified'; typeCount.set(t, (typeCount.get(t) ?? 0) + 1) }
  const byType = [...typeCount.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count)

  // ── By month (last N) ──
  const monthBuckets: { label: string; ym: number; count: number }[] = []
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    monthBuckets.push({ label: `${d.toLocaleString('en-US', { month: 'short' })} ${String(d.getFullYear()).slice(-2)}`, ym: d.getFullYear() * 12 + d.getMonth(), count: 0 })
  }
  for (const j of allJobs) { const b = monthBuckets.find(m => m.ym === ym(jobDate(j))); if (b) b.count++ }
  const byMonth = monthBuckets.map(({ label, count }) => ({ label, count }))

  // ── Revenue per client (non-void invoices) ──
  const clientRev = new Map<string, Map<string, number>>()
  for (const inv of (invoices ?? []) as any[]) {
    if (inv.status === 'void' || !inv.client_id) continue
    let m = clientRev.get(inv.client_id); if (!m) { m = new Map(); clientRev.set(inv.client_id, m) }
    m.set(inv.currency, (m.get(inv.currency) ?? 0) + Number(inv.total ?? 0))
  }
  // ── Jobs per client + name ──
  const clientJobs = new Map<string, { name: string; jobs: number }>()
  for (const j of allJobs) {
    if (!j.client_id) continue
    let c = clientJobs.get(j.client_id); if (!c) { c = { name: j.client?.name ?? 'Unknown', jobs: 0 }; clientJobs.set(j.client_id, c) }
    c.jobs++
  }
  const topClients = [...clientJobs.entries()]
    .map(([client_id, c]) => ({ client_id, name: c.name, jobs: c.jobs, revenue: [...(clientRev.get(client_id)?.entries() ?? [])].map(([currency, amount]) => ({ currency, amount })) }))
    .sort((a, b) => b.jobs - a.jobs)

  // ── Billing per currency ──
  const billMap = new Map<string, CurrencyBilling>()
  const bill = (cur: string) => { let b = billMap.get(cur); if (!b) { b = { currency: cur, invoiced: 0, paid: 0, outstanding: 0, overdue: 0 }; billMap.set(cur, b) } return b }
  for (const inv of (invoices ?? []) as any[]) {
    if (inv.status === 'void') continue
    const t = Number(inv.total ?? 0); const b = bill(inv.currency)
    b.invoiced += t
    if (inv.status === 'paid') b.paid += t
    else if (inv.status !== 'draft') { b.outstanding += t; if (inv.status === 'overdue' || isOverdue(inv)) b.overdue += t }
  }
  const billing = [...billMap.values()].sort((a, b) => b.outstanding - a.outstanding)

  // ── Labour per surveyor ──
  const labMap = new Map<string, { name: string; jobs: Set<string>; reg: number; ot: number; pay: Map<string, number> }>()
  for (const r of (js ?? []) as any[]) {
    let l = labMap.get(r.surveyor_id); if (!l) { l = { name: r.surveyor?.display_title ?? r.surveyor?.full_name ?? 'Unknown', jobs: new Set(), reg: 0, ot: 0, pay: new Map() }; labMap.set(r.surveyor_id, l) }
    if (r.job_id) l.jobs.add(r.job_id)
    l.reg += Number(r.regular_hours ?? 0); l.ot += Number(r.overtime_hours ?? 0)
    const total = Number(r.regular_pay ?? 0) + Number(r.overtime_pay ?? 0)
    if (total) l.pay.set(r.pay_currency ?? 'TTD', (l.pay.get(r.pay_currency ?? 'TTD') ?? 0) + total)
  }
  const labour = [...labMap.entries()]
    .map(([surveyor_id, l]) => ({ surveyor_id, name: l.name, jobs: l.jobs.size, regular_hours: l.reg, overtime_hours: l.ot, pay: [...l.pay.entries()].map(([currency, total]) => ({ currency, amount: total })) }))
    .sort((a, b) => b.jobs - a.jobs)
  const overtimeHours = labour.reduce((s, l) => s + l.overtime_hours, 0)

  return { kpis: { totalJobs, openJobs, thisMonth, awaitingInvoice, overdueCount, otJobs }, byStatus, byType, byMonth, topClients, billing, labour, overtimeHours }
}
