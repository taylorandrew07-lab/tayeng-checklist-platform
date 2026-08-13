// Pricing a draught-survey voyage as ONE invoice line.
//
// The client sees a single "Final Draught Survey" line whose amount is the whole
// voyage: Initial + Interim(s) + Final. Andrew's arithmetic, with a 350 rate on each
// stage — Initial + Final = 700, Initial + Interim + Final = 1050.
//
// Every leg is priced through seedCharge, the same function the single-job path uses,
// and the line's amount is the SUM OF THEIR AMOUNTS. Nothing sums quantities, so the
// never-add-hours-and-days rule is never even approached.
//
// THE BLOCKS ARE THE POINT. Collapsing three legs into one figure destroys the reader's
// ability to notice that one of them priced at zero: today an unpriced job shows a
// visible "3 × 0" on the invoice, but inside a sum it simply vanishes — and the leg is
// still closed and locked behind a number that omitted it. So anything ambiguous is a
// hard refusal, never a warning. These blocks are also what make shipping without a
// company-default rate table safe.

import { seedCharge, chargeAmount, type InvoiceableJob } from './invoicing'
import { draughtStage, type VoyageGroup } from './voyage'
import type { ClientRate, Currency } from '@/lib/types/database'

/** One leg's contribution to the voyage line. Shown to the admin before they commit,
 *  so 350 + 350 + 350 = 1050 can be checked by eye, and stored on the invoice's notes
 *  so it can be checked again a year later. */
export interface VoyageCharge {
  job_id: string
  stage: string
  report_number: string | null
  rate_id: string | null
  qty: number
  unit_price: number
  amount: number
  currency: Currency | null
}

export type VoyageBlock =
  /** No rate matched this leg at all — it would contribute nothing. */
  | { kind: 'no_rate'; stage: string }
  /** Matched only the client's catch-all rate (no job type), which is a fee for
   *  something else. pickRate falls through to it by design; inside a sum nobody can
   *  see that a Draught Survey was priced from an unrelated line. */
  | { kind: 'catch_all_rate'; stage: string }
  /** Priced at zero, for any reason — including the deliberate hourly-rate-on-a-
   *  day-billed-job zero that seedCharge produces to make a line look wrong. */
  | { kind: 'zero_price'; stage: string }
  /** A leg priced in a different currency from the invoice. There is no FX anywhere. */
  | { kind: 'currency_mismatch'; stage: string; currency: string }
  /** The group has no single Final, so no job can anchor the line or carry the report. */
  | { kind: 'no_final' }

export interface VoyageLineSeed {
  description: string
  qty: number
  unit_price: number
  /** The Final. The line's job_id, the job that gets closed as the parent, and the
   *  report number the PDF prints — all the same job, on purpose. */
  anchorJobId: string | null
  breakdown: VoyageCharge[]
  blocks: VoyageBlock[]
  total: number
}

/** Rate id → rate, for the catch-all check. */
function rateById(rates: ClientRate[], id: string | null): ClientRate | null {
  return id ? rates.find(r => r.id === id) ?? null : null
}

/**
 * Price a whole voyage as one line.
 *
 * `members` are the pool rows for the group's jobs, keyed by id — the group itself
 * carries only the grouping fields, while pricing needs the billable quantities.
 * A member missing from the pool is NOT silently skipped: it produces a no_rate block,
 * because a leg we cannot price is exactly the leg that would be billed at nothing.
 */
export function seedVoyageLine(args: {
  group: VoyageGroup
  members: Map<string, InvoiceableJob>
  rates: ClientRate[]
  invoiceCurrency: Currency
}): VoyageLineSeed {
  const { group, members, rates, invoiceCurrency } = args
  const blocks: VoyageBlock[] = []
  const breakdown: VoyageCharge[] = []

  if (!group.final) blocks.push({ kind: 'no_final' })

  for (const m of group.members) {
    const stage = draughtStage(m) ?? 'Survey'
    const pool = members.get(m.id)
    if (!pool) { blocks.push({ kind: 'no_rate', stage }); continue }

    const charge = seedCharge(pool, rates)
    const rate = rateById(rates, charge.rate_id)
    const amount = chargeAmount(charge)

    if (!rate) blocks.push({ kind: 'no_rate', stage })
    else if (!rate.job_type) blocks.push({ kind: 'catch_all_rate', stage })
    else if (rate.currency && rate.currency !== invoiceCurrency) {
      blocks.push({ kind: 'currency_mismatch', stage, currency: rate.currency })
    }
    // Checked independently of the rate: a rate can exist and still price at zero.
    if (charge.unit_price === 0 || amount === 0) blocks.push({ kind: 'zero_price', stage })

    breakdown.push({
      job_id: m.id, stage, report_number: pool.report_number,
      rate_id: charge.rate_id, qty: charge.qty, unit_price: charge.unit_price,
      amount, currency: rate?.currency ?? null,
    })
  }

  const total = Math.round(breakdown.reduce((s, c) => s + c.amount, 0) * 100) / 100

  // The head keeps seedCharge's exact "<Vessel> — <Type (Stage)>" shape, because
  // InvoicePDF splits it on ' — ' into three fixed-width columns. The voyage and the
  // legs go on the detail lines, which the PDF prints as ordinary body text.
  const anchor = group.final ? members.get(group.final.id) : undefined
  const head = anchor
    ? seedCharge(anchor, rates).description.split('\n')[0]
    : (group.vesselName ?? 'Draught Survey')
  const legs = breakdown.map(c => c.stage).join(' + ')
  const detail = [
    group.voyage ? `Voyage ${group.voyage}` : null,
    breakdown.length > 1 ? `Includes ${legs}` : null,
  ].filter(Boolean).join(' · ')

  return {
    description: detail ? `${head}\n${detail}` : head,
    // qty 1 on purpose: InvoicePDF only prints the "n × price" note when qty ≠ 1, and
    // a voyage's price is not a multiple of anything the client would recognise.
    qty: 1,
    unit_price: total,
    anchorJobId: group.final?.id ?? null,
    breakdown,
    blocks,
    total,
  }
}

/** Plain-English refusal, shown where the admin is trying to bill. */
export function describeBlock(b: VoyageBlock): string {
  switch (b.kind) {
    case 'no_final': return 'This voyage has no single final survey, so nothing can carry its bill or its report number.'
    case 'no_rate': return `No client rate matches the ${b.stage} survey — it would be billed at nothing.`
    case 'catch_all_rate': return `The ${b.stage} survey only matches this client's catch-all rate, which is a fee for something else.`
    case 'zero_price': return `The ${b.stage} survey prices at zero — check the client's rate for that stage.`
    case 'currency_mismatch': return `The ${b.stage} survey is priced in ${b.currency}, which is not this invoice's currency.`
  }
}

/** The internal audit trail for a rolled-up line: what each leg contributed. Stored on
 *  invoices.notes (internal, never printed) because the client's line deliberately
 *  shows one figure, and a year later somebody will ask how it was reached. */
export function breakdownNote(seed: VoyageLineSeed, voyage: string | null): string {
  const legs = seed.breakdown
    .map(c => `  ${c.stage}${c.report_number ? ` (${c.report_number})` : ''}: ${c.qty} × ${c.unit_price} = ${c.amount}`)
    .join('\n')
  return `Voyage ${voyage ?? '(no number)'} rolled up:\n${legs}\n  Total: ${seed.total}`
}
