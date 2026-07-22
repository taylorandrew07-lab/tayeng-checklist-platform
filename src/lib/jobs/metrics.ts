// Shared metric DEFINITIONS so every surface computes billing / labour / pipeline
// the same way and the numbers can't disagree across Analytics, Invoicing, and the
// dashboards. These are pure functions over already-fetched rows — each surface
// still runs its own query and shapes its own output. This is the shared math,
// deliberately NOT a single god-function that returns everything.

import { WORKFLOW_ORDER } from '@/lib/jobs/tracker'
import type { WorkflowStatus } from '@/lib/types/database'

// ── Billing per currency ───────────────────────────────────────────────────
// Payment is not tracked (migration 146), so paid / outstanding / overdue / draft
// no longer exist — everything non-void is simply invoiced.
export interface BillingTotals {
  currency: string
  invoiced: number
  count: number
}

export function aggregateBilling(invoices: any[]): Map<string, BillingTotals> {
  const m = new Map<string, BillingTotals>()
  const get = (cur: string) => {
    let b = m.get(cur)
    if (!b) { b = { currency: cur, invoiced: 0, count: 0 }; m.set(cur, b) }
    return b
  }
  for (const inv of invoices ?? []) {
    if (inv.status === 'void') continue
    const b = get(inv.currency)
    b.count++
    b.invoiced += Number(inv.total ?? 0)
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
  // Open = not yet invoiced. 'closed' is the only terminal stage post-145.
  const openJobs = (jobs ?? []).filter(j => j.workflow_status !== 'closed').length
  return { byStatus, openJobs }
}
