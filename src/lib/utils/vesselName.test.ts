import { describe, it, expect } from 'vitest'
import {
  parseVesselName,
  titleCaseVesselName,
  withVesselPrefix,
  prefixForVesselType,
  vesselPrefixForLabel,
} from './index'

describe('parseVesselName — tanker detection', () => {
  // The whole point of the feature: every way a surveyor writes "Motor Tanker".
  it.each([
    'M.T. Lila Montreal',
    'MT Lila Montreal',
    'M/T Lila Montreal',
    'mt lila montreal',
    'm.t. lila montreal',
    'm/t lila montreal',
    'M T Lila Montreal',
    'M.T Lila Montreal',
    'MT. Lila Montreal',
    'M / T Lila Montreal',
  ])('reads %s as a tanker named "Lila Montreal"', input => {
    expect(parseVesselName(input)).toEqual({ prefix: 'M.T.', name: 'Lila Montreal' })
  })

  it.each([
    'M.V. Delta Titan',
    'MV Delta Titan',
    'M/V Delta Titan',
    'mv delta titan',
    'M V Delta Titan',
  ])('reads %s as a motor vessel named "Delta Titan"', input => {
    expect(parseVesselName(input)).toEqual({ prefix: 'M.V.', name: 'Delta Titan' })
  })

  it('reports no prefix when none was typed, so the stored type can win', () => {
    expect(parseVesselName('Delta Titan')).toEqual({ prefix: null, name: 'Delta Titan' })
  })

  it('handles empty / prefix-only input', () => {
    expect(parseVesselName('')).toEqual({ prefix: null, name: '' })
    expect(parseVesselName(null)).toEqual({ prefix: null, name: '' })
    expect(parseVesselName(undefined)).toEqual({ prefix: null, name: '' })
    // "M.T." alone is a prefix with no vessel — detected, but names nothing.
    expect(parseVesselName('M.T. ')).toEqual({ prefix: 'M.T.', name: '' })
  })

  it('takes the type from the FIRST token when a prefix is doubled', () => {
    expect(parseVesselName('M.T. M.T. Test')).toEqual({ prefix: 'M.T.', name: 'Test' })
    expect(parseVesselName('M.V. M.T. Test')).toEqual({ prefix: 'M.V.', name: 'Test' })
  })
})

describe('titleCaseVesselName — the real-word guard survives the slash widening', () => {
  // These are the names the trailing-separator requirement exists to protect.
  // If this block ever fails, the regex has started eating real vessel names.
  it.each([
    ['Mtoto', 'Mtoto'],
    ['Mvuli', 'Mvuli'],
    ['MTOTO', 'Mtoto'],
    ['Mvita', 'Mvita'],
    // No separator after the V/T ⇒ not a prefix, the same rule "MTAlpha" always obeyed.
    ['M/TAlpha', 'M/Talpha'],
    ['MTAlpha', 'Mtalpha'],
  ])('leaves %s intact', (input, expected) => {
    expect(titleCaseVesselName(input)).toBe(expected)
  })

  // KNOWN AMBIGUITY, pre-dating tanker detection: "Mt"/"Mv" followed by a separator
  // is indistinguishable from a typed prefix, so "Mt Everest" has always been stored
  // as "Everest". Recognising bare "MT" as a tanker (an explicit product requirement)
  // means such a name is now also flagged M.T. Fix on the vessel record if it ever
  // bites; requiring dots or a slash would break the requested bare "MT" form.
  it('documents that a bare "Mt <word>" name is read as a prefix', () => {
    expect(titleCaseVesselName('Mt Everest')).toBe('Everest')
    expect(parseVesselName('Mt Everest')).toEqual({ prefix: 'M.T.', name: 'Everest' })
  })

  it('strips every prefix form down to the bare name', () => {
    for (const p of ['M.V.', 'MV', 'M/V', 'M V', 'M.T.', 'MT', 'M/T', 'M T']) {
      expect(titleCaseVesselName(`${p} Delta Titan`)).toBe('Delta Titan')
    }
  })

  it('still title-cases as before', () => {
    expect(titleCaseVesselName('DELTA TITAN')).toBe('Delta Titan')
    expect(titleCaseVesselName('delta emperor')).toBe('Delta Emperor')
    expect(titleCaseVesselName("o'brien")).toBe("O'Brien")
    expect(titleCaseVesselName('delta-titan')).toBe('Delta-Titan')
    expect(titleCaseVesselName('Bonnie D')).toBe('Bonnie D')
  })

  it('returns empty for prefix-only / blank input', () => {
    expect(titleCaseVesselName('')).toBe('')
    expect(titleCaseVesselName('   ')).toBe('')
    expect(titleCaseVesselName('M.V.  ')).toBe('')
  })
})

describe('prefixForVesselType / withVesselPrefix', () => {
  it('defaults to M.V. whenever the type is unknown', () => {
    expect(prefixForVesselType(null)).toBe('M.V.')
    expect(prefixForVesselType(undefined)).toBe('M.V.')
    expect(prefixForVesselType('M.V.')).toBe('M.V.')
    expect(prefixForVesselType('M.T.')).toBe('M.T.')
  })

  it('renders a stored type onto a bare name', () => {
    expect(withVesselPrefix('Lila Montreal', 'M.T.')).toBe('M.T. Lila Montreal')
    expect(withVesselPrefix('Delta Titan', 'M.V.')).toBe('M.V. Delta Titan')
    // Unchanged default — every pre-existing one-arg call site still says M.V.
    expect(withVesselPrefix('Delta Titan')).toBe('M.V. Delta Titan')
    expect(withVesselPrefix('Delta Titan', null)).toBe('M.V. Delta Titan')
  })

  it('never doubles a prefix that is already on the name', () => {
    expect(withVesselPrefix('M.V. Lila Montreal', 'M.T.')).toBe('M.T. Lila Montreal')
    expect(withVesselPrefix('M/T Lila Montreal', 'M.T.')).toBe('M.T. Lila Montreal')
  })

  it('returns empty for empty input', () => {
    expect(withVesselPrefix(null, 'M.T.')).toBe('')
    expect(withVesselPrefix('', 'M.T.')).toBe('')
  })
})

describe('vesselPrefixForLabel — unchanged bunker behaviour', () => {
  it('keeps the bunker vessel a tanker and the surveyed vessel a motor vessel', () => {
    expect(vesselPrefixForLabel('Bunker Vessel Name')).toBe('M.T.')
    expect(vesselPrefixForLabel('Vessel Name')).toBe('M.V.')
    expect(vesselPrefixForLabel('Vessel')).toBe('M.V.')
  })

  it('returns null for non-vessel and descriptor fields — the guard callers rely on', () => {
    expect(vesselPrefixForLabel('Port / Location')).toBeNull()
    expect(vesselPrefixForLabel('Vessel Type')).toBeNull()
    expect(vesselPrefixForLabel('Vessel IMO Number')).toBeNull()
    expect(vesselPrefixForLabel('Vessel Flag')).toBeNull()
  })
})
