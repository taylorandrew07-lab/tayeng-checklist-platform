// Company-wide analytics across every job: operational (pipeline, types, volume
// over time, surveyor workload, overtime) and financial (revenue / outstanding /
// overdue per currency, top clients). All money is grouped by currency.

import { createClient } from '@/lib/supabase/client'
import { isOverdue } from '@/lib/jobs/invoicing'
import { aggregateBilling, aggregatePipeline } from '@/lib/jobs/metrics'
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

// Map the metrics_labour RPC rows to the Analytics labour shape (shared by both paths).
function mapLabour(rows: any[]): Analytics['labour'] {
  return (rows ?? [])
    .map(l => ({ surveyor_id: l.surveyor_id, name: l.name, jobs: Number(l.jobs), regular_hours: Number(l.regular_hours), overtime_hours: Number(l.overtime_hours), pay: Object.entries((l.pay ?? {}) as Record<string, number>).map(([currency, amount]) => ({ currency, amount: Number(amount) })) }))
    .sort((a, b) => b.jobs - a.jobs)
}

/**
 * Company-wide analytics. Fast path: server-side aggregation via RPCs
 * (metrics_analytics for job KPIs/by-type/by-month/top-clients, plus the proven
 * metrics_pipeline / metrics_billing / metrics_labour) so whole tables never reach
 * the browser. Falls back to the in-browser computation (getAnalyticsClient) if the
 * RPC is unavailable or errors — so the dashboard never breaks.
 */
export async function getAnalytics(monthsBack = 12): Promise<Analytics> {
  const supabase = createClient()
  try {
    const [aRes, pipeRes, billRes, labourRes] = await Promise.all([
      supabase.rpc('metrics_analytics', { p_months_back: monthsBack }),
      supabase.rpc('metrics_pipeline'),
      supabase.rpc('metrics_billing'),
      supabase.rpc('metrics_labour'),
    ])
    const a = aRes.data as any
    if (aRes.error || !a || !a.kpis) throw aRes.error ?? new Error('analytics rpc empty')

    // byStatus in WORKFLOW_ORDER (identical to aggregatePipeline), from the pipeline RPC.
    const statusCount = new Map<string, number>()
    for (const r of (pipeRes.data ?? []) as any[]) statusCount.set(r.workflow_status, Number(r.count))
    const byStatus = WORKFLOW_ORDER.map(status => ({ status, count: statusCount.get(status) ?? 0 }))

    // billing per currency (proven definition), sorted by outstanding desc.
    const billing: CurrencyBilling[] = ((billRes.data ?? []) as any[])
      .map(b => ({ currency: b.currency, invoiced: Number(b.invoiced), paid: Number(b.paid), outstanding: Number(b.outstanding), overdue: Number(b.overdue) }))
      .sort((x, y) => y.outstanding - x.outstanding)

    // byMonth: build the same N-month skeleton + labels as before, fill from RPC counts.
    const now = new Date()
    const monthCounts = new Map<string, number>()
    for (const r of (a.byMonth ?? []) as any[]) monthCounts.set(String(r.ym), Number(r.count))
    const byMonth: { label: string; count: number }[] = []
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      byMonth.push({ label: `${d.toLocaleString('en-US', { month: 'short' })} ${String(d.getFullYear()).slice(-2)}`, count: monthCounts.get(key) ?? 0 })
    }

    const labour = mapLabour((labourRes.data ?? []) as any[])
    return {
      kpis: a.kpis,
      byStatus,
      byType: (a.byType ?? []) as { type: string; count: number }[],
      byMonth,
      topClients: (a.topClients ?? []) as Analytics['topClients'],
      billing,
      labour,
      overtimeHours: labour.reduce((s, l) => s + l.overtime_hours, 0),
    }
  } catch {
    return getAnalyticsClient(monthsBack)
  }
}

// In-browser fallback (the original implementation): used only if the RPC path fails.
async function getAnalyticsClient(monthsBack = 12): Promise<Analytics> {
  const supabase = createClient()
  const [{ data: jobs }, labourRes, { data: invoices }] = await Promise.all([
    supabase.from('jobs').select('id, job_type, client_id, workflow_status, is_overtime, scheduled_date, created_at, client:clients(name)'),
    supabase.rpc('metrics_labour'), // aggregated server-side (migration 055)
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

  // ── By status (shared pipeline definition) ──
  const { byStatus } = aggregatePipeline(allJobs)

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

  // ── Billing per currency (shared definition) ──
  const billing: CurrencyBilling[] = [...aggregateBilling((invoices ?? []) as any[]).values()]
    .map(b => ({ currency: b.currency, invoiced: b.invoiced, paid: b.paid, outstanding: b.outstanding, overdue: b.overdue }))
    .sort((a, b) => b.outstanding - a.outstanding)

  // ── Labour per surveyor (aggregated server-side, migration 055) ──
  const labour = ((labourRes.data ?? []) as any[])
    .map(l => ({ surveyor_id: l.surveyor_id, name: l.name, jobs: Number(l.jobs), regular_hours: Number(l.regular_hours), overtime_hours: Number(l.overtime_hours), pay: Object.entries((l.pay ?? {}) as Record<string, number>).map(([currency, amount]) => ({ currency, amount: Number(amount) })) }))
    .sort((a, b) => b.jobs - a.jobs)
  const overtimeHours = labour.reduce((s, l) => s + l.overtime_hours, 0)

  return { kpis: { totalJobs, openJobs, thisMonth, awaitingInvoice, overdueCount, otJobs }, byStatus, byType, byMonth, topClients, billing, labour, overtimeHours }
}
