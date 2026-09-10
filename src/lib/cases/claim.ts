// What a case could claim, and what a claim prints.
//
// Pure functions only — no supabase import — so the whole of this is unit-testable and
// the PDF and the CSV are built from ONE line list. That last part is deliberate: the
// labour report does the same thing for the same reason. Two builders reading the same
// source cannot disagree about a total; two builders each doing their own arithmetic
// eventually will.

import { formatMinutes, minutesToHours } from './minutes'
import { RATE_TYPE, type CaseAttendance, type CaseCharge, type CaseRow } from './api'
import { chargeKindLabel } from './chargeKind'
import { caseTitle } from './title'

const r2 = (n: number) => Math.round(n * 100) / 100

export interface CurrencyGroup {
  currency: string
  attendances: CaseAttendance[]
  charges: CaseCharge[]
  total: number
  itemCount: number
}

/** An outstanding entry nobody has priced — an attendance with no rate, or a timed fee
 *  logged before a rate was set. Normalised because the two arrive from different tables
 *  and everything that reads this only ever needs to say how many and how long. */
export interface UnpricedItem {
  id: string
  date: string
  label: string
  minutes: number
}

export interface ClaimPosition {
  /** One group per currency with something outstanding, largest first. */
  groups: CurrencyGroup[]
  /** Held SEPARATE and never rolled into a currency group: ten minutes with no rate must
   *  not be claimed at zero and marked paid. */
  unpriced: UnpricedItem[]
  /** Already claimed, per currency — the "billed to date" figure. */
  claimed: Record<string, number>
  /** Total minutes recorded on the case, claimed or not. */
  totalMinutes: number
}

/**
 * The case's money position.
 *
 * `upTo` (YYYY-MM-DD) limits the OUTSTANDING side to work done on or before that day —
 * the cutoff of the claim about to happen. Pass null for the whole position.
 */
export function claimPosition(
  attendances: CaseAttendance[],
  charges: CaseCharge[],
  upTo?: string | null,
): ClaimPosition {
  const within = (d: string | null) => !upTo || (!!d && d.slice(0, 10) <= upTo)

  const claimed: Record<string, number> = {}
  for (const a of attendances) {
    if (!a.claim_id || a.charge_amount == null) continue
    claimed[a.currency] = r2((claimed[a.currency] ?? 0) + a.charge_amount)
  }
  for (const c of charges) {
    if (!c.claim_id) continue
    claimed[c.currency] = r2((claimed[c.currency] ?? 0) + c.amount)
  }

  const outA = attendances.filter(a => !a.claim_id && within(a.attended_on))
  const outC = charges.filter(c => !c.claim_id && within(c.incurred_on))

  // A fee is unpriced only when it is TIME with no rate. A purchase of zero is somebody
  // saying it cost nothing, which is a different statement and gets claimed as one.
  const noRate = (c: CaseCharge) => c.minutes != null && !(c.unit_amount > 0)

  const unpriced: UnpricedItem[] = [
    ...outA.filter(a => a.charge_amount == null).map(a => ({
      id: a.id, date: a.attended_on, label: a.description || a.attendee_label, minutes: a.minutes,
    })),
    ...outC.filter(noRate).map(c => ({
      id: c.id, date: c.incurred_on, label: c.description || chargeKindLabel(c.kind),
      minutes: c.minutes ?? 0,
    })),
  ]
  const priced = outA.filter(a => a.charge_amount != null)

  const byCcy = new Map<string, CurrencyGroup>()
  const group = (ccy: string) => {
    let g = byCcy.get(ccy)
    if (!g) { g = { currency: ccy, attendances: [], charges: [], total: 0, itemCount: 0 }; byCcy.set(ccy, g) }
    return g
  }
  for (const a of priced) {
    const g = group(a.currency)
    g.attendances.push(a); g.total = r2(g.total + (a.charge_amount ?? 0)); g.itemCount++
  }
  for (const c of outC) {
    if (noRate(c)) continue
    const g = group(c.currency)
    g.charges.push(c); g.total = r2(g.total + c.amount); g.itemCount++
  }

  return {
    groups: [...byCcy.values()].sort((a, b) => b.total - a.total),
    unpriced,
    claimed,
    // Time is recorded on BOTH sides now: an attendance is somebody going somewhere, a
    // call or an email is a timed fee. The case's time is the two together.
    totalMinutes: attendances.reduce((s, a) => s + a.minutes, 0)
               + charges.reduce((s, c) => s + (c.minutes ?? 0), 0),
  }
}

// ── The printed lines ───────────────────────────────────────────────────────

export interface ClaimLine {
  date: string
  who: string
  detail: string
  basis: string
  /** What the quantity column shows: hours, days, or blank for a flat fee. */
  qty: string
  rate: string
  amount: number
}

/** ONE list, used by both the PDF and the CSV. Attendances first in date order, then
 *  fees and costs — which is how a reader expects to see time and disbursements. */
export function claimLines(group: CurrencyGroup): ClaimLine[] {
  const byDate = <T extends { attended_on?: string; incurred_on?: string }>(a: T, b: T) =>
    ((a.attended_on ?? a.incurred_on ?? '')).localeCompare(b.attended_on ?? b.incurred_on ?? '')

  const att: ClaimLine[] = [...group.attendances].sort(byDate).map(a => ({
    date: a.attended_on,
    who: a.attendee_label,
    detail: a.description || 'Attendance',
    basis: RATE_TYPE[a.rate_type],
    qty: a.rate_type === 'hourly' ? String(minutesToHours(a.minutes))
       : a.rate_type === 'daily' ? String(a.days ?? 0)
       : '',
    rate: a.rate_amount == null ? '' : String(a.rate_amount),
    amount: a.charge_amount ?? 0,
  }))

  const chg: ClaimLine[] = [...group.charges].sort(byDate).map(c => ({
    date: c.incurred_on,
    who: c.payee || '',
    // A quick block carries no detail of its own — a tap cannot know what the call was
    // about — so the kind IS the line. Never print a blank on a claim.
    detail: c.description || chargeKindLabel(c.kind),
    basis: c.minutes == null ? chargeKindLabel(c.kind) : `${chargeKindLabel(c.kind)} (hourly)`,
    qty: c.minutes != null ? String(minutesToHours(c.minutes))
       : c.qty === 1 ? ''
       : String(c.qty),
    rate: String(c.unit_amount),
    amount: c.amount,
  }))

  return [...att, ...chg]
}

/** Time on the case that this claim covers, for the summary line. */
export function claimMinutes(group: CurrencyGroup): number {
  return group.attendances.reduce((s, a) => s + a.minutes, 0)
}

export function claimTimeLabel(group: CurrencyGroup): string {
  return formatMinutes(claimMinutes(group))
}

// ── CSV ─────────────────────────────────────────────────────────────────────

const esc = (v: unknown) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const CSV_COLS = ['Date', 'Who', 'Detail', 'Basis', 'Quantity', 'Rate', 'Currency', 'Amount'] as const

/**
 * The same lines the PDF prints, for checking in Excel.
 *
 * Amounts are written BARE so a spreadsheet can sum the column, and the currency sits in
 * its own column — one claim only ever holds one currency, so a mixed sum is impossible
 * by construction rather than by convention. Returns text only; the caller prepends the
 * BOM, exactly as the labour report does.
 */
export function claimCsv(kase: CaseRow, group: CurrencyGroup, cutoff: string): string {
  const lines: string[] = []
  lines.push(esc(`P&I case — ${caseTitle(kase)}`))
  if (kase.case_ref) lines.push(esc(`Reference: ${kase.case_ref}`))
  if (kase.principal) lines.push(esc(`Principal: ${kase.principal}`))
  lines.push(esc(`Up to: ${cutoff}`))
  lines.push('')
  lines.push(CSV_COLS.map(esc).join(','))

  for (const l of claimLines(group)) {
    lines.push([l.date, l.who, l.detail, l.basis, l.qty, l.rate, group.currency, l.amount].map(esc).join(','))
  }

  lines.push('')
  lines.push(['', '', 'Total', '', '', '', group.currency, r2(group.total)].map(esc).join(','))
  return lines.join('\r\n')
}

/** `Collision-claim-USD-2026-09-30.csv` — sortable, and says what it is at a glance. */
export function claimFilename(kase: CaseRow, currency: string, cutoff: string, ext: 'pdf' | 'csv'): string {
  const safe = caseTitle(kase).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${safe}-claim-${currency}-${cutoff}.${ext}`
}
