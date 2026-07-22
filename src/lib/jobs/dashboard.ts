// Cross-ledger dashboard: the billing side (what clients owe us) and the labour
// side (hours + overtime we pay surveyors). Money is grouped by currency — TTD
// and USD totals are never summed together.

import { createClient } from '@/lib/supabase/client'
import { WORKFLOW_ORDER } from '@/lib/jobs/tracker'
import type { WorkflowStatus } from '@/lib/types/database'

// Payment is not tracked (migration 146) — total invoiced + count is all that remains.
export interface CurrencyBilling { currency: string; invoiced: number; count: number }
export interface ClientBilled { client_id: string; name: string; amounts: { currency: string; amount: number }[] }

export interface InvoicingDashboard {
  billing: CurrencyBilling[]
  jobsByWorkflow: { status: WorkflowStatus; count: number }[]
  openJobs: number
  clients: ClientBilled[]
}

export async function getInvoicingDashboard(): Promise<InvoicingDashboard> {
  const supabase = createClient()
  // Aggregated server-side (migration 055) — RLS-scoped, no whole-table fetches.
  // Labour is fetched separately (metricsLabourSplit, lib/jobs/labourUnit.ts) so
  // the overview can window it — and so hours and days stay separate columns.
  const [billingRes, pipelineRes, clientsRes] = await Promise.all([
    supabase.rpc('metrics_billing'),
    supabase.rpc('metrics_pipeline'),
    supabase.rpc('metrics_client_billed'),
  ])

  // ── Billing, per currency ──
  const billing: CurrencyBilling[] = ((billingRes.data ?? []) as any[])
    .map(b => ({ currency: b.currency, invoiced: Number(b.invoiced), count: Number(b.count) }))
    .sort((a, b) => b.invoiced - a.invoiced)

  // ── Jobs pipeline (fill every stage from the counts) ──
  const wf = new Map<string, number>()
  for (const r of (pipelineRes.data ?? []) as any[]) wf.set(r.workflow_status, Number(r.count))
  const jobsByWorkflow = WORKFLOW_ORDER.map(status => ({ status, count: wf.get(status) ?? 0 }))
  // Open = not yet invoiced. 'closed' is the only terminal stage post-145.
  const openJobs = WORKFLOW_ORDER.filter(s => s !== 'closed').reduce((n, s) => n + (wf.get(s) ?? 0), 0)

  // ── Billed per client (one row per client+currency → group) ──
  const cmap = new Map<string, { name: string; amounts: Map<string, number> }>()
  for (const r of (clientsRes.data ?? []) as any[]) {
    let c = cmap.get(r.client_id)
    if (!c) { c = { name: r.name, amounts: new Map() }; cmap.set(r.client_id, c) }
    c.amounts.set(r.currency, (c.amounts.get(r.currency) ?? 0) + Number(r.amount))
  }
  const clients: ClientBilled[] = [...cmap.entries()]
    .map(([client_id, c]) => ({ client_id, name: c.name, amounts: [...c.amounts.entries()].map(([currency, amount]) => ({ currency, amount })) }))
    .sort((a, b) => b.amounts.reduce((s, x) => s + x.amount, 0) - a.amounts.reduce((s, x) => s + x.amount, 0))

  return { billing, jobsByWorkflow, openJobs, clients }
}
