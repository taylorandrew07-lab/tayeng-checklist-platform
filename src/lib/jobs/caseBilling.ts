// Billing a P&I case.
//
// Two kinds of money, both keyed to the case:
//   * ATTENDANCES — hours, priced PER ENTRY (mig 208). The same surveyor bills a
//     call-out at one rate and expert-witness testimony at another, in another
//     currency, on the same case. The price lives in job_attendance_billing, an
//     admin-only sibling table: a surveyor can read their own log rows, so a rate
//     column there would show them the margin on their own hour.
//   * CASE CHARGES — the correspondency fee at case open, and third-party/contractor
//     costs. A dated one-time amount, optionally with a receipt.
//
// Neither ever touches jobs.invoice_id, so the whole job-level invoicing path (voyage
// roll-up, reconciliation, the hours-changed check) stays out of this.
// billed_invoice_id is NULL = outstanding; the case is billed again and again over
// years while staying open, and deleting or voiding an invoice releases exactly what
// it covered.
//
// ONE INVOICE, ONE CURRENCY. invoices.currency is a single column, line items have
// none, and there is no FX anywhere in this app by policy — the invoice builder and
// voyage billing both refuse to mix rather than convert. A case whose outstanding work
// spans two currencies therefore produces TWO invoices. bill_case_items enforces that
// in the database by stamping only the items priced in the invoice's own currency.

import { createClient } from '@/lib/supabase/client'

export type EntryKind = 'regular' | 'overtime'
export type CaseChargeKind = 'correspondency' | 'third_party' | 'disbursement' | 'other'

export const CASE_CHARGE_KIND: Record<CaseChargeKind, string> = {
  correspondency: 'Correspondency fee',
  third_party: 'Third party / contractor',
  disbursement: 'Disbursement',
  other: 'Other',
}

export const CURRENCIES = ['TTD', 'USD', 'EUR', 'GBP'] as const

export interface CaseAttendance {
  id: string
  kind: EntryKind
  job_surveyor_id: string
  surveyor_name: string
  entry_date: string | null
  hours: number
  location: string | null
  note: string | null
  billed_invoice_id: string | null
  billed_invoice_number: string | null
  /** From job_attendance_billing. Null rate = nobody has priced this yet, and it is
   *  deliberately NOT billable until someone does. */
  description: string | null
  charge_rate: number | null
  charge_currency: string
}

export interface CaseCharge {
  id: string
  job_id: string
  kind: CaseChargeKind
  description: string
  payee: string | null
  incurred_on: string
  qty: number
  unit_amount: number
  currency: string
  receipt_path: string | null
  billed_invoice_id: string | null
  billed_invoice_number: string | null
}

const num = (v: unknown, d = 0) => (v == null ? d : Number(v))

// ── Attendances ─────────────────────────────────────────────────────────────

/** Every attendance on a case, both logs merged with their prices, newest first. */
export async function listCaseAttendances(jobId: string): Promise<CaseAttendance[]> {
  const supabase = createClient()
  const { data: js } = await supabase
    .from('job_surveyors')
    .select('id, surveyor:profiles!job_surveyors_surveyor_id_fkey(full_name)')
    .eq('job_id', jobId)

  const rows = (js ?? []) as any[]
  if (!rows.length) return []
  const nameOf = new Map<string, string>(rows.map(r => [r.id, r.surveyor?.full_name ?? 'Unknown']))
  const ids = rows.map(r => r.id)

  const cols = 'id, job_surveyor_id, entry_date, hours, location, note, billed_invoice_id, invoice:invoices(invoice_number)'
  const [reg, ot, prices] = await Promise.all([
    supabase.from('job_surveyor_regular').select(cols).in('job_surveyor_id', ids),
    supabase.from('job_surveyor_overtime').select(cols).in('job_surveyor_id', ids),
    // Admin-only table: for anyone else this returns nothing and every entry simply
    // reads as unpriced, rather than leaking a rate.
    supabase.from('job_attendance_billing').select('regular_entry_id, overtime_entry_id, description, charge_rate, charge_currency'),
  ])

  const priceOf = new Map<string, { description: string | null; charge_rate: number | null; charge_currency: string }>()
  for (const p of ((prices.data ?? []) as any[])) {
    const key = p.regular_entry_id ?? p.overtime_entry_id
    if (key) priceOf.set(key, {
      description: p.description ?? null,
      charge_rate: p.charge_rate == null ? null : Number(p.charge_rate),
      charge_currency: p.charge_currency ?? 'TTD',
    })
  }

  const map = (r: any, kind: EntryKind): CaseAttendance => {
    const p = priceOf.get(r.id)
    return {
      id: r.id,
      kind,
      job_surveyor_id: r.job_surveyor_id,
      surveyor_name: nameOf.get(r.job_surveyor_id) ?? 'Unknown',
      entry_date: r.entry_date ?? null,
      hours: num(r.hours),
      location: r.location ?? null,
      note: r.note ?? null,
      billed_invoice_id: r.billed_invoice_id ?? null,
      billed_invoice_number: r.invoice?.invoice_number ?? null,
      description: p?.description ?? null,
      charge_rate: p?.charge_rate ?? null,
      charge_currency: p?.charge_currency ?? 'TTD',
    }
  }

  return [
    ...((reg.data ?? []) as any[]).map(r => map(r, 'regular')),
    ...((ot.data ?? []) as any[]).map(r => map(r, 'overtime')),
  ].sort((a, b) => (b.entry_date ?? '').localeCompare(a.entry_date ?? ''))
}

/** Price one attendance. Admin-only at the database.
 *
 *  Upserts on the partial-unique index for whichever log the entry belongs to, so
 *  re-pricing an entry replaces its price rather than adding a second one. */
export async function setAttendancePrice(
  entryId: string,
  kind: EntryKind,
  price: { description: string | null; charge_rate: number | null; charge_currency: string },
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const key = kind === 'regular' ? 'regular_entry_id' : 'overtime_entry_id'
  const { error } = await supabase.from('job_attendance_billing').upsert({
    [key]: entryId,
    description: price.description,
    charge_rate: price.charge_rate,
    charge_currency: price.charge_currency,
    updated_by: user?.id ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: key })
  return error ? { error: error.message } : {}
}

// ── Case charges (correspondency fee, contractor costs) ─────────────────────

export async function listCaseCharges(jobId: string): Promise<CaseCharge[]> {
  const { data } = await createClient()
    .from('case_charges')
    .select('id, job_id, kind, description, payee, incurred_on, qty, unit_amount, currency, receipt_path, billed_invoice_id, invoice:invoices(invoice_number)')
    .eq('job_id', jobId)
    .order('incurred_on', { ascending: false })
  return ((data ?? []) as any[]).map(c => ({
    id: c.id, job_id: c.job_id, kind: c.kind, description: c.description,
    payee: c.payee ?? null, incurred_on: c.incurred_on,
    qty: num(c.qty, 1), unit_amount: num(c.unit_amount), currency: c.currency,
    receipt_path: c.receipt_path ?? null,
    billed_invoice_id: c.billed_invoice_id ?? null,
    billed_invoice_number: c.invoice?.invoice_number ?? null,
  }))
}

export async function addCaseCharge(input: {
  jobId: string
  kind: CaseChargeKind
  description: string
  payee?: string | null
  incurred_on: string
  qty: number
  unit_amount: number
  currency: string
  receipt_path?: string | null
}): Promise<{ id?: string; error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('case_charges').insert({
    job_id: input.jobId, kind: input.kind, description: input.description,
    payee: input.payee ?? null, incurred_on: input.incurred_on,
    qty: input.qty, unit_amount: input.unit_amount, currency: input.currency,
    receipt_path: input.receipt_path ?? null, created_by: user?.id ?? null,
  }).select('id').single()
  if (error) return { error: error.message }
  return { id: data?.id }
}

export async function updateCaseCharge(id: string, patch: Partial<{
  kind: CaseChargeKind; description: string; payee: string | null; incurred_on: string
  qty: number; unit_amount: number; currency: string; receipt_path: string | null
}>): Promise<{ error?: string }> {
  const { data, error } = await createClient().from('case_charges').update(patch).eq('id', id).select('id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'That charge could not be changed.' }
  return {}
}

/** A charge that has already been billed is NOT deletable here — deleting it would
 *  remove money an invoice is still charging for. Release the invoice first. */
export async function deleteCaseCharge(id: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: existing } = await supabase.from('case_charges').select('billed_invoice_id').eq('id', id).maybeSingle()
  if (existing?.billed_invoice_id) {
    return { error: 'That charge is on an invoice. Delete or void the invoice first.' }
  }
  const { error } = await supabase.from('case_charges').delete().eq('id', id)
  return error ? { error: error.message } : {}
}

// ── The outstanding position, grouped by currency ───────────────────────────

export interface CurrencyGroup {
  currency: string
  attendances: CaseAttendance[]
  charges: CaseCharge[]
  total: number
}

export interface CaseBillingPosition {
  /** One group per currency with something outstanding, biggest first. */
  groups: CurrencyGroup[]
  /** Outstanding attendances nobody has priced. Deliberately separate: they are NOT
   *  billable, and lumping them into a currency group would bill hours at zero. */
  unpriced: CaseAttendance[]
  billedTotal: Record<string, number>
}

const r2 = (n: number) => Math.round(n * 100) / 100
const lineTotal = (a: CaseAttendance) => r2(a.hours * (a.charge_rate ?? 0))
const chargeTotal = (c: CaseCharge) => r2(c.qty * c.unit_amount)

/**
 * What this case could bill right now, split by currency.
 *
 * `upTo` limits it to work done on or before that day — the cutoff of the run about to
 * happen. An UNDATED attendance can never be caught by a date cutoff, so it is left
 * outstanding and visible rather than quietly billed or quietly lost.
 */
export function billingPosition(
  attendances: CaseAttendance[],
  charges: CaseCharge[],
  upTo?: string | null,
): CaseBillingPosition {
  const within = (d: string | null) => !upTo || (!!d && d.slice(0, 10) <= upTo)

  const billedTotal: Record<string, number> = {}
  for (const a of attendances) {
    if (!a.billed_invoice_id) continue
    billedTotal[a.charge_currency] = r2((billedTotal[a.charge_currency] ?? 0) + lineTotal(a))
  }
  for (const c of charges) {
    if (!c.billed_invoice_id) continue
    billedTotal[c.currency] = r2((billedTotal[c.currency] ?? 0) + chargeTotal(c))
  }

  const outA = attendances.filter(a => !a.billed_invoice_id && within(a.entry_date))
  const outC = charges.filter(c => !c.billed_invoice_id && within(c.incurred_on))

  const unpriced = outA.filter(a => a.charge_rate == null)
  const priced = outA.filter(a => a.charge_rate != null)

  const byCcy = new Map<string, CurrencyGroup>()
  const group = (ccy: string) => {
    let g = byCcy.get(ccy)
    if (!g) { g = { currency: ccy, attendances: [], charges: [], total: 0 }; byCcy.set(ccy, g) }
    return g
  }
  for (const a of priced) { const g = group(a.charge_currency); g.attendances.push(a); g.total = r2(g.total + lineTotal(a)) }
  for (const c of outC)    { const g = group(c.currency);        g.charges.push(c);     g.total = r2(g.total + chargeTotal(c)) }

  return {
    groups: [...byCcy.values()].sort((a, b) => b.total - a.total),
    unpriced,
    billedTotal,
  }
}

// ── The billing run ─────────────────────────────────────────────────────────

/**
 * Close off one CURRENCY's outstanding items up to `cutoff`, onto a new invoice.
 *
 * ORDER MATTERS. The invoice and its lines are written FIRST, then the RPC stamps the
 * items. If the stamp fails the invoice is deleted, and because every billed_invoice_id
 * is ON DELETE SET NULL that also releases whatever it had stamped, leaving the case
 * exactly as it was. The reverse order could mark work as paid by an invoice that was
 * never created, which is unrecoverable without knowing what to undo.
 *
 * The RPC re-checks the currency against the invoice, so even if this function were
 * called with a mixed group the database would stamp only the matching items.
 */
export async function billCaseRun(input: {
  caseId: string
  clientId: string | null
  currency: string
  cutoff: string
  group: CurrencyGroup
  caseLabel: string
  notes?: string | null
}): Promise<{ invoiceId?: string; invoiceNumber?: string | null; stamped?: number; error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const lines = [
    ...input.group.attendances.map(a => ({
      description: `${a.description || 'Attendance'} — ${a.surveyor_name}${a.entry_date ? ` (${a.entry_date})` : ''}`,
      qty: a.hours,
      unit_price: a.charge_rate ?? 0,
      is_expense: false,
      receipt_path: null as string | null,
    })),
    ...input.group.charges.map(c => ({
      description: c.payee ? `${c.description} — ${c.payee}` : c.description,
      qty: c.qty,
      unit_price: c.unit_amount,
      // A third-party cost is a pass-through, and the invoice already has an expense
      // line type with a receipt (mig 083). Our own fees are ordinary charges.
      is_expense: c.kind === 'third_party' || c.kind === 'disbursement',
      receipt_path: c.receipt_path,
    })),
  ].filter(l => l.qty > 0)

  if (!lines.length) return { error: 'There is nothing outstanding to bill up to that date.' }
  const subtotal = r2(lines.reduce((s, l) => s + l.qty * l.unit_price, 0))

  const { data: inv, error: invErr } = await supabase.from('invoices').insert({
    // job_id stays NULL: a case is never the "job" of an invoice. The link is each line
    // item's job_id, which carries no unique constraint (mig 075) — so the same case
    // appears on invoice after invoice, which is the point.
    job_id: null,
    client_id: input.clientId,
    status: 'active',
    created_by: user?.id ?? null,
    currency: input.currency,
    notes: input.notes || null,
    subtotal, tax_total: 0, total: subtotal,
  }).select('id, invoice_number').single()
  if (invErr) return { error: invErr.message }

  const invoiceId = inv.id as string
  const { error: liErr } = await supabase.from('invoice_line_items').insert(
    lines.map((l, i) => ({
      invoice_id: invoiceId, job_id: input.caseId, description: l.description,
      qty: l.qty, unit_price: l.unit_price, amount: r2(l.qty * l.unit_price),
      sort: i, is_expense: l.is_expense, receipt_path: l.receipt_path,
    })),
  )
  if (liErr) { await supabase.from('invoices').delete().eq('id', invoiceId); return { error: liErr.message } }

  const { data: stamp, error: rpcErr } = await supabase.rpc('bill_case_items', {
    p_case: input.caseId, p_invoice: invoiceId, p_cutoff: input.cutoff,
  })
  if (rpcErr) { await supabase.from('invoices').delete().eq('id', invoiceId); return { error: rpcErr.message } }

  const stamped = Number((stamp as { total?: number } | null)?.total ?? 0)
  // Lines were written but nothing was stamped: the outstanding position moved between
  // reading it and billing it. Undo rather than leave an invoice charging for work that
  // is still outstanding — which would bill it twice.
  if (stamped === 0) {
    await supabase.from('invoices').delete().eq('id', invoiceId)
    return { error: 'Nothing was outstanding by the time this ran — no invoice was created. Reopen the case and try again.' }
  }

  return { invoiceId, invoiceNumber: (inv as { invoice_number?: string | null }).invoice_number ?? null, stamped }
}
