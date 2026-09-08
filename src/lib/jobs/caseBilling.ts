// Billing a P&I case.
//
// A case is billed by ATTENDANCE, never as a job line (migs 205/206). Each entry in
// the two time logs carries the invoice that paid for it; NULL means outstanding. So
// a case can be billed again and again over years while it stays open, and
// jobs.invoice_id stays NULL on it — which is what keeps the entire job-level
// invoicing path (voyage roll-up, reconciliation, the hours-changed check) out of
// this. bill_jobs_onto_invoice refuses a live case outright.
//
// Kept apart from cases.ts on purpose: that module answers "is this a case and what
// state is it in?" and is imported by reconciliation and the job lifecycle. This one
// touches money and is imported only by the billing UI.

import { createClient } from '@/lib/supabase/client'

export interface CaseAttendance {
  id: string
  kind: 'regular' | 'overtime'
  job_surveyor_id: string
  surveyor_name: string
  entry_date: string | null
  hours: number
  location: string | null
  note: string | null
  billed_invoice_id: string | null
  billed_invoice_number: string | null
}

export interface CaseSurveyorTotals {
  job_surveyor_id: string
  surveyor_name: string
  billed: number
  outstanding: number
  /** What we CHARGE for this person on this case — NOT what we pay them. Admin-only
   *  at the database (mig 206 §3): for anyone else the read simply returns nothing and
   *  the rate shows blank, rather than leaking the margin on their own hour. */
  charge_rate: number | null
  charge_currency: string
}

/** Every attendance on a case, both logs merged, newest first. */
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
  const [reg, ot] = await Promise.all([
    supabase.from('job_surveyor_regular').select(cols).in('job_surveyor_id', ids),
    supabase.from('job_surveyor_overtime').select(cols).in('job_surveyor_id', ids),
  ])

  const map = (r: any, kind: 'regular' | 'overtime'): CaseAttendance => ({
    id: r.id,
    kind,
    job_surveyor_id: r.job_surveyor_id,
    surveyor_name: nameOf.get(r.job_surveyor_id) ?? 'Unknown',
    entry_date: r.entry_date ?? null,
    hours: Number(r.hours ?? 0),
    location: r.location ?? null,
    note: r.note ?? null,
    billed_invoice_id: r.billed_invoice_id ?? null,
    billed_invoice_number: r.invoice?.invoice_number ?? null,
  })

  return [
    ...((reg.data ?? []) as any[]).map(r => map(r, 'regular')),
    ...((ot.data ?? []) as any[]).map(r => map(r, 'overtime')),
  ].sort((a, b) => (b.entry_date ?? '').localeCompare(a.entry_date ?? ''))
}

/** Billed vs outstanding per surveyor, with the charge rate to apply.
 *
 *  `upTo` (a YYYY-MM-DD key) limits the OUTSTANDING side to work done on or before
 *  that day — the cutoff the billing run is about to use. Pass nothing for the
 *  case's whole outstanding position. */
export async function caseSurveyorTotals(jobId: string, upTo?: string | null): Promise<CaseSurveyorTotals[]> {
  const supabase = createClient()
  const entries = await listCaseAttendances(jobId)
  const jsIds = [...new Set(entries.map(e => e.job_surveyor_id))]

  const rates = jsIds.length
    ? (await supabase.from('job_surveyor_billing')
        .select('job_surveyor_id, charge_rate, charge_currency').in('job_surveyor_id', jsIds)).data
    : []
  const rateOf = new Map<string, { charge_rate: number | null; charge_currency: string }>(
    ((rates ?? []) as any[]).map(r => [r.job_surveyor_id, {
      charge_rate: r.charge_rate == null ? null : Number(r.charge_rate),
      charge_currency: r.charge_currency ?? 'TTD',
    }]),
  )

  const acc = new Map<string, CaseSurveyorTotals>()
  for (const e of entries) {
    let t = acc.get(e.job_surveyor_id)
    if (!t) {
      const r = rateOf.get(e.job_surveyor_id)
      t = {
        job_surveyor_id: e.job_surveyor_id,
        surveyor_name: e.surveyor_name,
        billed: 0,
        outstanding: 0,
        charge_rate: r?.charge_rate ?? null,
        charge_currency: r?.charge_currency ?? 'TTD',
      }
      acc.set(e.job_surveyor_id, t)
    }
    if (e.billed_invoice_id) { t.billed += e.hours; continue }
    // Outstanding, but only up to the cutoff. An UNDATED entry can never be caught by
    // a date cutoff, so it stays outstanding until someone dates it — visible on the
    // case rather than quietly billed or quietly lost.
    if (upTo && (!e.entry_date || e.entry_date.slice(0, 10) > upTo)) continue
    t.outstanding += e.hours
  }
  return [...acc.values()].sort((a, b) => a.surveyor_name.localeCompare(b.surveyor_name))
}

/** Set what we charge for one surveyor on one case. Admin-only at the database. */
export async function setCaseChargeRate(
  jobSurveyorId: string,
  chargeRate: number | null,
  currency: string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase.from('job_surveyor_billing').upsert({
    job_surveyor_id: jobSurveyorId,
    charge_rate: chargeRate,
    charge_currency: currency,
    updated_by: user?.id ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'job_surveyor_id' })
  return error ? { error: error.message } : {}
}

export interface CaseBillLine {
  job_surveyor_id: string
  surveyor_name: string
  qty: number
  unit_price: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Close off a case's outstanding attendances up to `cutoff`, onto a new invoice.
 *
 * ORDER MATTERS. The invoice and its lines are written FIRST, then the RPC stamps the
 * entries. If the stamp fails the invoice is deleted — and because billed_invoice_id
 * is ON DELETE SET NULL, that also releases anything it had already stamped, leaving
 * the case exactly as it was. The reverse order could mark attendances as paid by an
 * invoice that was never created, which is unrecoverable without knowing what to undo.
 */
export async function billCase(input: {
  caseId: string
  clientId: string | null
  currency: string
  /** YYYY-MM-DD. Entries dated on or before this are billed. */
  cutoff: string
  lines: CaseBillLine[]
  caseLabel: string
  notes?: string | null
}): Promise<{ invoiceId?: string; invoiceNumber?: string | null; stamped?: number; error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const billable = input.lines.filter(l => l.qty > 0)
  if (!billable.length) return { error: 'There is nothing outstanding to bill up to that date.' }

  const subtotal = r2(billable.reduce((s, l) => s + l.qty * l.unit_price, 0))

  const { data: inv, error: invErr } = await supabase.from('invoices').insert({
    // job_id stays NULL: a case is never the "job" of an invoice. The link is each
    // line item's job_id, which carries no unique constraint (mig 075) — so the same
    // case can legitimately appear on invoice after invoice, which is the point.
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
    billable.map((l, i) => ({
      invoice_id: invoiceId,
      job_id: input.caseId,
      description: `${input.caseLabel} — ${l.surveyor_name} (to ${input.cutoff})`,
      qty: l.qty,
      unit_price: l.unit_price,
      amount: r2(l.qty * l.unit_price),
      sort: i,
    })),
  )
  if (liErr) { await supabase.from('invoices').delete().eq('id', invoiceId); return { error: liErr.message } }

  const { data: stamp, error: rpcErr } = await supabase.rpc('bill_case_attendances', {
    p_case: input.caseId, p_invoice: invoiceId, p_cutoff: input.cutoff,
  })
  if (rpcErr) { await supabase.from('invoices').delete().eq('id', invoiceId); return { error: rpcErr.message } }

  const stamped = Number((stamp as { total?: number } | null)?.total ?? 0)
  // Lines were written but nothing was stamped: the outstanding position moved between
  // reading it and billing it (someone else billed first, or an entry was re-dated).
  // Undo rather than leave an invoice charging for hours that are still outstanding.
  if (stamped === 0) {
    await supabase.from('invoices').delete().eq('id', invoiceId)
    return { error: 'Nothing was outstanding by the time this ran — no invoice was created. Reopen the case and try again.' }
  }

  return { invoiceId, invoiceNumber: (inv as any).invoice_number ?? null, stamped }
}
