// Shared metric DEFINITIONS so every surface computes billing / labour / pipeline
// the same way and the numbers can't disagree across Analytics, Invoicing, and the
// dashboards. These are pure functions over already-fetched rows — each surface
// still runs its own query and shapes its own output. This is the shared math,
// deliberately NOT a single god-function that returns everything.

import { isOverdue } from '@/lib/jobs/invoicing'
import { WORKFLOW_ORDER } from '@/lib/jobs/tracker'
import type { WorkflowStatus } from '@/lib/types/database'

// ── Billing per currency ───────────────────────────────────────────────────
// Superset of every surface's needs. invoiced = all non-void; paid; draft;
// outstanding = sent/overdue (excludes draft + paid); overdue ⊆ outstanding.
export interface BillingTotals {
  currency: string
  invoiced: number
  paid: number
  outstanding: number
  overdue: number
  draft: number
  count: number
}

export function aggregateBilling(invoices: any[]): Map<string, BillingTotals> {
  const m = new Map<string, BillingTotals>()
  const get = (cur: string) => {
    let b = m.get(cur)
    if (!b) { b = { currency: cur, invoiced: 0, paid: 0, outstanding: 0, overdue: 0, draft: 0, count: 0 }; m.set(cur, b) }
    return b
  }
  for (const inv of invoices ?? []) {
    if (inv.status === 'void') continue
    const t = Number(inv.total ?? 0)
    const b = get(inv.currency)
    b.count++
    b.invoiced += t
    if (inv.status === 'paid') b.paid += t
    else if (inv.status === 'draft') b.draft += t
    else { b.outstanding += t; if (inv.status === 'overdue' || isOverdue(inv)) b.overdue += t }
  }
  return m
}

// ── Labour per surveyor ────────────────────────────────────────────────────
export interface LabourTotals {
  surveyor_id: string
  name: string
  jobs: Set<string>
  regular_hours: number
  overtime_hours: number
  pay: Map<string, number> // currency → total pay
}

export function aggregateLabour(rows: any[]): Map<string, LabourTotals> {
  const m = new Map<string, LabourTotals>()
  for (const r of rows ?? []) {
    let l = m.get(r.surveyor_id)
    if (!l) {
      l = { surveyor_id: r.surveyor_id, name: r.surveyor?.display_title ?? r.surveyor?.full_name ?? 'Unknown', jobs: new Set(), regular_hours: 0, overtime_hours: 0, pay: new Map() }
      m.set(r.surveyor_id, l)
    }
    if (r.job_id) l.jobs.add(r.job_id)
    l.regular_hours += Number(r.regular_hours ?? 0)
    l.overtime_hours += Number(r.overtime_hours ?? 0)
    const total = Number(r.regular_pay ?? 0) + Number(r.overtime_pay ?? 0)
    if (total) l.pay.set(r.pay_currency ?? 'TTD', (l.pay.get(r.pay_currency ?? 'TTD') ?? 0) + total)
  }
  return m
}

// ── Jobs pipeline by workflow stage ────────────────────────────────────────
export function aggregatePipeline(jobs: { workflow_status: WorkflowStatus }[]): {
  byStatus: { status: WorkflowStatus; count: number }[]
  openJobs: number
} {
  const c = new Map<WorkflowStatus, number>()
  for (const j of jobs ?? []) c.set(j.workflow_status, (c.get(j.workflow_status) ?? 0) + 1)
  const byStatus = WORKFLOW_ORDER.map(status => ({ status, count: c.get(status) ?? 0 }))
  const openJobs = (jobs ?? []).filter(j => j.workflow_status !== 'paid' && j.workflow_status !== 'closed').length
  return { byStatus, openJobs }
}
