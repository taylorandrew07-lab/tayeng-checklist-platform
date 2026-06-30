// Billing ledger: client rates, the per-job invoice (line items + taxes), the
// invoices list, and app settings. Admin-driven for now; office can READ with
// the invoicing.view permission (enforced by RLS — this layer just queries).

import { createClient } from '@/lib/supabase/client'
import { logActivity, setWorkflowStatus } from '@/lib/jobs/tracker'
import { sanitizeStorageName } from '@/lib/utils'
import type {
  AppSettings, BankAccount, ClientRate, Currency, Invoice, Job,
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

// ── The per-job invoice (one invoice per job in the builder) ─────────────────
export interface LineDraft { description: string; qty: number; unit_price: number }
export interface TaxDraft { name: string; rate: number }

export function computeTotals(lines: LineDraft[], taxes: TaxDraft[]) {
  const subtotal = r2(lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0))
  const taxAmounts = taxes.map(t => r2(subtotal * (Number(t.rate) || 0) / 100))
  const tax_total = r2(taxAmounts.reduce((s, a) => s + a, 0))
  return { subtotal, taxAmounts, tax_total, total: r2(subtotal + tax_total) }
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
  template_id: string | null
  /** Billable hours for an hourly rate: the checklist's designated billable-hours
   *  field value if present, else the labour ledger (sum of regular_hours). null
   *  when neither is set. The invoice builder seeds an hourly line's qty from it. */
  billable_hours: number | null
  /** Billable quantity for a per-unit rate: the value of the checklist field flagged
   *  is_billable_quantity (e.g. UHT "Number of holds" = holds/bilges). The invoice
   *  builder seeds a per-unit line's qty from it; null when not set. */
  billable_quantity: number | null
  /** Total kilometres driven across all surveyors on the job (migration 116). The
   *  builder auto-adds a mileage line when the client has a per_km rate. null/0 = none. */
  billable_km: number | null
  /** The job's own date from its checklist (first date field), for the invoice line
   *  description. null → the builder falls back to scheduled_date. */
  job_date: string | null
  /** Overall work window from the checklist's time fields (earliest → latest), e.g.
   *  OVID's depart-base → arrive-back-at-base. Just the total span, not each leg. */
  time_from: string | null
  time_to: string | null
}

/** Jobs whose work is done (report-ready or approved) and not yet on an invoice —
 *  the pool the Finance "create invoice" flow draws from. Report-ready is included
 *  on purpose so jobs awaiting approval aren't invisible to billing. Optionally
 *  narrowed to a client and/or a YYYY-MM month (by scheduled date, else created). */
export async function listInvoiceableJobs(opts: { clientId?: string; month?: string } = {}): Promise<InvoiceableJob[]> {
  const supabase = createClient()
  // jobs → clients has a single FK (client_id), so this embed needs no hint.
  let q = supabase.from('jobs')
    .select('id, report_number, vessel_name, job_type, client_id, template_id, scheduled_date, created_at, workflow_status, client:clients(name)')
    .is('invoice_id', null)
    .in('workflow_status', ['report_ready', 'approved'])
    .order('scheduled_date', { ascending: true, nullsFirst: false })
  if (opts.clientId) q = q.eq('client_id', opts.clientId)
  const { data } = await q
  let rows = ((data ?? []) as any[]).map(j => ({
    id: j.id, report_number: j.report_number, vessel_name: j.vessel_name, job_type: j.job_type,
    client_id: j.client_id, client_name: j.client?.name ?? null, template_id: j.template_id ?? null,
    scheduled_date: j.scheduled_date, created_at: j.created_at, workflow_status: j.workflow_status,
    billable_hours: null as number | null,
    billable_quantity: null as number | null,
    billable_km: null as number | null,
    job_date: null as string | null, time_from: null as string | null, time_to: null as string | null,
  })) as InvoiceableJob[]
  if (opts.month) rows = rows.filter(r => (r.scheduled_date ?? r.created_at ?? '').slice(0, 7) === opts.month)

  // Billable hours per job (for hourly-rate lines). Prefer the value of the field a
  // template flags is_billable_hours (e.g. OVID "Total hours"); otherwise fall back
  // to the surveyor labour ledger (sum of regular_hours). Two small lookups keyed on
  // the jobs we're about to show — avoids an embed filter and keeps each query flat.
  const ids = rows.map(r => r.id)
  if (ids.length) {
    const templateIds = [...new Set(rows.map(r => r.template_id).filter(Boolean))] as string[]
    // In parallel: the billable-hours field(s), the labour ledger, and every date/time
    // field on the jobs' templates (for the line description's date + work window).
    const [{ data: bhFields }, { data: bqFields }, { data: surv }, { data: dtFields }] = await Promise.all([
      supabase.from('template_fields').select('id').eq('is_billable_hours', true),
      supabase.from('template_fields').select('id').eq('is_billable_quantity', true),
      supabase.from('job_surveyors').select('id, job_id, regular_hours').in('job_id', ids),
      templateIds.length
        ? supabase.from('template_fields').select('id, field_type, order_index').in('template_id', templateIds).in('field_type', ['date', 'time'])
        : Promise.resolve({ data: [] as any[] }),
    ])
    const bhIds = ((bhFields ?? []) as any[]).map(f => f.id)
    const bhSet = new Set<string>(bhIds)
    const bqIds = ((bqFields ?? []) as any[]).map(f => f.id)
    const bqSet = new Set<string>(bqIds)
    // field_id → {type, order} for the date/time fields we want values for.
    const dtMeta = new Map<string, { type: string; order: number }>()
    for (const f of (dtFields ?? []) as any[]) dtMeta.set(f.id, { type: f.field_type, order: f.order_index ?? 0 })

    // One values query covers billable-hours + date + time fields.
    const wantedIds = [...new Set([...bhIds, ...bqIds, ...dtMeta.keys()])]
    const fromChecklist: Record<string, number> = {}
    const qtyByJob: Record<string, number> = {}
    const bestDate: Record<string, { order: number; value: string }> = {} // lowest-order date field with a value
    const timesByJob: Record<string, string[]> = {}
    if (wantedIds.length) {
      const { data: fv } = await supabase.from('job_field_values')
        .select('job_id, field_id, value').in('job_id', ids).in('field_id', wantedIds)
      for (const v of (fv ?? []) as any[]) {
        const val = (v.value ?? '').trim()
        if (bhSet.has(v.field_id)) {
          const n = parseFloat(v.value ?? '')
          if (Number.isFinite(n) && n > 0) fromChecklist[v.job_id] = n
        }
        if (bqSet.has(v.field_id)) {
          const n = parseFloat(v.value ?? '')
          if (Number.isFinite(n) && n > 0) qtyByJob[v.job_id] = n
        }
        const meta = dtMeta.get(v.field_id)
        if (meta && val) {
          if (meta.type === 'date') {
            const prev = bestDate[v.job_id]
            if (!prev || meta.order < prev.order) bestDate[v.job_id] = { order: meta.order, value: val }
          } else if (meta.type === 'time') {
            ;(timesByJob[v.job_id] ??= []).push(val)
          }
        }
      }
    }
    const fromLedger: Record<string, number> = {}
    const jsToJob = new Map<string, string>()
    for (const s of (surv ?? []) as any[]) {
      fromLedger[s.job_id] = (fromLedger[s.job_id] ?? 0) + Number(s.regular_hours || 0)
      jsToJob.set(s.id, s.job_id)
    }
    // Total km per job via the job_surveyor → job_surveyor_km chain (migration 116).
    const kmByJob: Record<string, number> = {}
    const jsIds = [...jsToJob.keys()]
    if (jsIds.length) {
      const { data: kmRows } = await supabase.from('job_surveyor_km').select('job_surveyor_id, km').in('job_surveyor_id', jsIds)
      for (const k of (kmRows ?? []) as any[]) {
        const jobId = jsToJob.get(k.job_surveyor_id); if (!jobId) continue
        kmByJob[jobId] = (kmByJob[jobId] ?? 0) + Number(k.km ?? 0)
      }
    }
    rows.forEach(r => {
      r.billable_hours = fromChecklist[r.id] ?? (fromLedger[r.id] > 0 ? fromLedger[r.id] : null)
      r.billable_quantity = qtyByJob[r.id] ?? null
      r.billable_km = kmByJob[r.id] || null
      r.job_date = bestDate[r.id]?.value ?? null
      const times = (timesByJob[r.id] ?? []).slice().sort()
      r.time_from = times[0] ?? null
      r.time_to = times.length > 1 ? times[times.length - 1] : null
    })
  }
  return rows
}

export interface ConsolidatedLine { job_id: string | null; description: string; qty: number; unit_price: number; is_expense?: boolean; receipt_path?: string | null }

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
  // For a standalone invoice (no job-linked lines): create a report-only job so it
  // still appears on the job sheet, linked to this invoice.
  new_job?: { title: string; vessel_name: string | null; job_type: string | null } | null
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
    invoice_id: invoiceId, job_id: l.job_id ?? null, description: l.description,
    qty: Number(l.qty) || 0, unit_price: Number(l.unit_price) || 0,
    amount: r2((Number(l.qty) || 0) * (Number(l.unit_price) || 0)), sort: i,
    is_expense: !!l.is_expense, receipt_path: l.receipt_path ?? null,
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
  if (jobIds.length > 0) {
    const { data: stamped, error: jErr } = await supabase.from('jobs')
      .update({ invoice_id: invoiceId, workflow_status: 'invoiced' })
      .in('id', jobIds)
      .select('id')
    if (jErr) { await supabase.from('invoices').delete().eq('id', invoiceId); return { error: jErr.message } }
    if (!stamped || stamped.length !== jobIds.length) {
      await supabase.from('invoices').delete().eq('id', invoiceId)
      return { error: 'Could not stamp every job onto the invoice (permission denied or a job changed). Nothing was billed.' }
    }
  } else if (input.new_job) {
    // Standalone invoice: create a report-only job (no checklist template) so the
    // invoice still shows on the job sheet, linked to it.
    const { error: njErr } = await supabase.from('jobs').insert({
      title: input.new_job.title || 'Invoice',
      client_id: input.client_id,
      vessel_name: input.new_job.vessel_name ?? null,
      job_type: input.new_job.job_type ?? null,
      template_id: null,
      workflow_status: 'invoiced',
      invoice_id: invoiceId,
      created_by: user?.id ?? null,
    })
    if (njErr) { await supabase.from('invoices').delete().eq('id', invoiceId); return { error: njErr.message } }
  }

  await logActivity('invoice', invoiceId, 'invoice:create_consolidated', { jobs: jobIds.length, standalone_job: jobIds.length === 0 && !!input.new_job, total })
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

// ── Editing an existing invoice (lines, expenses, receipts, values) ───────────
export interface EditableLine {
  description: string; qty: number; unit_price: number
  is_expense: boolean; receipt_path: string | null; job_id: string | null
  vessel_name?: string | null; report_number?: string | null
}
export interface InvoiceForEdit { invoice: Invoice; lines: EditableLine[]; taxes: TaxDraft[] }

export async function getInvoiceForEdit(invoiceId: string): Promise<InvoiceForEdit | null> {
  const supabase = createClient()
  const { data: invoice } = await supabase.from('invoices').select('*').eq('id', invoiceId).maybeSingle()
  if (!invoice) return null
  const [{ data: lines }, { data: taxes }] = await Promise.all([
    // invoice_line_items → jobs is a single FK (job_id), so the embed needs no hint.
    supabase.from('invoice_line_items').select('*, job:jobs(vessel_name, report_number)').eq('invoice_id', invoiceId).order('sort'),
    supabase.from('invoice_taxes').select('*').eq('invoice_id', invoiceId),
  ])
  return {
    invoice: invoice as Invoice,
    lines: ((lines ?? []) as any[]).map(l => ({
      description: l.description, qty: Number(l.qty), unit_price: Number(l.unit_price),
      is_expense: !!l.is_expense, receipt_path: l.receipt_path ?? null, job_id: l.job_id ?? null,
      vessel_name: l.job?.vessel_name ?? null, report_number: l.job?.report_number ?? null,
    })),
    taxes: ((taxes ?? []) as any[]).map(t => ({ name: t.name, rate: Number(t.rate) })),
  }
}

/** Replace an invoice's header fields, line items (incl. expenses/receipts) and
 *  taxes, recomputing totals. Used by the Finance invoice editor. */
export async function updateInvoice(invoiceId: string, data: {
  invoice_number?: string | null
  currency: Currency; due_date: string | null; notes: string | null
  description: string | null; reference: string | null; attention: string | null; bank_details: string | null
  bill_to_client_id?: string | null
  lines: EditableLine[]; taxes: TaxDraft[]
}): Promise<{ error?: string }> {
  const supabase = createClient()
  const { subtotal, taxAmounts, tax_total, total } = computeTotals(data.lines, data.taxes)
  const header: Record<string, unknown> = {
    currency: data.currency, due_date: data.due_date || null, notes: data.notes || null,
    description: data.description || null, reference: data.reference || null,
    attention: data.attention || null, bank_details: data.bank_details || null,
    subtotal, tax_total, total,
  }
  if (data.invoice_number !== undefined) header.invoice_number = data.invoice_number || null
  if (data.bill_to_client_id !== undefined) header.bill_to_client_id = data.bill_to_client_id || null

  const { data: upd, error } = await supabase.from('invoices').update(header).eq('id', invoiceId).select('id')
  if (error) return { error: error.message }
  if (!upd || upd.length === 0) return { error: 'Could not save — permission denied or the invoice no longer exists.' }

  await supabase.from('invoice_line_items').delete().eq('invoice_id', invoiceId)
  if (data.lines.length) {
    const rows = data.lines.map((l, i) => ({
      invoice_id: invoiceId, job_id: l.job_id ?? null, description: l.description,
      qty: Number(l.qty) || 0, unit_price: Number(l.unit_price) || 0,
      amount: r2((Number(l.qty) || 0) * (Number(l.unit_price) || 0)), sort: i,
      is_expense: !!l.is_expense, receipt_path: l.receipt_path ?? null,
    }))
    const { error: e } = await supabase.from('invoice_line_items').insert(rows)
    if (e) return { error: e.message }
  }
  await supabase.from('invoice_taxes').delete().eq('invoice_id', invoiceId)
  if (data.taxes.length) {
    const rows = data.taxes.map((t, i) => ({ invoice_id: invoiceId, name: t.name, rate: Number(t.rate) || 0, amount: taxAmounts[i] }))
    const { error: e } = await supabase.from('invoice_taxes').insert(rows)
    if (e) return { error: e.message }
  }
  await logActivity('invoice', invoiceId, 'invoice:update', { total })
  return {}
}

// ── Receipt attachments (private invoice-receipts bucket) ─────────────────────
export async function uploadInvoiceReceipt(file: File): Promise<{ path?: string; error?: string }> {
  const supabase = createClient()
  const safe = sanitizeStorageName(file.name)
  const path = `${crypto.randomUUID()}-${safe}`
  const { error } = await supabase.storage.from('invoice-receipts').upload(path, file, { contentType: file.type, upsert: false })
  if (error) return { error: error.message }
  return { path }
}

/** Short-lived signed URL to view/download a receipt (bucket is private). */
export async function invoiceReceiptUrl(path: string): Promise<string | null> {
  const { data } = await createClient().storage.from('invoice-receipts').createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}
