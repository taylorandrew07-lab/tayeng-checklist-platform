// Billing ledger: client rates, the per-job invoice (line items + taxes), the
// invoices list, and app settings. Admin-driven for now; office can READ with
// the invoicing.view permission (enforced by RLS — this layer just queries).

import { createClient } from '@/lib/supabase/client'
import { logActivity, setWorkflowStatus } from '@/lib/jobs/tracker'
import { formatDate, sanitizeStorageName, withVesselPrefix, type VesselPrefix } from '@/lib/utils'
import { byLastDateDesc, jobDaySpan } from '@/lib/jobs/jobDate'
import type {
  AppSettings, BankAccount, ClientRate, Currency, Invoice, Job,
} from '@/lib/types/database'

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

// ── App settings (single row) ────────────────────────────────────────────────
export async function getAppSettings(): Promise<AppSettings | null> {
  const { data } = await createClient().from('app_settings').select('*').eq('id', true).maybeSingle()
  return (data as AppSettings) ?? null
}
export async function updateAppSettings(patch: Partial<Pick<AppSettings, 'default_tax_name' | 'default_tax_rate' | 'bank_details_default' | 'surveyor_km_rate' | 'surveyor_km_currency'>>): Promise<{ error?: string }> {
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

/** The rate that applies to a job, most specific first (migration 163):
 *    1. same job type AND same stage   — "Draught Survey / Initial"
 *    2. same job type, no stage set    — "Draught Survey", any stage
 *    3. the catch-all rate             — no job type
 *
 *  A rate tagged with a stage matches ONLY that stage. That is the point of the
 *  column: before it, the builder matched on job_type alone and took whichever row
 *  sorted first, so an Initial survey could be silently priced with the Discharge
 *  rate. Rates entered before 163 have a NULL stage and so still match at step 2,
 *  exactly as they did before.
 *
 *  Pass rates already filtered to the kind you want (e.g. is_active, non-per_km) —
 *  this only decides specificity. */
export function pickRate<T extends { job_type: string | null; job_stage?: string | null }>(
  rates: T[],
  job: { job_type: string | null; job_stage?: string | null },
): T | null {
  const stage = job.job_stage ?? null
  return (
    (stage ? rates.find(r => r.job_type === job.job_type && (r.job_stage ?? null) === stage) : undefined)
    ?? rates.find(r => r.job_type === job.job_type && (r.job_stage ?? null) === null)
    ?? rates.find(r => !r.job_type && (r.job_stage ?? null) === null)
    ?? null
  )
}

/** The day count a client DAY rate (migration 169) charges for a job: the job's own
 *  attendance window, both ends counted — 10→13 Aug is 4 days, and any part of a day
 *  is a whole day. Falls back to the labour ledger only for a job with no dates at
 *  all, and never below 1 so a line can't seed as "0 days". Deliberately NOT the
 *  ledger by preference: those days are logged per surveyor, so a two-surveyor
 *  discharge would bill the client twice over. */
export function billedDays(job: { day_span?: number | null; billable_days?: number | null }): number {
  if (job.day_span && job.day_span > 0) return job.day_span
  if (job.billable_days && job.billable_days > 0) return job.billable_days
  return 1
}

/** One priced charge: what a single job contributes to an invoice line.
 *  `rate_id` is the rate it was priced from — seeded by pickRate() and overridable per
 *  line, so a wrongly auto-matched rate can be corrected without retyping the price. */
export interface ChargeSeed {
  description: string
  qty: number
  unit_price: number
  rate_id: string | null
}

/**
 * Price one job. Lifted verbatim out of ConsolidatedInvoiceBuilder.seedLine so a
 * draught-survey voyage can price EACH of its legs through the same code the single-job
 * path uses. Two spellings of "what does this job cost" would drift, and the one that
 * drifted would be the roll-up — where three legs collapse into a single figure nobody
 * can eyeball.
 *
 * Pure: no supabase, no React. `forcedRateId` means the user picked a rate for this
 * line by hand — honour it instead of re-matching; '' means "no rate", which seeds a
 * blank price to fill in manually.
 */
export function seedCharge(
  job: InvoiceableJob,
  clientRates: ClientRate[],
  forcedRateId?: string,
): ChargeSeed {
  const active = clientRates.filter(r => r.is_active)
  // per_km rates drive the separate mileage line only — never the main survey
  // line (else a client with just a per_km rate gets a bogus qty-1 line).
  const billable = active.filter(r => r.rate_type !== 'per_km')
  const rate = forcedRateId !== undefined
    ? (forcedRateId ? billable.find(r => r.id === forcedRateId) ?? null : null)
    : pickRate(billable, job)
  const label = job.vessel_name ? withVesselPrefix(job.vessel_name, job.vessel_type) : (job.report_number ?? 'Survey')
  const hourly = rate?.rate_type === 'hourly'
  const daily = rate?.rate_type === 'daily'
  const perUnit = rate?.rate_type === 'per_unit'
  // A day-billed job (migration 148) carries no billable_hours at all, so an hourly
  // rate can never multiply its day count — the client's DAY rate (migration 169)
  // prices it. A per-unit rate whose unit IS the day still works the same way.
  const perDayUnit = perUnit && /^days?$/i.test((rate?.unit_label ?? '').trim())
  // The day count a DAY rate multiplies is the job's own attendance window, both
  // ends counted (10→13 Aug = 4 days), not the labour ledger: the ledger is per
  // surveyor, so two surveyors on that discharge would bill the client 8 days.
  const daysBilled = billedDays(job)
  // An hourly rate on a day-billed job is a mismatch we must not paper over: seed
  // the DAY count as the qty but leave the price at 0, so the line reads as
  // visibly incomplete (3 × 0) instead of a plausible-looking 1 × the hourly rate,
  // which would undercharge three days of work by two-thirds.
  //
  // NB inside a voyage roll-up that visible zero becomes INVISIBLE — it is summed away.
  // isZeroPriced() below is what turns this seed into a hard block there.
  const hourlyOnDays = hourly && job.labour_unit === 'days'
  // A day rate is deliberately NOT gated on jobs.labour_unit: that column decides how
  // surveyors log their own time (pay), while the client rate decides how the client
  // is charged. An hours-logged discharge still bills 4 days at the day rate.
  const qty = hourlyOnDays ? (job.billable_days && job.billable_days > 0 ? job.billable_days : 1)
    : hourly && job.billable_hours && job.billable_hours > 0 ? job.billable_hours
    : daily ? daysBilled
    : perUnit && job.billable_quantity && job.billable_quantity > 0 ? job.billable_quantity
    : perDayUnit ? billedDays(job)
    : 1
  // Second description line spells out the job: its date, the overall work window
  // (time from–to, not each leg) and — when hourly — the hours being billed.
  const rangeStr = daily && job.scheduled_date && job.end_date && job.end_date !== job.scheduled_date
    ? `${formatDate(job.scheduled_date)} – ${formatDate(job.end_date)}` : null
  const dateStr = rangeStr ?? (job.job_date ? formatDate(job.job_date) : (job.scheduled_date ? formatDate(job.scheduled_date) : null))
  const span = job.time_from && job.time_to ? `${job.time_from}–${job.time_to}` : (job.time_from ?? null)
  const hoursStr = hourly && job.billable_hours && job.billable_hours > 0 ? `${job.billable_hours} hrs` : null
  const unitStr = perUnit && job.billable_quantity && job.billable_quantity > 0 ? `${job.billable_quantity} ${rate?.unit_label || 'units'}` : null
  const dayCount = daily ? daysBilled : (job.billable_days ?? 0)
  const daysStr = !unitStr && dayCount > 0 ? `${dayCount} day${dayCount === 1 ? '' : 's'}` : null
  const detail = [dateStr, span, hoursStr, daysStr, unitStr].filter(Boolean).join(' · ')
  // The stage qualifies the type and belongs on the client's invoice: a vessel can
  // take an Initial AND a Final Draught Survey in the same month, and "M.V. Chaconia
  // — Draught Survey" twice over is unbillable-looking to them and unverifiable to us.
  //
  // TRAP: InvoicePDF.tsx splits this head on ' — ' to build three fixed-width columns
  // (vessel 118pt / type flex / report 96pt). Changing the separator or adding a second
  // one silently breaks the printed invoice's column alignment.
  const typeStr = job.job_type && job.job_stage ? `${job.job_type} (${job.job_stage})`
    : (job.job_type ?? job.job_stage ?? null)
  const head = typeStr ? `${label} — ${typeStr}` : label
  return {
    description: detail ? `${head}\n${detail}` : head,
    qty,
    unit_price: rate && !hourlyOnDays ? Number(rate.rate) : 0,
    rate_id: rate?.id ?? null,
  }
}

/** What a charge actually comes to. */
export function chargeAmount(c: Pick<ChargeSeed, 'qty' | 'unit_price'>): number {
  return r2((Number(c.qty) || 0) * (Number(c.unit_price) || 0))
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

// ── Which jobs does an invoice bill? One derivation, three callers ──────────
// This used to be spelled inline three times — in create, delete and update — and the
// three did NOT agree. Once a draught-survey voyage rolls three jobs onto one line, the
// disagreement stops being cosmetic: an absorbed leg sits on no line at all, so a
// release derived from the lines alone leaves it closed and frozen forever.

/** A job stamped onto an invoice, and the job whose LINE it was billed under.
 *  billed_under_job_id is null for a job that owns its own line, and for the standalone
 *  report-only job that createConsolidatedInvoice creates. */
export interface InvoiceJobLink { id: string; billed_under_job_id: string | null }

/** The two views of an invoice's jobs: the ones that own a line, and every job actually
 *  stamped with it (which includes absorbed legs and the standalone report-only job). */
export async function invoiceJobSets(invoiceId: string): Promise<{
  lineJobIds: string[]
  stamped: InvoiceJobLink[]
}> {
  const supabase = createClient()
  const [{ data: lines }, { data: jobs }] = await Promise.all([
    supabase.from('invoice_line_items').select('job_id').eq('invoice_id', invoiceId),
    supabase.from('jobs').select('id, billed_under_job_id').eq('invoice_id', invoiceId),
  ])
  const lineJobIds = [...new Set(
    ((lines ?? []) as { job_id: string | null }[]).map(l => l.job_id).filter(Boolean) as string[]
  )]
  return { lineJobIds, stamped: ((jobs ?? []) as InvoiceJobLink[]) }
}

/**
 * Given what an invoice billed before an edit and what it bills after, work out which
 * jobs to release and which to newly stamp.
 *
 * Parents are taken FROM THE LINES, not from jobs.invoice_id — that is what keeps the
 * standalone report-only job (stamped, but deliberately never line-linked) out of the
 * release set. Children are then pulled in THROUGH their parent, which is the half that
 * the roll-up adds: an absorbed Initial is on no line, so nothing else would find it.
 *
 * Pure, so the awkward cases are unit-testable without a database.
 */
export function releaseSets(input: {
  priorLineJobIds: string[]
  stamped: InvoiceJobLink[]
  keptLineJobIds: string[]
}): { releasedJobIds: string[]; addedJobIds: string[] } {
  const kept = new Set(input.keptLineJobIds)
  const prior = new Set(input.priorLineJobIds)
  const releasedParents = input.priorLineJobIds.filter(id => !kept.has(id))
  const releasedParentSet = new Set(releasedParents)
  const releasedChildren = input.stamped
    .filter(j => j.billed_under_job_id && releasedParentSet.has(j.billed_under_job_id))
    .map(j => j.id)
  return {
    releasedJobIds: [...new Set([...releasedParents, ...releasedChildren])],
    addedJobIds: input.keptLineJobIds.filter(id => !prior.has(id)),
  }
}

/** Cancel an invoice, or bring a cancelled one back. Payment is not tracked
 *  (migration 146) — 'active' and 'void' are the only states an invoice has. */
export async function setInvoiceStatus(invoiceId: string, status: Invoice['status']): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data, error } = await supabase.from('invoices').update({ status }).eq('id', invoiceId).select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'That change was blocked — you may not have permission to update this invoice.' }
  return {}
}

export const voidInvoice = (invoiceId: string) => setInvoiceStatus(invoiceId, 'void')
export const restoreInvoice = (invoiceId: string) => setInvoiceStatus(invoiceId, 'active')

// ── Invoices list (admin + office read) ──────────────────────────────────────
export interface InvoiceListRow {
  id: string; invoice_number: string | null; status: Invoice['status']
  currency: Currency; total: number; issue_date: string; due_date: string | null
  client_name: string | null; bill_to_name: string | null
  report_number: string | null; vessel_name: string | null; vessel_type: VesselPrefix | null; job_id: string | null
  // Consolidated invoices (no single job_id) carry many vessels — one line each.
  line_count: number
}
export async function listInvoices(): Promise<InvoiceListRow[]> {
  // invoices now has two FKs to clients (client_id, bill_to_client_id) and two to
  // jobs (invoices.job_id, jobs.invoice_id), so every embed is hinted by its FK.
  const { data } = await createClient()
    .from('invoices')
    .select('id, invoice_number, status, currency, total, issue_date, due_date, job_id, client:clients!invoices_client_id_fkey(name), bill_to:clients!invoices_bill_to_client_id_fkey(name), job:jobs!invoices_job_id_fkey(report_number, vessel_name, vessel_type), line_items:invoice_line_items(count)')
    .order('created_at', { ascending: false })
  return ((data ?? []) as any[]).map(r => ({
    id: r.id, invoice_number: r.invoice_number, status: r.status, currency: r.currency,
    total: Number(r.total ?? 0), issue_date: r.issue_date, due_date: r.due_date,
    job_id: r.job_id,
    client_name: r.client?.name ?? null,
    bill_to_name: r.bill_to?.name ?? null,
    report_number: r.job?.report_number ?? null, vessel_name: r.job?.vessel_name ?? null,
    vessel_type: r.job?.vessel_type ?? null,
    line_count: Number(r.line_items?.[0]?.count ?? 0),
  }))
}


// ── Bank accounts (selectable on invoices) ───────────────────────────────────
export async function listBankAccounts(activeOnly = false): Promise<BankAccount[]> {
  let q = createClient().from('bank_accounts').select('*')
    .order('is_default', { ascending: false }).order('sort').order('label')
  if (activeOnly) q = q.eq('is_active', true)
  const { data } = await q
  return (data ?? []) as BankAccount[]
}

/** Create or update a bank account. A partial unique index (mig 122) enforces a
 *  single default, so other defaults are cleared BEFORE the row is marked default —
 *  the reverse order would trip the index. */
export async function saveBankAccount(input: {
  id?: string; label: string; currency: Currency | null; details: string; is_default: boolean; is_active?: boolean
}): Promise<{ error?: string }> {
  const supabase = createClient()
  const row = { label: input.label, currency: input.currency, details: input.details, is_default: input.is_default, is_active: input.is_active ?? true }
  if (input.is_default) {
    let clear = supabase.from('bank_accounts').update({ is_default: false }).eq('is_default', true)
    if (input.id) clear = clear.neq('id', input.id)
    const { error } = await clear
    if (error) return { error: error.message }
  }
  if (input.id) {
    const { error } = await supabase.from('bank_accounts').update(row).eq('id', input.id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('bank_accounts').insert(row)
    if (error) return { error: error.message }
  }
  return {}
}

/** Names of clients whose "pays into" link (mig 121) points at this account — shown
 *  before deleting an account so severed links aren't a surprise. */
export async function clientsPayingInto(accountId: string): Promise<string[]> {
  const { data } = await createClient().from('client_billing')
    .select('client:clients(name)').eq('pay_to_bank_account_id', accountId)
  return ((data ?? []) as any[]).map(r => r.client?.name).filter(Boolean)
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
  id: string; report_number: string | null; vessel_name: string | null; vessel_type: VesselPrefix | null
  job_type: string | null; client_id: string | null; client_name: string | null
  /** The qualifier on a broad survey type (migration 108) — Initial/Final on a Draught
   *  Survey, Loading/Discharging on a Cargo Survey. Without it an invoice line reads
   *  "M.V. Chaconia — Draught Survey" and neither you nor the client can tell which of
   *  the two surveys on that vessel is being billed. */
  job_stage: string | null
  /** The product on a cargo job (migration 154). Shown in the job picker for context;
   *  not seeded into the line description, which stays about the service billed. */
  cargo_type: string | null
  scheduled_date: string | null; end_date: string | null; created_at: string; workflow_status: Job['workflow_status']
  template_id: string | null
  /** How this job's labour is measured (migration 148). 'days' means an HOURLY rate
   *  cannot price it — billable_hours is null and billable_days carries the quantity. */
  labour_unit: 'hours' | 'days'
  /** Billable hours for an hourly rate: the checklist's designated billable-hours
   *  field value if present, else the labour ledger (sum of regular_hours). null
   *  when neither is set, and always null on a day-billed job. The invoice builder
   *  seeds an hourly line's qty from it. */
  billable_hours: number | null
  /** Days worked on a day-billed job (the labour ledger's regular quantity, which is
   *  in days there). null on hours-billed jobs. Never priced with an hourly rate.
   *  NB this is the sum across surveyors — two surveyors on a 4-day job log 8 — so it
   *  is a labour figure, not the day count a client is billed. See day_span. */
  billable_days: number | null
  /** The job's own attendance window in whole days, both ends counted: 10→13 Aug = 4
   *  (migration 169). This is what a client DAY rate multiplies — one job, one span,
   *  however many surveyors attended. Null only when the job has no start date. */
  day_span: number | null
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

/** Jobs whose work is done and not yet on an invoice — the pool the Finance
 *  "create invoice" flow draws from. Returns BOTH stages and the builder groups them:
 *    invoice_ready — billable, selectable now
 *    report_ready  — submitted but you haven't reviewed the report yet; shown in an
 *                    "awaiting your review" group with a one-click Mark invoice ready,
 *                    NOT selectable until flipped. That one deliberate look is the
 *                    point; fetching it here is what keeps the flip one click away
 *                    instead of a hunt through the jobs list.
 *  Optionally narrowed to a client and/or a YYYY-MM month (scheduled date, else created). */
export async function listInvoiceableJobs(opts: { clientId?: string; month?: string } = {}): Promise<InvoiceableJob[]> {
  const supabase = createClient()
  // jobs → clients has a single FK (client_id), so this embed needs no hint.
  let q = supabase.from('jobs')
    .select('id, report_number, vessel_name, vessel_type, job_type, job_stage, cargo_type, client_id, template_id, labour_unit, scheduled_date, end_date, created_at, workflow_status, client:clients(name)')
    .is('invoice_id', null)
    .in('workflow_status', ['report_ready', 'invoice_ready'])
    .order('scheduled_date', { ascending: true, nullsFirst: false })
  if (opts.clientId) q = q.eq('client_id', opts.clientId)
  const { data } = await q
  let rows = ((data ?? []) as any[]).map(j => ({
    id: j.id, report_number: j.report_number, vessel_name: j.vessel_name, vessel_type: j.vessel_type ?? null, job_type: j.job_type,
    job_stage: j.job_stage ?? null, cargo_type: j.cargo_type ?? null,
    client_id: j.client_id, client_name: j.client?.name ?? null, template_id: j.template_id ?? null,
    scheduled_date: j.scheduled_date, end_date: j.end_date ?? null, created_at: j.created_at, workflow_status: j.workflow_status,
    labour_unit: (j.labour_unit === 'days' ? 'days' : 'hours') as 'hours' | 'days',
    billable_hours: null as number | null,
    billable_days: null as number | null,
    day_span: jobDaySpan(j),
    billable_quantity: null as number | null,
    billable_km: null as number | null,
    job_date: null as string | null, time_from: null as string | null, time_to: null as string | null,
  })) as InvoiceableJob[]
  // Oldest LAST day first, so the pool runs in the order work actually finished
  // (PostgREST can't ORDER BY a COALESCE, so the .order above is a stable pre-sort).
  rows.sort((a, b) => -byLastDateDesc(a, b))
  // The month filter stays on the START date — that is the billing-period boundary
  // and it mirrors the labour attribution window, not the list-display rule.
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
      // On a day-billed job (migration 148) the ledger quantity is in DAYS and the
      // checklist's billable-hours field is an hours figure that doesn't apply here —
      // so billable_hours stays null and the quantity goes in billable_days. That is
      // what stops an hourly rate ever multiplying a day count on a client invoice.
      const isDays = r.labour_unit === 'days'
      r.billable_hours = isDays ? null : (fromChecklist[r.id] ?? (fromLedger[r.id] > 0 ? fromLedger[r.id] : null))
      r.billable_days = isDays && fromLedger[r.id] > 0 ? fromLedger[r.id] : null
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

/** Flip a submitted job to "Invoice ready" — the one-click confirmation that the
 *  report is finished and the job can be billed. Exposed here (not just on the job
 *  page) so it can be done straight from the Finance invoice builder. */
export async function markJobInvoiceReady(jobId: string): Promise<{ error?: string }> {
  return setWorkflowStatus(jobId, 'invoice_ready')
}

export interface ConsolidatedLine { job_id: string | null; description: string; qty: number; unit_price: number; is_expense?: boolean; receipt_path?: string | null }

/** Create one invoice spanning many jobs/vessels, stamp each job with it, and
 *  CLOSE those jobs. client_id = whose vessels these are (e.g. BP);
 *  bill_to_client_id = who pays / who it's addressed to (e.g. ASCO), NULL if same. */
export async function createConsolidatedInvoice(input: {
  client_id: string | null
  bill_to_client_id: string | null
  invoice_number?: string | null
  /** The date printed on the invoice. Blank falls through to the column default
   *  (CURRENT_DATE) — so "today" is the fallback, never an override of a date you set. */
  issue_date?: string | null
  currency: Currency; due_date: string | null; notes: string | null
  description: string | null; reference: string | null; attention: string | null; bank_details: string | null
  lines: ConsolidatedLine[]; taxes: TaxDraft[]
  // For a standalone invoice (no job-linked lines): create a report-only job so it
  // still appears on the job sheet, linked to this invoice.
  new_job?: { title: string; vessel_name: string | null; vessel_type?: VesselPrefix | null; job_type: string | null } | null
}): Promise<{ error?: string; invoiceId?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (input.lines.length === 0) return { error: 'Select at least one job to invoice.' }

  const { subtotal, taxAmounts, tax_total, total } = computeTotals(input.lines, input.taxes)
  const insert: Record<string, unknown> = {
    job_id: null, client_id: input.client_id, bill_to_client_id: input.bill_to_client_id,
    status: 'active', created_by: user?.id ?? null,
    currency: input.currency, due_date: input.due_date || null, notes: input.notes || null,
    description: input.description || null, reference: input.reference || null,
    attention: input.attention || null, bank_details: input.bank_details || null,
    subtotal, tax_total, total,
  }
  // Blank number lets the DB trigger assign YY-MM-NNN.
  if (input.invoice_number) insert.invoice_number = input.invoice_number
  // Only send a date when one was chosen; omitting it lets issue_date default to
  // CURRENT_DATE. Sending null would violate the NOT NULL column.
  if (input.issue_date) insert.issue_date = input.issue_date
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
    // Invoicing CLOSES the job (migration 145) — this is what locks surveyor edits
    // via job_is_open(). These updates bypass setWorkflowStatus, so stamp the close
    // columns here; the caller is an admin, so the mig-129 admin-column guard allows it.
    const { data: stamped, error: jErr } = await supabase.from('jobs')
      .update({
        invoice_id: invoiceId, workflow_status: 'closed',
        closed_at: new Date().toISOString(), closed_by: user?.id ?? null,
      })
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
      vessel_type: input.new_job.vessel_type ?? 'M.V.',
      job_type: input.new_job.job_type ?? null,
      template_id: null,
      workflow_status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: user?.id ?? null,
      invoice_id: invoiceId,
      created_by: user?.id ?? null,
    })
    if (njErr) { await supabase.from('invoices').delete().eq('id', invoiceId); return { error: njErr.message } }
  }

  await logActivity('invoice', invoiceId, 'invoice:create_consolidated', { jobs: jobIds.length, standalone_job: jobIds.length === 0 && !!input.new_job, total })
  return { invoiceId }
}

/** Delete any invoice (consolidated or per-job): lines/taxes cascade, the FK frees
 *  jobs.invoice_id, and every job it closed reverts to "Invoice ready" so it can be
 *  re-invoiced. NOTE this deliberately UNLOCKS surveyor edits again (job_is_open
 *  flips back to true) — deleting the invoice is the correction flow. */
export async function deleteInvoice(invoiceId: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: legacy } = await supabase.from('invoices').select('job_id').eq('id', invoiceId).maybeSingle()

  // RELEASE FIRST, THEN DELETE. jobs.invoice_id is ON DELETE SET NULL, so deleting the
  // invoice erases the only link back to its jobs — after that no query can find them.
  // The old order captured ids up front and reverted afterwards, which had the failure
  // the wrong way round: if the revert failed, the jobs were left closed and frozen
  // with a nulled invoice_id, invisible to the invoice pool AND to reconciliation. This
  // way a failure leaves the invoice intact and its jobs released, which is loud.
  // An empty keep-set releases everything, absorbed legs and the standalone
  // report-only job included — deleting the invoice un-bills all of it.
  const { data: released, error: relErr } = await supabase.rpc('release_jobs_from_invoice', {
    p_invoice_id: invoiceId, p_keep_job_ids: [],
  })
  if (relErr) return { error: relErr.message }

  const { error } = await supabase.from('invoices').delete().eq('id', invoiceId)
  if (error) return { error: error.message }

  // Pre-075 invoices linked the other way round (invoices.job_id) and may carry a job
  // the RPC never saw, because that job's own invoice_id was never stamped.
  if (legacy?.job_id) {
    await supabase.from('jobs')
      .update({ workflow_status: 'invoice_ready', invoice_id: null, closed_at: null, closed_by: null, paid_at: null })
      .eq('id', legacy.job_id)
      .eq('workflow_status', 'closed')
  }
  const count = Array.isArray(released) ? released.length : 0
  await logActivity('invoice', invoiceId, 'invoice:delete', { jobs: count })
  return {}
}

// ── Editing an existing invoice (lines, expenses, receipts, values) ───────────
export interface EditableLine {
  description: string; qty: number; unit_price: number
  is_expense: boolean; receipt_path: string | null; job_id: string | null
  vessel_name?: string | null; vessel_type?: VesselPrefix | null; report_number?: string | null
}
export interface InvoiceForEdit { invoice: Invoice; lines: EditableLine[]; taxes: TaxDraft[] }

export async function getInvoiceForEdit(invoiceId: string): Promise<InvoiceForEdit | null> {
  const supabase = createClient()
  const { data: invoice } = await supabase.from('invoices').select('*').eq('id', invoiceId).maybeSingle()
  if (!invoice) return null
  const [{ data: lines }, { data: taxes }] = await Promise.all([
    // invoice_line_items → jobs is a single FK (job_id), so the embed needs no hint.
    supabase.from('invoice_line_items').select('*, job:jobs(vessel_name, vessel_type, report_number)').eq('invoice_id', invoiceId).order('sort'),
    supabase.from('invoice_taxes').select('*').eq('invoice_id', invoiceId),
  ])
  return {
    invoice: invoice as Invoice,
    lines: ((lines ?? []) as any[]).map(l => ({
      description: l.description, qty: Number(l.qty), unit_price: Number(l.unit_price),
      is_expense: !!l.is_expense, receipt_path: l.receipt_path ?? null, job_id: l.job_id ?? null,
      vessel_name: l.job?.vessel_name ?? null, vessel_type: l.job?.vessel_type ?? null, report_number: l.job?.report_number ?? null,
    })),
    taxes: ((taxes ?? []) as any[]).map(t => ({ name: t.name, rate: Number(t.rate) })),
  }
}

/** Replace an invoice's header fields, line items (incl. expenses/receipts) and
 *  taxes, recomputing totals. Used by the Finance invoice editor. */
export async function updateInvoice(invoiceId: string, data: {
  invoice_number?: string | null
  /** The date printed on the invoice. Blank leaves the stored date alone rather
   *  than nulling a NOT NULL column — clearing the box must not silently re-stamp
   *  the invoice with today. */
  issue_date?: string | null
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
  if (data.issue_date) header.issue_date = data.issue_date

  const { data: upd, error } = await supabase.from('invoices').update(header).eq('id', invoiceId).select('id')
  if (error) return { error: error.message }
  if (!upd || upd.length === 0) return { error: 'Could not save — permission denied or the invoice no longer exists.' }

  // Which jobs this invoice billed BEFORE the edit, and which are absorbed under them.
  // Parents come from the LINES (not jobs.invoice_id) so a standalone invoice's
  // report-only job — stamped but deliberately never line-linked — is never mistaken
  // for a removal. Absorbed legs of a draught-survey voyage sit on no line at all, so
  // they are pulled in through their parent instead; releasing a parent without its
  // children would leave them closed and frozen with no invoice to reopen.
  const { lineJobIds: priorLineJobIds, stamped } = await invoiceJobSets(invoiceId)

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

  // A job dropped from the invoice must not stay stamped and closed on it — it would
  // be silently unbilled AND still frozen to surveyors. Release it the same way
  // deleteInvoice does, so it reappears as available to invoice. Un-stamp the close
  // columns too, else it sits at invoice_ready carrying a stale closed_at/closed_by.
  const keptLineJobIds = [...new Set(data.lines.map(l => l.job_id).filter(Boolean) as string[])]
  const { releasedJobIds } = releaseSets({ priorLineJobIds, stamped, keptLineJobIds })
  if (releasedJobIds.length) {
    // The RPC releases every stamped job outside its keep-set, so the keep-set must
    // ALSO name the standalone report-only job: it is stamped on purpose but has never
    // been on a line, so "not on a line" cannot mean "removed by this edit". That is
    // the carve-out the comment above exists for, spelled out rather than implied.
    const standaloneIds = stamped
      .filter(j => !j.billed_under_job_id && !priorLineJobIds.includes(j.id))
      .map(j => j.id)
    // One RPC, one transaction, and the same status-restoration rule as delete: a leg
    // that was only report_ready when it was absorbed must not come back as
    // invoice_ready, which would assert an approval that never happened.
    const { error: relErr } = await supabase.rpc('release_jobs_from_invoice', {
      p_invoice_id: invoiceId,
      p_keep_job_ids: [...keptLineJobIds, ...standaloneIds],
    })
    if (relErr) return { error: relErr.message }
  }

  await logActivity('invoice', invoiceId, 'invoice:update', { total, released_jobs: releasedJobIds.length })
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
