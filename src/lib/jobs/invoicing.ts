// Billing ledger: client rates, the per-job invoice (line items + taxes), the
// invoices list, and app settings. Admin-driven for now; office can READ with
// the invoicing.view permission (enforced by RLS — this layer just queries).

import { createClient } from '@/lib/supabase/client'
import { logActivity } from '@/lib/jobs/tracker'
import type {
  AppSettings, ClientRate, Currency, Invoice, InvoiceLineItem, InvoiceTax, Job,
} from '@/lib/types/database'

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

// ── App settings (single row) ────────────────────────────────────────────────
export async function getAppSettings(): Promise<AppSettings | null> {
  const { data } = await createClient().from('app_settings').select('*').eq('id', true).maybeSingle()
  return (data as AppSettings) ?? null
}
export async function updateAppSettings(patch: Partial<Pick<AppSettings, 'default_tax_name' | 'default_tax_rate' | 'overdue_days' | 'bank_details_default'>>): Promise<{ error?: string }> {
  const { error } = await createClient().from('app_settings').update(patch).eq('id', true)
  return { error: error?.message }
}

// ── Client rates ─────────────────────────────────────────────────────────────
export async function listClientRates(clientId?: string): Promise<ClientRate[]> {
  let q = createClient().from('client_rates').select('*').order('created_at', { ascending: false })
  if (clientId) q = q.eq('client_id', clientId)
  const { data } = await q
  return (data ?? []) as ClientRate[]
}

export async function addClientRate(rate: Omit<ClientRate, 'id' | 'created_at' | 'is_active'>): Promise<{ error?: string }> {
  const { error } = await createClient().from('client_rates').insert({ ...rate, is_active: true })
  return { error: error?.message }
}
export async function updateClientRate(id: string, patch: Partial<ClientRate>): Promise<{ error?: string }> {
  const { error } = await createClient().from('client_rates').update(patch).eq('id', id)
  return { error: error?.message }
}
export async function deleteClientRate(id: string): Promise<{ error?: string }> {
  const { error } = await createClient().from('client_rates').delete().eq('id', id)
  return { error: error?.message }
}

/** Best matching rate for a job: exact job-type match wins, else the any-type default. */
export async function getClientRate(clientId: string | null, jobType: string | null): Promise<ClientRate | null> {
  if (!clientId) return null
  const rates = (await listClientRates(clientId)).filter(r => r.is_active)
  return rates.find(r => r.job_type === jobType) ?? rates.find(r => !r.job_type) ?? null
}

// ── The per-job invoice (one invoice per job in the builder) ─────────────────
export interface LineDraft { description: string; qty: number; unit_price: number }
export interface TaxDraft { name: string; rate: number }

export interface JobInvoice {
  invoice: Invoice
  lines: InvoiceLineItem[]
  taxes: InvoiceTax[]
}

export function computeTotals(lines: LineDraft[], taxes: TaxDraft[]) {
  const subtotal = r2(lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0))
  const taxAmounts = taxes.map(t => r2(subtotal * (Number(t.rate) || 0) / 100))
  const tax_total = r2(taxAmounts.reduce((s, a) => s + a, 0))
  return { subtotal, taxAmounts, tax_total, total: r2(subtotal + tax_total) }
}

export async function getJobInvoice(jobId: string): Promise<JobInvoice | null> {
  const supabase = createClient()
  const { data: invoice } = await supabase.from('invoices').select('*').eq('job_id', jobId).maybeSingle()
  if (!invoice) return null
  const [{ data: lines }, { data: taxes }] = await Promise.all([
    supabase.from('invoice_line_items').select('*').eq('invoice_id', invoice.id).order('sort'),
    supabase.from('invoice_taxes').select('*').eq('invoice_id', invoice.id),
  ])
  return { invoice: invoice as Invoice, lines: (lines ?? []) as InvoiceLineItem[], taxes: (taxes ?? []) as InvoiceTax[] }
}

/** Create or replace the job's invoice (header + line items + taxes), recomputing totals. */
export async function saveJobInvoice(job: Job, data: {
  invoice_number?: string | null
  currency: Currency; due_date: string | null; notes: string | null
  description: string | null; reference: string | null; attention: string | null; bank_details: string | null
  lines: LineDraft[]; taxes: TaxDraft[]
}): Promise<{ error?: string; invoiceId?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { subtotal, taxAmounts, tax_total, total } = computeTotals(data.lines, data.taxes)
  const header = {
    client_id: job.client_id, currency: data.currency,
    due_date: data.due_date || null, notes: data.notes || null,
    description: data.description || null, reference: data.reference || null,
    attention: data.attention || null, bank_details: data.bank_details || null,
    subtotal, tax_total, total,
  }

  const { data: existing } = await supabase.from('invoices').select('id').eq('job_id', job.id).maybeSingle()
  let invoiceId: string
  if (existing) {
    invoiceId = existing.id
    // Only overwrite the number when one was explicitly supplied (keeps the
    // auto-assigned number unless an admin edits it).
    const patch = data.invoice_number != null ? { ...header, invoice_number: data.invoice_number || null } : header
    const { error } = await supabase.from('invoices').update(patch).eq('id', invoiceId)
    if (error) return { error: error.message }
  } else {
    // On insert, a blank number lets the DB trigger assign YY-MM-NNN.
    const insert: Record<string, unknown> = { job_id: job.id, status: 'draft', created_by: user?.id ?? null, ...header }
    if (data.invoice_number) insert.invoice_number = data.invoice_number
    const { data: ins, error } = await supabase.from('invoices').insert(insert).select('id').single()
    if (error) return { error: error.message }
    invoiceId = ins.id
  }

  await supabase.from('invoice_line_items').delete().eq('invoice_id', invoiceId)
  if (data.lines.length) {
    const rows = data.lines.map((l, i) => ({
      invoice_id: invoiceId, description: l.description,
      qty: Number(l.qty) || 0, unit_price: Number(l.unit_price) || 0,
      amount: r2((Number(l.qty) || 0) * (Number(l.unit_price) || 0)), sort: i,
    }))
    const { error } = await supabase.from('invoice_line_items').insert(rows)
    if (error) return { error: error.message }
  }

  await supabase.from('invoice_taxes').delete().eq('invoice_id', invoiceId)
  if (data.taxes.length) {
    const rows = data.taxes.map((t, i) => ({ invoice_id: invoiceId, name: t.name, rate: Number(t.rate) || 0, amount: taxAmounts[i] }))
    const { error } = await supabase.from('invoice_taxes').insert(rows)
    if (error) return { error: error.message }
  }

  await logActivity('job', job.id, 'invoice:save', { invoice_id: invoiceId, total })
  return { invoiceId }
}

/** Delete a job's invoice (line items + taxes cascade) and revert the job out
 *  of the billing stages back to "report approved". */
export async function deleteJobInvoice(invoiceId: string, jobId: string | null): Promise<{ error?: string }> {
  const supabase = createClient()
  const { error } = await supabase.from('invoices').delete().eq('id', invoiceId)
  if (error) return { error: error.message }
  if (jobId) {
    await supabase.from('jobs')
      .update({ workflow_status: 'approved', paid_at: null })
      .eq('id', jobId)
      .in('workflow_status', ['invoiced', 'sent', 'paid'])
    await logActivity('job', jobId, 'invoice:delete', { invoice_id: invoiceId })
  }
  return {}
}

/** Move an invoice through sent / paid / void, stamping the matching timestamp.
 *  On "sent", default a due date (issue date + overdue window) so overdue
 *  tracking has something to measure against. */
export async function setInvoiceStatus(invoiceId: string, status: Invoice['status']): Promise<{ error?: string }> {
  const supabase = createClient()
  const patch: Record<string, unknown> = { status }
  if (status === 'paid') patch.paid_at = new Date().toISOString()
  if (status === 'sent') {
    patch.sent_at = new Date().toISOString()
    const { data: inv } = await supabase.from('invoices').select('issue_date, due_date').eq('id', invoiceId).single()
    if (inv && !inv.due_date) {
      const settings = await getAppSettings()
      const days = settings?.overdue_days ?? 30
      const base = inv.issue_date ? new Date(`${inv.issue_date}T00:00:00`) : new Date()
      base.setDate(base.getDate() + days)
      patch.due_date = base.toISOString().slice(0, 10)
    }
  }
  const { error } = await supabase.from('invoices').update(patch).eq('id', invoiceId)
  return { error: error?.message }
}

/** Record that an (overdue) invoice was chased today. */
export async function logInvoiceReminder(invoiceId: string): Promise<{ error?: string }> {
  const { error } = await createClient().from('invoices').update({ last_reminded_at: new Date().toISOString() }).eq('id', invoiceId)
  return { error: error?.message }
}

// ── Invoices list (admin + office read) ──────────────────────────────────────
export interface InvoiceListRow {
  id: string; invoice_number: string | null; status: Invoice['status']
  currency: Currency; total: number; issue_date: string; due_date: string | null
  sent_at: string | null; paid_at: string | null
  client_name: string | null; report_number: string | null; vessel_name: string | null; job_id: string | null
}
export async function listInvoices(): Promise<InvoiceListRow[]> {
  const { data } = await createClient()
    .from('invoices')
    .select('id, invoice_number, status, currency, total, issue_date, due_date, sent_at, paid_at, job_id, client:clients(name), job:jobs(report_number, vessel_name)')
    .order('created_at', { ascending: false })
  return ((data ?? []) as any[]).map(r => ({
    id: r.id, invoice_number: r.invoice_number, status: r.status, currency: r.currency,
    total: Number(r.total ?? 0), issue_date: r.issue_date, due_date: r.due_date,
    sent_at: r.sent_at, paid_at: r.paid_at, job_id: r.job_id,
    client_name: r.client?.name ?? null,
    report_number: r.job?.report_number ?? null, vessel_name: r.job?.vessel_name ?? null,
  }))
}

/** True when a sent invoice is past its due date (derived, not a stored status). */
export function isOverdue(row: { status: Invoice['status']; due_date: string | null }, today = new Date().toISOString().slice(0, 10)): boolean {
  return row.status === 'sent' && !!row.due_date && row.due_date < today
}
