// One client's full picture: their jobs, their invoices, and rolled-up billing.
// Reuses the shared billing definition so the per-client numbers match every
// other surface.

import { createClient } from '@/lib/supabase/client'
import { aggregateBilling, type BillingTotals } from '@/lib/jobs/metrics'
import { isOverdue } from '@/lib/jobs/invoicing'
import type { Client, WorkflowStatus } from '@/lib/types/database'

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
  jobCount: number
  openJobs: number
  billing: BillingTotals[]
  jobs: ClientJobRow[]
  invoices: ClientInvoiceRow[]
}

export async function getClientDetail(clientId: string): Promise<ClientDetail | null> {
  const supabase = createClient()
  const [{ data: client }, { data: jobs }, { data: invs }] = await Promise.all([
    supabase.from('clients').select('*').eq('id', clientId).single(),
    supabase.from('jobs')
      .select('id, report_number, vessel_name, title, workflow_status, scheduled_date, created_at')
      .eq('client_id', clientId).order('created_at', { ascending: false }),
    supabase.from('invoices')
      .select('id, invoice_number, status, total, currency, due_date, job_id, created_at')
      .eq('client_id', clientId).order('created_at', { ascending: false }),
  ])
  if (!client) return null

  // First invoice per job, to annotate the jobs table.
  const invByJob = new Map<string, any>()
  for (const inv of (invs ?? []) as any[]) if (inv.job_id && !invByJob.has(inv.job_id)) invByJob.set(inv.job_id, inv)

  const jobRows: ClientJobRow[] = ((jobs ?? []) as any[]).map(j => {
    const inv = invByJob.get(j.id)
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
  const openJobs = ((jobs ?? []) as any[]).filter(j => j.workflow_status !== 'paid' && j.workflow_status !== 'closed').length

  return { client: client as Client, jobCount: (jobs ?? []).length, openJobs, billing, jobs: jobRows, invoices: invoiceRows }
}
