import { describe, it, expect } from 'vitest'
import { chargeKindLabel, isTimeKind, CHARGE_KIND_SUGGESTIONS } from './chargeKind'

describe('chargeKindLabel', () => {
  it('gives the old four keys their old labels', () => {
    expect(chargeKindLabel('correspondency')).toBe('Correspondency fee')
    expect(chargeKindLabel('third_party')).toBe('Third party / contractor')
    expect(chargeKindLabel('disbursement')).toBe('Disbursement')
    expect(chargeKindLabel('other')).toBe('Other')
  })

  it('leaves typed text exactly as typed', () => {
    expect(chargeKindLabel('Police report fee')).toBe('Police report fee')
    expect(chargeKindLabel('  Diver  ')).toBe('Diver')
  })

  it('never shows an empty label', () => {
    expect(chargeKindLabel('')).toBe('Other')
    expect(chargeKindLabel(null)).toBe('Other')
  })
})

describe('isTimeKind', () => {
  it('catches the things you spend time on', () => {
    for (const k of ['Phone call', 'phone call', 'Email', 'E-mail to owners',
                     'Meeting with surveyor', 'Call-out', 'Site attendance',
                     'WhatsApp discussion', 'Teams conference']) {
      expect(isTimeKind(k), k).toBe(true)
    }
  })

  it('leaves money alone', () => {
    // "Correspondency" contains no time word, and must not: it is a one-off fee.
    for (const k of ['Correspondency fee', 'correspondency', 'Third party / contractor',
                     'Disbursement', 'Launch hire', 'Courier', 'Police report fee', '']) {
      expect(isTimeKind(k), k).toBe(false)
    }
  })

  it('matches whole words only', () => {
    expect(isTimeKind('Recalled documents')).toBe(false)
    expect(isTimeKind('Mailing costs')).toBe(false)
  })

  it('every suggestion classifies the way the list intends', () => {
    const time = CHARGE_KIND_SUGGESTIONS.filter(isTimeKind)
    expect(time).toEqual(['Phone call', 'Email', 'Meeting', 'Site attendance'])
  })
})
