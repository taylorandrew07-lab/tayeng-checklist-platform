import { describe, it, expect } from 'vitest'
import { claimPosition, heldBack, defaultCutoff } from './claim'
import type { CaseAttendance, CaseCharge } from './api'

// The case this pins actually happened: an eight-hour attendance was logged in the evening
// dated the NEXT day, the header counted it as outstanding, and the claim underneath — whose
// cutoff was today — could not see it and said there was nothing to bill. Two numbers, no
// explanation. A cutoff is for holding work back deliberately, never by accident.

const att = (o: Partial<CaseAttendance> = {}): CaseAttendance => ({
  id: 'a1', case_id: 'c', attendee_profile_id: 'p', attendee_name: null, attendee_label: 'Andrew', company: null,
  attended_on: '2026-09-09', start_time: null, end_time: null, minutes: 60,
  description: null, location: null, note: null,
  rate_type: 'hourly', rate_amount: 120, days: null, currency: 'USD',
  charge_amount: 120, claim_id: null, claim_no: null, document_count: 0, ...o,
})

const chg = (o: Partial<CaseCharge> = {}): CaseCharge => ({
  id: 'f1', case_id: 'c', kind: 'Correspondency fee', description: 'Opening of case file',
  payee: null, incurred_on: '2026-09-07', minutes: null, start_time: null, end_time: null,
  qty: 1, unit_amount: 120, currency: 'USD', amount: 120, creator_label: null,
  claim_id: null, claim_no: null, document_count: 0, ...o,
})

describe('heldBack', () => {
  it('names what the cutoff cannot see, and how far it would have to reach', () => {
    const h = heldBack([att({ attended_on: '2026-09-10', charge_amount: 960 })], [chg()], '2026-09-09')
    expect(h.count).toBe(1)
    expect(h.totals).toEqual({ USD: 960 })
    expect(h.latest).toBe('2026-09-10')
  })

  it('is silent when the cutoff covers everything', () => {
    expect(heldBack([att()], [chg()], '2026-09-30')).toEqual({ count: 0, totals: {}, latest: null })
  })

  it('ignores what could not be claimed anyway', () => {
    const later = '2026-09-20'
    const h = heldBack(
      [att({ attended_on: later, rate_amount: null, charge_amount: null })],   // no rate
      [
        chg({ incurred_on: later, claim_id: 'x' }),                            // already claimed
        chg({ id: 'f2', incurred_on: later, minutes: 10, unit_amount: 0, amount: 0 }), // time, no rate
      ],
      '2026-09-09',
    )
    expect(h.count).toBe(0)
  })

  it('keeps currencies apart — nothing here is ever converted', () => {
    const h = heldBack(
      [att({ attended_on: '2026-09-20', currency: 'TTD', charge_amount: 700 })],
      [chg({ incurred_on: '2026-09-21', currency: 'USD', amount: 250, unit_amount: 250 })],
      '2026-09-09',
    )
    expect(h.totals).toEqual({ TTD: 700, USD: 250 })
    expect(h.latest).toBe('2026-09-21')
  })
})

describe('defaultCutoff', () => {
  it('reaches the furthest outstanding entry', () => {
    expect(defaultCutoff([att({ attended_on: '2026-09-10' })], [chg()], '2026-09-09'))
      .toBe('2026-09-10')
  })

  it('is today when everything is already behind us', () => {
    expect(defaultCutoff([att({ attended_on: '2026-08-01' })], [chg()], '2026-09-09'))
      .toBe('2026-09-09')
  })

  it('opens on a bill that holds nothing back', () => {
    const a = [att({ attended_on: '2026-09-10', charge_amount: 960 })]
    const c = [chg()]
    const cutoff = defaultCutoff(a, c, '2026-09-09')
    expect(heldBack(a, c, cutoff).count).toBe(0)
    expect(claimPosition(a, c, cutoff).groups[0].total).toBe(1080)
  })
})
