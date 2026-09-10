// Time on a P&I case is WHOLE MINUTES, everywhere, and only becomes hours for display.
//
// Why this file exists at all: hours in the jobs schema are a 2-decimal number, so a
// ten-minute block is 0.17. Six of them come to 1.02 hours, not 1.00 — a 2% over-bill
// that compounds silently and lands on a claim. There is no decimal that represents a
// sixth of an hour, so the fix is to stop trying: store minutes as an integer and divide
// only at the last moment, for a human to read.
//
// Nothing here rounds a duration. The only rounding in the whole case-money path is on
// the MONEY, and it happens in the database (case_attendances.charge_amount is GENERATED).

/** One tap of a quick button. Both "Phone call" and "Email" add exactly this. */
export const QUICK_BLOCK_MINUTES = 10

/** Minutes → "1 h 40 m". Compact on purpose: this sits in a dense list, next to a rate
 *  and an amount, and "1 hour 40 minutes" would push the money off a phone screen. */
export function formatMinutes(total: number): string {
  const m = Math.max(0, Math.round(total))
  if (m === 0) return '0 m'
  const h = Math.floor(m / 60)
  const rest = m % 60
  if (h === 0) return `${rest} m`
  if (rest === 0) return `${h} h`
  return `${h} h ${rest} m`
}

/** Minutes → decimal hours, for an invoice line quantity. Rounded to 2dp because that is
 *  what a client's invoice shows — never fed back into a stored duration. */
export function minutesToHours(total: number): number {
  return Math.round((Math.max(0, total) / 60) * 100) / 100
}

/**
 * "09:00" and "11:30" -> 150. The other way of saying how long something took.
 *
 * A finish EARLIER than the start ran past midnight, so it wraps rather than going
 * negative — the same rule the job overtime log has used since mig 111. Junk in either box
 * gives 0, because both read straight from an input that can be half-typed.
 */
export function minutesFromSpan(from: string, to: string): number {
  const at = (t: string) => {
    const m = /^([0-9]{1,2}):([0-9]{2})/.exec((t ?? '').trim())
    if (!m) return null
    const mins = Number(m[1]) * 60 + Number(m[2])
    return mins >= 0 && mins < 24 * 60 ? mins : null
  }
  const a = at(from)
  const b = at(to)
  if (a == null || b == null) return 0
  const d = b - a
  return d >= 0 ? d : d + 24 * 60
}

/** Two number inputs (hours, minutes) → one integer. Tolerates blanks and junk, because
 *  it reads straight from text fields. */
export function minutesFromHM(hours: unknown, mins: unknown): number {
  const h = Number(hours)
  const m = Number(mins)
  const total = (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
  return Math.max(0, Math.round(total))
}

/** An integer split back into the two inputs it came from. */
export function hmFromMinutes(total: number): { hours: number; mins: number } {
  const m = Math.max(0, Math.round(total))
  return { hours: Math.floor(m / 60), mins: m % 60 }
}

/** Sum a set of durations. Integer arithmetic throughout — the whole point. */
export function sumMinutes(rows: { minutes?: number | null }[]): number {
  return rows.reduce((s, r) => s + (Number(r.minutes) || 0), 0)
}
