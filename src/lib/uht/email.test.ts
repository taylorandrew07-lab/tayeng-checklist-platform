import { describe, it, expect } from 'vitest'
import { generateUhtEmail, holdList, formatLongDate, formatTime } from './email'
import { UHT_DETAILS, UHT_ROUNDS } from './fields'

// Helper: build a job_field_values map from a compact round spec.
type RoundSpec = { date?: string; start?: string; end?: string; pass?: number[]; fail?: number[]; bilges?: 'yes' | 'no'; furtherRetest?: boolean }
function values(holds: number, hatches: number, rounds: Partial<Record<'initial' | 'retest1' | 'retest2' | 'retest3', RoundSpec>>, location?: string) {
  const v: Record<string, string> = { [UHT_DETAILS.holds]: String(holds), [UHT_DETAILS.hatches]: String(hatches) }
  if (location) v[UHT_DETAILS.location] = location
  for (const r of UHT_ROUNDS) {
    const spec = rounds[r.key]
    if (!spec) continue
    if (spec.date) v[r.date] = spec.date
    if (spec.start) v[r.start] = spec.start
    if (spec.end) v[r.end] = spec.end
    // Holds + bilges are 'pass_fail' fields (stored 'pass'/'fail'); re-test toggle is yes_no.
    for (const h of spec.pass ?? []) v[r.holds[h - 1]] = 'pass'
    for (const h of spec.fail ?? []) v[r.holds[h - 1]] = 'fail'
    if (spec.bilges) v[r.bilges] = spec.bilges === 'yes' ? 'pass' : 'fail'
    if (spec.furtherRetest && r.retestRequired) v[r.retestRequired] = 'yes'
  }
  return v
}

describe('UHT helpers', () => {
  it('hold-list grammar', () => {
    expect(holdList([1])).toBe('1')
    expect(holdList([1, 4])).toBe('1 and 4')
    expect(holdList([1, 2, 3, 4, 5])).toBe('1, 2, 3, 4, 5')
  })
  it('long date (weekday + ordinal)', () => {
    expect(formatLongDate('2026-06-19')).toBe('Friday 19th June 2026')
    expect(formatLongDate('2026-05-14')).toBe('Thursday 14th May 2026')
    expect(formatLongDate('2026-04-02')).toBe('Thursday 2nd April 2026')
  })
  it('time formatting', () => {
    expect(formatTime('07:45')).toBe('0745 hrs')
    expect(formatTime('09:15')).toBe('0915 hrs')
    expect(formatTime('')).toBe('')
  })
})

describe('generateUhtEmail — acceptance cases', () => {
  it('1. Channel Pearl / Nu Iron — 5 holds all pass (matches 19.06.26 sample)', () => {
    const r = generateUhtEmail({
      vesselName: 'Channel Pearl', clientName: 'Nu Iron',
      values: values(5, 5, { initial: { date: '2026-06-19', start: '07:45', end: '09:15', pass: [1, 2, 3, 4, 5], bilges: 'yes' } }, 'Point Lisas anchorage'),
    })
    expect(r.body).toBe(
      'Ultrasonic testing was conducted on 5 holds, 5 hatches from 0745 hrs to 0915 hrs on Friday 19th June 2026 on behalf of Nu Iron at Point Lisas anchorage.\n\n' +
      'Holds 1, 2, 3, 4, 5 passed ultrasonic testing.\n\n' +
      'Bilges clean and dry.'
    )
    expect(r.status).toBe('passed')
  })

  it('2. 4 holds — 2 & 3 pass, 1 & 4 fail (matches failed-holds sample; stays open)', () => {
    const r = generateUhtEmail({
      vesselName: 'Some Vessel', clientName: 'Nu Iron',
      values: values(4, 4, { initial: { date: '2026-05-14', start: '05:30', end: '07:00', pass: [2, 3], fail: [1, 4], bilges: 'yes' } }),
    })
    expect(r.body).toBe(
      'Ultrasonic testing was conducted on 4 holds, 4 hatches from 0530 hrs to 0700 hrs on Thursday 14th May 2026 on behalf of Nu Iron at Point Lisas anchorage.\n\n' +
      'Holds 2 and 3 passed ultrasonic testing.\n\n' +
      'Holds 1 and 4 failed ultrasonic testing.\n\n' +
      'Bilges clean and dry.'
    )
    expect(r.status).toBe('open')
  })

  it('3. Lake Pearl — 3 holds, 1/4/5 pass', () => {
    const r = generateUhtEmail({
      vesselName: 'Lake Pearl', clientName: 'Nu Iron',
      values: values(3, 3, { initial: { date: '2026-05-14', start: '11:00', end: '12:15', pass: [1, 4, 5], bilges: 'yes' } }),
    })
    expect(r.body).toContain('Ultrasonic testing was conducted on 3 holds, 3 hatches from 1100 hrs to 1215 hrs on Thursday 14th May 2026 on behalf of Nu Iron at Point Lisas anchorage.')
    expect(r.body).toContain('Holds 1, 4, 5 passed ultrasonic testing.')
    expect(r.status).toBe('passed')
  })

  it('4. Poland Pearl — 5 holds pass, 2 Apr', () => {
    const r = generateUhtEmail({
      vesselName: 'Poland Pearl', clientName: 'Nu Iron',
      values: values(5, 5, { initial: { date: '2026-04-02', start: '09:10', end: '10:45', pass: [1, 2, 3, 4, 5], bilges: 'yes' } }),
    })
    expect(r.body).toContain('on Thursday 2nd April 2026 on behalf of Nu Iron at Point Lisas anchorage.')
    expect(r.body).toContain('Holds 1, 2, 3, 4, 5 passed ultrasonic testing.')
    expect(r.status).toBe('passed')
  })

  it('5. Initial fails 1 & 4, then Re-test 1 passes them — both visits on one job, ends passed', () => {
    const r = generateUhtEmail({
      vesselName: 'Channel Pearl', clientName: 'Nu Iron',
      values: values(4, 4, {
        initial: { date: '2026-05-14', start: '05:30', end: '07:00', pass: [2, 3], fail: [1, 4], bilges: 'yes', furtherRetest: true },
        retest1: { date: '2026-05-16', start: '08:00', end: '09:00', pass: [1, 4], bilges: 'yes' },
      }),
    })
    // both visit dates/times present
    expect(r.body).toContain('Thursday 14th May 2026')
    expect(r.body).toContain('Saturday 16th May 2026')
    // initial failures shown, then re-test paragraph
    expect(r.body).toContain('Holds 1 and 4 failed ultrasonic testing.')
    expect(r.body).toContain('Re-test conducted on holds 1 and 4 from 0800 hrs to 0900 hrs on Saturday 16th May 2026.')
    expect(r.body).toContain('Holds 1 and 4 passed ultrasonic testing.')
    expect(r.rounds).toHaveLength(2)
    expect(r.status).toBe('passed')
  })

  it('empty job → empty status, no body', () => {
    const r = generateUhtEmail({ vesselName: 'X', clientName: 'Y', values: values(5, 5, {}) })
    expect(r.status).toBe('empty')
    expect(r.body).toBe('')
  })
})
