// One client's full picture: their jobs, their invoices, and rolled-up billing.
// Reuses the shared billing definition so the per-client numbers match every
// other surface.

import { createClient } from '@/lib/supabase/client'
import { aggregateBilling, type BillingTotals } from '@/lib/jobs/metrics'
import { isOverdue } from '@/lib/jobs/invoicing'
import { getClientBilling } from '@/lib/clients/billing'
import type { Client, ClientBilling, WorkflowStatus } from '@/lib/types/database'

export interface ClientJobRow {
  id: string
  report_number: string | null
  vessel_name: string | null
  title: string
  workflow_status: WorkflowStatus
  scheduled_date: string | null
  created_at: string
  invoice_number: string | null
  invoice_status: string | null
  invoice_total: number | null
  invoice_currency: string | null
}

export interface ClientInvoiceRow {
  id: string
  invoice_number: string | null
  status: string
  total: number
  currency: string
  due_date: string | null
  job_id: string | null
  overdue: boolean
}

export interface ClientDetail {
  client: Client
  clientBilling: ClientBilling | null
  jobCount: number
  openJobs: number
  billing: BillingTotals[]
  jobs: ClientJobRow[]
  invoices: ClientInvoiceRow[]
}

export async function getClientDetail(clientId: string): Promise<ClientDetail | null> {
  const supabase = createClient()
  const [{ data: client }, { data: jobs }, { data: invs }, clientBilling] = await Promise.all([
    supabase.from('clients').select('*').eq('id', clientId).single(),
    supabase.from('jobs')
      .select('id, report_number, vessel_name, title, workflow_status, scheduled_date, created_at, invoice_id')
      .eq('client_id', clientId).order('created_at', { ascending: false }),
    supabase.from('invoices')
      .select('id, invoice_number, status, total, currency, due_date, job_id, created_at')
      .eq('client_id', clientId).order('created_at', { ascending: false }),
    getClientBilling(clientId),
  ])
  if (!client) return null

  // Annotate the jobs table with its invoice. Legacy per-job invoices link via
  // invoices.job_id; consolidated invoices (job_id NULL) link via jobs.invoice_id —
  // resolve both, else consolidated-billed jobs show a blank invoice column.
  const invByJob = new Map<string, any>()
  const invById = new Map<string, any>()
  for (const inv of (invs ?? []) as any[]) {
    invById.set(inv.id, inv)
    if (inv.job_id && !invByJob.has(inv.job_id)) invByJob.set(inv.job_id, inv)
  }

  const jobRows: ClientJobRow[] = ((jobs ?? []) as any[]).map(j => {
    const inv = invByJob.get(j.id) ?? (j.invoice_id ? invById.get(j.invoice_id) : null)
    return {
      id: j.id, report_number: j.report_number, vessel_name: j.vessel_name, title: j.title,
      workflow_status: j.workflow_status, scheduled_date: j.scheduled_date, created_at: j.created_at,
      invoice_number: inv?.invoice_number ?? null, invoice_status: inv?.status ?? null,
      invoice_total: inv ? Number(inv.total ?? 0) : null, invoice_currency: inv?.currency ?? null,
    }
  })

  const invoiceRows: ClientInvoiceRow[] = ((invs ?? []) as any[]).map(inv => ({
    id: inv.id, invoice_number: inv.invoice_number, status: inv.status,
    total: Number(inv.total ?? 0), currency: inv.currency, due_date: inv.due_date, job_id: inv.job_id,
    overdue: inv.status === 'overdue' || isOverdue(inv),
  }))

  const billing = [...aggregateBilling((invs ?? []) as any[]).values()].sort((a, b) => b.outstanding - a.outstanding)
  // Open = not yet invoiced. 'closed' is the only terminal stage post-145.
  const openJobs = ((jobs ?? []) as any[]).filter(j => j.workflow_status !== 'closed').length

  return { client: client as Client, clientBilling, jobCount: (jobs ?? []).length, openJobs, billing, jobs: jobRows, invoices: invoiceRows }
}
