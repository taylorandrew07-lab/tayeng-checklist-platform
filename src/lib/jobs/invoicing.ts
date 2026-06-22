// Billing ledger: client rates, the per-job invoice (line items + taxes), the
// invoices list, and app settings. Admin-driven for now; office can READ with
// the invoicing.view permission (enforced by RLS — this layer just queries).

import { createClient } from '@/lib/supabase/client'
import { logActivity, setWorkflowStatus } from '@/lib/jobs/tracker'
import type {
  AppSettings, BankAccount, ClientRate, Currency, Invoice, InvoiceLineItem, InvoiceTax, Job,
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
    // Confirm the header update actually applied BEFORE we wipe + rewrite the line
    // items/taxes below — otherwise a 0-row RLS denial would delete the children of
    // an invoice the user couldn't modify.
    const { data: upd, error } = await supabase.from('invoices').update(patch).eq('id', invoiceId).select('id')
    if (error) return { error: error.message }
    if (!upd || upd.length === 0) return { error: 'Could not save the invoice — permission denied or it no longer exists.' }
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
    // Surface a failed revert so the job can't be left in a billing stage with no
    // invoice. (0 rows is legitimate here — the .in() filter just means the job
    // wasn't in a billing stage — so only a real error is treated as a failure.)
    const { error: revErr } = await supabase.from('jobs')
      .update({ workflow_status: 'approved', paid_at: null })
      .eq('id', jobId)
      .in('workflow_status', ['invoiced', 'sent', 'paid'])
    if (revErr) return { error: revErr.message }
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
  const { data, error } = await supabase.from('invoices').update(patch).eq('id', invoiceId).select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'That change was blocked — you may not have permission to update this invoice.' }
  return {}
}

/** Mark an invoice sent/paid AND advance its job(s) to match, so the Jobs tracker
 *  reflects the billing stage. Works for consolidated (jobs.invoice_id) and legacy
 *  per-job (invoices.job_id) invoices. The invoice status is the source of truth;
 *  the job advances are best-effort. */
export async function setInvoiceAndJobsStatus(invoiceId: string, status: 'sent' | 'paid'): Promise<{ error?: string }> {
  const res = await setInvoiceStatus(invoiceId, status)
  if (res.error) return res
  const supabase = createClient()
  const ids = new Set<string>()
  const { data: linked } = await supabase.from('jobs').select('id').eq('invoice_id', invoiceId)
  ;(linked ?? []).forEach((j: any) => ids.add(j.id))
  const { data: inv } = await supabase.from('invoices').select('job_id').eq('id', invoiceId).maybeSingle()
  if (inv?.job_id) ids.add(inv.job_id)
  for (const id of ids) await setWorkflowStatus(id, status)
  return {}
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
  client_name: string | null; bill_to_name: string | null
  report_number: string | null; vessel_name: string | null; job_id: string | null
  // Consolidated invoices (no single job_id) carry many vessels — one line each.
  line_count: number
}
export async function listInvoices(): Promise<InvoiceListRow[]> {
  // invoices now has two FKs to clients (client_id, bill_to_client_id) and two to
  // jobs (invoices.job_id, jobs.invoice_id), so every embed is hinted by its FK.
  const { data } = await createClient()
    .from('invoices')
    .select('id, invoice_number, status, currency, total, issue_date, due_date, sent_at, paid_at, job_id, client:clients!invoices_client_id_fkey(name), bill_to:clients!invoices_bill_to_client_id_fkey(name), job:jobs!invoices_job_id_fkey(report_number, vessel_name), line_items:invoice_line_items(count)')
    .order('created_at', { ascending: false })
  return ((data ?? []) as any[]).map(r => ({
    id: r.id, invoice_number: r.invoice_number, status: r.status, currency: r.currency,
    total: Number(r.total ?? 0), issue_date: r.issue_date, due_date: r.due_date,
    sent_at: r.sent_at, paid_at: r.paid_at, job_id: r.job_id,
    client_name: r.client?.name ?? null,
    bill_to_name: r.bill_to?.name ?? null,
    report_number: r.job?.report_number ?? null, vessel_name: r.job?.vessel_name ?? null,
    line_count: Number(r.line_items?.[0]?.count ?? 0),
  }))
}

/** True when a sent invoice is past its due date (derived, not a stored status). */
export function isOverdue(row: { status: Invoice['status']; due_date: string | null }, today = new Date().toISOString().slice(0, 10)): boolean {
  return row.status === 'sent' && !!row.due_date && row.due_date < today
}

// ── Bank accounts (selectable on invoices) ───────────────────────────────────
export async function listBankAccounts(activeOnly = false): Promise<BankAccount[]> {
  let q = createClient().from('bank_accounts').select('*')
    .order('is_default', { ascending: false }).order('sort').order('label')
  if (activeOnly) q = q.eq('is_active', true)
  const { data } = await q
  return (data ?? []) as BankAccount[]
}

/** Create or update a bank account. Enforces a single default across the set. */
export async function saveBankAccount(input: {
  id?: string; label: string; currency: Currency | null; details: string; is_default: boolean; is_active?: boolean
}): Promise<{ error?: string }> {
  const supabase = createClient()
  const row = { label: input.label, currency: input.currency, details: input.details, is_default: input.is_default, is_active: input.is_active ?? true }
  let savedId = input.id
  if (input.id) {
    const { error } = await supabase.from('bank_accounts').update(row).eq('id', input.id)
    if (error) return { error: error.message }
  } else {
    const { data, error } = await supabase.from('bank_accounts').insert(row).select('id').single()
    if (error) return { error: error.message }
    savedId = data.id as string
  }
  if (input.is_default && savedId) {
    const { error } = await supabase.from('bank_accounts').update({ is_default: false }).neq('id', savedId).eq('is_default', true)
    if (error) return { error: error.message }
  }
  return {}
}

export async function deleteBankAccount(id: string): Promise<{ error?: string }> {
  const { error } = await createClient().from('bank_accounts').delete().eq('id', id)
  return { error: error?.message }
}

// ── Invoice auto-numbering controls (admin) ──────────────────────────────────
export interface InvoiceCounter { fiscal_year: number; last_seq: number; next_number: string }

/** Current invoice-numbering position (admin only — RPC enforces it). */
export async function getInvoiceCounter(): Promise<InvoiceCounter | null> {
  const { data, error } = await createClient().rpc('get_invoice_counter')
  if (error) return null
  const row = Array.isArray(data) ? data[0] : data
  return (row as InvoiceCounter) ?? null
}

/** Set where auto-numbering is, by the NEXT number to issue (so last_seq = next-1).
 *  e.g. nextSeq=1 restarts at INV-YY/0001. */
export async function setInvoiceNextNumber(nextSeq: number): Promise<{ error?: string }> {
  const last = Math.max(0, Math.floor(nextSeq) - 1)
  const { error } = await createClient().rpc('set_invoice_counter', { p_last_seq: last })
  return { error: error?.message }
}

// ── Consolidated, Finance-driven invoices (many vessels on one invoice) ───────

/** The most recently created invoice number — shown when building a new invoice so
 *  you can see the last number (and pick the next one) or leave it to auto-assign. */
export async function getLatestInvoiceNumber(): Promise<string | null> {
  const { data } = await createClient().from('invoices')
    .select('invoice_number').not('invoice_number', 'is', null)
    .order('created_at', { ascending: false }).limit(1)
  return (data?.[0] as any)?.invoice_number ?? null
}

/** Active clients for the work-client and bill-to dropdowns. */
export async function listBillingClients(): Promise<{ id: string; name: string }[]> {
  const { data } = await createClient().from('clients').select('id, name').eq('is_active', true).order('name')
  return (data ?? []) as { id: string; name: string }[]
}

export interface InvoiceableJob {
  id: string; report_number: string | null; vessel_name: string | null
  job_type: string | null; client_id: string | null; client_name: string | null
  scheduled_date: string | null; created_at: string; workflow_status: Job['workflow_status']
}

/** Jobs whose work is done (report-ready or approved) and not yet on an invoice —
 *  the pool the Finance "create invoice" flow draws from. Report-ready is included
 *  on purpose so jobs awaiting approval aren't invisible to billing. Optionally
 *  narrowed to a client and/or a YYYY-MM month (by scheduled date, else created). */
export async function listInvoiceableJobs(opts: { clientId?: string; month?: string } = {}): Promise<InvoiceableJob[]> {
  // jobs → clients has a single FK (client_id), so this embed needs no hint.
  let q = createClient().from('jobs')
    .select('id, report_number, vessel_name, job_type, client_id, scheduled_date, created_at, workflow_status, client:clients(name)')
    .is('invoice_id', null)
    .in('workflow_status', ['report_ready', 'approved'])
    .order('scheduled_date', { ascending: true, nullsFirst: false })
  if (opts.clientId) q = q.eq('client_id', opts.clientId)
  const { data } = await q
  let rows = ((data ?? []) as any[]).map(j => ({
    id: j.id, report_number: j.report_number, vessel_name: j.vessel_name, job_type: j.job_type,
    client_id: j.client_id, client_name: j.client?.name ?? null,
    scheduled_date: j.scheduled_date, created_at: j.created_at, workflow_status: j.workflow_status,
  })) as InvoiceableJob[]
  if (opts.month) rows = rows.filter(r => (r.scheduled_date ?? r.created_at ?? '').slice(0, 7) === opts.month)
  return rows
}

export interface ConsolidatedLine { job_id: string; description: string; qty: number; unit_price: number }

/** Create one invoice spanning many jobs/vessels, stamp each job with it, and
 *  advance those jobs to "invoiced". client_id = whose vessels these are (e.g. BP);
 *  bill_to_client_id = who pays / who it's addressed to (e.g. ASCO), NULL if same. */
export async function createConsolidatedInvoice(input: {
  client_id: string | null
  bill_to_client_id: string | null
  invoice_number?: string | null
  currency: Currency; due_date: string | null; notes: string | null
  description: string | null; reference: string | null; attention: string | null; bank_details: string | null
  lines: ConsolidatedLine[]; taxes: TaxDraft[]
}): Promise<{ error?: string; invoiceId?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (input.lines.length === 0) return { error: 'Select at least one job to invoice.' }

  const { subtotal, taxAmounts, tax_total, total } = computeTotals(input.lines, input.taxes)
  const insert: Record<string, unknown> = {
    job_id: null, client_id: input.client_id, bill_to_client_id: input.bill_to_client_id,
    status: 'draft', created_by: user?.id ?? null,
    currency: input.currency, due_date: input.due_date || null, notes: input.notes || null,
    description: input.description || null, reference: input.reference || null,
    attention: input.attention || null, bank_details: input.bank_details || null,
    subtotal, tax_total, total,
  }
  // Blank number lets the DB trigger assign YY-MM-NNN.
  if (input.invoice_number) insert.invoice_number = input.invoice_number
  const { data: ins, error } = await supabase.from('invoices').insert(insert).select('id').single()
  if (error) return { error: error.message }
  const invoiceId = ins.id as string

  const lineRows = input.lines.map((l, i) => ({
    invoice_id: invoiceId, job_id: l.job_id, description: l.description,
    qty: Number(l.qty) || 0, unit_price: Number(l.unit_price) || 0,
    amount: r2((Number(l.qty) || 0) * (Number(l.unit_price) || 0)), sort: i,
  }))
  const { error: liErr } = await supabase.from('invoice_line_items').insert(lineRows)
  if (liErr) { await supabase.from('invoices').delete().eq('id', invoiceId); return { error: liErr.message } }

  if (input.taxes.length) {
    const taxRows = input.taxes.map((t, i) => ({ invoice_id: invoiceId, name: t.name, rate: Number(t.rate) || 0, amount: taxAmounts[i] }))
    const { error: txErr } = await supabase.from('invoice_taxes').insert(taxRows)
    if (txErr) { await supabase.from('invoices').delete().eq('id', invoiceId); return { error: txErr.message } }
  }

  // Stamp each vessel's job + move it into the billing stage. Confirm the stamp
  // applied (RLS) — otherwise the invoice's jobs would be unlinked and wrongly
  // reappear as "available to invoice". Roll the invoice back if it didn't.
  const jobIds = [...new Set(input.lines.map(l => l.job_id).filter(Boolean))] as string[]
  const { data: stamped, error: jErr } = await supabase.from('jobs')
    .update({ invoice_id: invoiceId, workflow_status: 'invoiced' })
    .in('id', jobIds)
    .select('id')
  if (jErr) { await supabase.from('invoices').delete().eq('id', invoiceId); return { error: jErr.message } }
  if (!stamped || stamped.length !== jobIds.length) {
    await supabase.from('invoices').delete().eq('id', invoiceId)
    return { error: 'Could not stamp every job onto the invoice (permission denied or a job changed). Nothing was billed.' }
  }

  await logActivity('invoice', invoiceId, 'invoice:create_consolidated', { jobs: jobIds.length, total })
  return { invoiceId }
}

/** Delete any invoice (consolidated or per-job): lines/taxes cascade, the FK frees
 *  jobs.invoice_id, and jobs still in a billing stage revert to "report approved"
 *  so they can be re-invoiced. */
export async function deleteInvoice(invoiceId: string): Promise<{ error?: string }> {
  const supabase = createClient()
  // Capture linked jobs before the row (and its FK link) disappears.
  const { data: linked } = await supabase.from('jobs').select('id').eq('invoice_id', invoiceId)
  const { data: legacy } = await supabase.from('invoices').select('job_id').eq('id', invoiceId).maybeSingle()
  const jobIds = [...new Set([...(linked ?? []).map((j: any) => j.id), ...(legacy?.job_id ? [legacy.job_id] : [])])] as string[]

  const { error } = await supabase.from('invoices').delete().eq('id', invoiceId)
  if (error) return { error: error.message }
  if (jobIds.length) {
    const { error: revErr } = await supabase.from('jobs')
      .update({ workflow_status: 'approved', invoice_id: null, paid_at: null })
      .in('id', jobIds)
      .in('workflow_status', ['invoiced', 'sent', 'paid'])
    if (revErr) return { error: revErr.message }
  }
  await logActivity('invoice', invoiceId, 'invoice:delete', { jobs: jobIds.length })
  return {}
}
