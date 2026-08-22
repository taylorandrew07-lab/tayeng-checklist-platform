import { describe, it, expect } from 'vitest'
import {
  applyCorrections, staleCorrections, correctRow, readingKey, parseReadingKey,
  CORRECTABLE_FIELDS, type CorrectionPatch,
} from './corrections'
import type { Voyage } from './types'

function voyage(): Voyage {
  return {
    id: 'v1', userId: 'nary',
    vesselName: 'Trinidad Pearl', vesselType: 'M.V.', voyageNumber: '13',
    cargoType: 'DRI - B', loadingPort: 'Point Lisas', dischargePort: 'Darrow',
    startDate: '2026-08-04', endDate: '', holdCount: 5, surveyorName: 'Nary Ramjohn',
    readingTypes: [], periodMeta: {},
    readings: {
      '2026-08-04': { '0600': { '1': { temp: { p1: '41.2', p2: '43.8' } } } },
    },
    createdAt: 0, updatedAt: 1000,
  } as Voyage
}

const entry = (value: string, from: string) => ({ value, from, at: '2026-08-22T10:00:00Z', by: 'andrew' })

describe('applyCorrections', () => {
  it('returns the voyage untouched when there is no patch', () => {
    const v = voyage()
    expect(applyCorrections(v, null)).toBe(v)
    expect(applyCorrections(v, {})).toBe(v)
    expect(applyCorrections(v, { fields: {}, readings: {} })).toBe(v)
  })

  it('lays corrected identity over the document', () => {
    const out = applyCorrections(voyage(), {
      fields: { vesselName: entry('Trinidad Pearl II', 'Trinidad Pearl'), voyageNumber: entry('V-013', '13') },
    })
    expect(out.vesselName).toBe('Trinidad Pearl II')
    expect(out.voyageNumber).toBe('V-013')
    expect(out.cargoType).toBe('DRI - B')   // untouched fields survive
  })

  it('coerces a numeric field back to a number', () => {
    const out = applyCorrections(voyage(), { fields: { holdCount: entry('4', '5') } })
    expect(out.holdCount).toBe(4)
    expect(typeof out.holdCount).toBe('number')
  })

  it('ignores a field that is not on the allow-list', () => {
    // clientId governs which client may READ the voyage through RLS. A patch
    // cannot change an access decision, so accepting it here would show the new
    // client while the old one kept the access.
    const out = applyCorrections(voyage(), { fields: { clientId: entry('other', 'x') } as never })
    expect((out as unknown as Record<string, unknown>).clientId).toBeUndefined()
    expect(CORRECTABLE_FIELDS).not.toContain('clientId' as never)
    expect(CORRECTABLE_FIELDS).not.toContain('status' as never)
  })

  it('overrides one reading without disturbing its neighbours', () => {
    const out = applyCorrections(voyage(), {
      readings: { [readingKey('2026-08-04', '0600', 1, 'temp', 'p1')]: entry('45.0', '41.2') },
    })
    expect(out.readings['2026-08-04']['0600']['1'].temp.p1).toBe('45.0')
    expect(out.readings['2026-08-04']['0600']['1'].temp.p2).toBe('43.8')
  })

  it('creates the path for a reading the surveyor never entered', () => {
    const out = applyCorrections(voyage(), {
      readings: { [readingKey('2026-08-09', '1800', 3, 'temp', 'p1')]: entry('50.1', '') },
    })
    expect(out.readings['2026-08-09']['1800']['3'].temp.p1).toBe('50.1')
  })

  it('NEVER mutates the voyage it is given', () => {
    // It runs over the object the workspace holds in state. A mutation here
    // would be persisted and pushed as a change the surveyor never made.
    const v = voyage()
    const before = JSON.stringify(v)
    applyCorrections(v, {
      fields: { vesselName: entry('Changed', 'Trinidad Pearl') },
      readings: { [readingKey('2026-08-04', '0600', 1, 'temp', 'p1')]: entry('99.9', '41.2') },
    })
    expect(JSON.stringify(v)).toBe(before)
  })
})

describe('staleCorrections', () => {
  it('flags a correction the surveyor has since overtaken', () => {
    const patch: CorrectionPatch = {
      fields: {
        vesselName: entry('Trinidad Pearl II', 'Trinidad Pearl'),   // doc still matches
        voyageNumber: entry('V-013', '11'),                          // doc now says 13
      },
    }
    expect(staleCorrections(voyage(), patch)).toEqual(['voyageNumber'])
  })

  it('is empty when nothing has moved', () => {
    expect(staleCorrections(voyage(), { fields: { vesselName: entry('X', 'Trinidad Pearl') } })).toEqual([])
    expect(staleCorrections(voyage(), null)).toEqual([])
  })
})

describe('correctRow', () => {
  it('overlays identity on a list row, which reads columns not the document', () => {
    const row = { id: 'v1', vessel_name: 'Trinidad Pearl', voyage_number: '13' }
    const out = correctRow(row, { fields: { vesselName: entry('Trinidad Pearl II', 'Trinidad Pearl') } })
    expect(out.vessel_name).toBe('Trinidad Pearl II')
    expect(out.voyage_number).toBe('13')
    expect(row.vessel_name).toBe('Trinidad Pearl')  // input untouched
  })
})

describe('readingKey', () => {
  it('round-trips', () => {
    const k = readingKey('2026-08-04', '0600', 2, 'temp', 'tc7')
    expect(parseReadingKey(k)).toEqual({ dateISO: '2026-08-04', period: '0600', hold: '2', typeId: 'temp', pointId: 'tc7' })
  })
  it('rejects anything that is not one', () => {
    expect(parseReadingKey('nonsense')).toBeNull()
  })
})
