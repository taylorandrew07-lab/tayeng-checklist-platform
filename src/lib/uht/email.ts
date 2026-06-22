// Email-summary generator for the Ultrasonic Hatch Testing job. Reads a job's
// field values (keyed by the FIXED ids in ./fields.ts) + the vessel/client from the
// job record, and produces the plain-text summary the team already sends by hand.
// Pure + deterministic so it's unit-tested against real samples (./email.test.ts).

import { UHT_DETAILS, UHT_ROUNDS, type UhtRound } from './fields'

export interface UhtInput {
  vesselName?: string | null
  clientName?: string | null
  /** job_field_values flattened to { field_id: value } (yes_no may carry '|||remarks'). */
  values: Record<string, string>
}

export interface UhtRoundResult {
  key: UhtRound['key']
  label: string
  date: string          // raw ISO 'YYYY-MM-DD'
  start: string         // raw 'HH:MM'
  end: string
  tested: number[]      // hold numbers with a pass/fail answer
  passed: number[]
  failed: number[]
  bilges: 'pass' | 'fail' | ''
}

export interface UhtResult {
  status: 'passed' | 'open' | 'empty'
  subject: string
  /** The summary body, matching the team's format. */
  body: string
  rounds: UhtRoundResult[]
  holds: number
  hatches: number
  location: string
  client: string | null
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function ordinal(d: number): string {
  if (d >= 11 && d <= 13) return `${d}th`
  switch (d % 10) { case 1: return `${d}st`; case 2: return `${d}nd`; case 3: return `${d}rd`; default: return `${d}th` }
}

/** 'YYYY-MM-DD' -> 'Friday 19th June 2026' (empty string if unparseable). */
export function formatLongDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso || '').trim())
  if (!m) return ''
  const y = +m[1], mo = +m[2], d = +m[3]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (isNaN(dt.getTime())) return ''
  return `${WEEKDAYS[dt.getUTCDay()]} ${ordinal(d)} ${MONTHS[mo - 1]} ${y}`
}

/** 'HH:MM' (or 'HHMM') -> '0745 hrs' (empty string if no time). */
export function formatTime(v: string): string {
  const digits = (v || '').replace(/\D/g, '')
  if (!digits) return ''
  return `${digits.slice(0, 4).padStart(4, '0')} hrs`
}

/** [1] -> "1"; [1,4] -> "1 and 4"; [1,2,3,4,5] -> "1, 2, 3, 4, 5". */
export function holdList(nums: number[]): string {
  if (nums.length === 0) return ''
  if (nums.length === 1) return String(nums[0])
  if (nums.length === 2) return `${nums[0]} and ${nums[1]}`
  return nums.join(', ')
}

const answer = (raw: string | undefined): string => (raw ?? '').split('|||')[0].trim().toLowerCase()
const num = (raw: string | undefined): number => { const n = parseInt((raw ?? '').trim(), 10); return Number.isFinite(n) ? n : 0 }
// Holds/bilges use a 'pass_fail' field (values 'pass'/'fail'); accept legacy 'yes'/'no' too.
const isPass = (a: string): boolean => a === 'pass' || a === 'yes'
const isFail = (a: string): boolean => a === 'fail' || a === 'no'

function summarizeRound(round: UhtRound, values: Record<string, string>): UhtRoundResult | null {
  const date = (values[round.date] ?? '').trim()
  const start = (values[round.start] ?? '').trim()
  const end = (values[round.end] ?? '').trim()
  const passed: number[] = [], failed: number[] = []
  round.holds.forEach((fid, i) => {
    const a = answer(values[fid])
    if (isPass(a)) passed.push(i + 1)
    else if (isFail(a)) failed.push(i + 1)
  })
  const tested = [...passed, ...failed].sort((a, b) => a - b)
  // A round "happened" only if it has a date or any tested hold (so blank re-tests are ignored).
  if (!date && tested.length === 0) return null
  const b = answer(values[round.bilges])
  const bilges: UhtRoundResult['bilges'] = isPass(b) ? 'pass' : isFail(b) ? 'fail' : ''
  return { key: round.key, label: round.label, date, start, end, tested, passed, failed, bilges }
}

function roundParagraphs(r: UhtRoundResult, ctx: { holds: number; hatches: number; client: string | null; location: string }): string[] {
  const paras: string[] = []
  const when = formatLongDate(r.date)
  const time = r.start && r.end ? ` from ${formatTime(r.start)} to ${formatTime(r.end)}` : ''
  if (r.key === 'initial') {
    const holdsWord = `${ctx.holds} hold${ctx.holds === 1 ? '' : 's'}`
    const hatchesWord = `${ctx.hatches} hatch${ctx.hatches === 1 ? '' : 'es'}`
    const behalf = ctx.client ? ` on behalf of ${ctx.client}` : ''
    paras.push(`Ultrasonic testing was conducted on ${holdsWord}, ${hatchesWord}${time}${when ? ` on ${when}` : ''}${behalf} at ${ctx.location}.`)
  } else {
    paras.push(`Re-test conducted on hold${r.tested.length === 1 ? '' : 's'} ${holdList(r.tested)}${time}${when ? ` on ${when}` : ''}.`)
  }
  if (r.passed.length) paras.push(`Hold${r.passed.length === 1 ? '' : 's'} ${holdList(r.passed)} passed ultrasonic testing.`)
  if (r.failed.length) paras.push(`Hold${r.failed.length === 1 ? '' : 's'} ${holdList(r.failed)} failed ultrasonic testing.`)
  if (r.bilges === 'pass') paras.push('Bilges clean and dry.')
  else if (r.bilges === 'fail') paras.push('Bilges were not clean and dry.')
  return paras
}

export function generateUhtEmail(input: UhtInput): UhtResult {
  const v = input.values
  const holds = num(v[UHT_DETAILS.holds])
  const hatches = num(v[UHT_DETAILS.hatches])
  const location = (v[UHT_DETAILS.location] ?? '').trim() || 'Point Lisas anchorage'
  const client = (input.clientName ?? '').trim() || null
  const vessel = (input.vesselName ?? '').trim() || null

  const rounds = UHT_ROUNDS.map(r => summarizeRound(r, v)).filter((r): r is UhtRoundResult => r !== null)

  const ctx = { holds, hatches, client, location }
  const body = rounds.flatMap(r => roundParagraphs(r, ctx)).join('\n\n')

  // Derived status: passed when the latest round that happened has tested holds, none
  // failed, and bilges aren't recorded as not-clean. Otherwise still open.
  let status: UhtResult['status'] = 'empty'
  if (rounds.length) {
    const last = rounds[rounds.length - 1]
    status = (last.tested.length > 0 && last.failed.length === 0 && last.bilges !== 'fail') ? 'passed' : 'open'
  }

  const subject = `Ultrasonic Hatch Testing${vessel ? ` — ${vessel}` : ''}`
  return { status, subject, body, rounds, holds, hatches, location, client }
}
