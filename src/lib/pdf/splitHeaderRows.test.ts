import { describe, it, expect } from 'vitest'
import { splitHeaderRows, type HeaderRow } from './JobPDF'

const rows = (...labels: string[]): HeaderRow[] => labels.map(l => ({ label: l, value: `${l}-value` }))
const labels = (rs: HeaderRow[]) => rs.map(r => r.label)

// Brine's full header: six rows. Fuel/bunker templates have the same shape.
const SIX = rows('Vessel', 'Client', 'Date', 'Surveyor', 'Port', 'Method of Delivery')

describe('splitHeaderRows — default (historic) split', () => {
  it('keeps job-record rows left and checklist-derived rows right', () => {
    const [l, r] = splitHeaderRows(SIX, false)
    expect(labels(l)).toEqual(['Vessel', 'Client', 'Date', 'Surveyor'])
    expect(labels(r)).toEqual(['Port', 'Method of Delivery'])
  })

  it('puts everything left when the template has no right-hand rows', () => {
    const [l, r] = splitHeaderRows(rows('Vessel', 'Client', 'Date'), false)
    expect(labels(l)).toEqual(['Vessel', 'Client', 'Date'])
    expect(r).toEqual([])
  })

  it('handles a bunker header, where Bunker Vessel Name is a right-hand row', () => {
    const [l, r] = splitHeaderRows(
      rows('Vessel', 'Client', 'Date', 'Port', 'Method of Delivery', 'Bunker Vessel Name'), false)
    expect(labels(l)).toEqual(['Vessel', 'Client', 'Date'])
    expect(labels(r)).toEqual(['Port', 'Method of Delivery', 'Bunker Vessel Name'])
  })
})

describe('splitHeaderRows — balanced split (opt-in per template)', () => {
  it('splits six rows evenly, 3 and 3', () => {
    const [l, r] = splitHeaderRows(SIX, true)
    expect(labels(l)).toEqual(['Vessel', 'Client', 'Date'])
    expect(labels(r)).toEqual(['Surveyor', 'Port', 'Method of Delivery'])
  })

  it('puts the extra row on the left for an odd count', () => {
    const [l, r] = splitHeaderRows(rows('a', 'b', 'c', 'd', 'e'), true)
    expect(labels(l)).toEqual(['a', 'b', 'c'])
    expect(labels(r)).toEqual(['d', 'e'])
  })
})

describe('splitHeaderRows — invariants that hold in both modes', () => {
  const cases: HeaderRow[][] = [
    [], rows('Vessel'), rows('Vessel', 'Port'), SIX,
    rows('Vessel', 'Client', 'Date', 'Surveyor', 'Port', 'Method of Delivery', 'Bunker Vessel Name'),
  ]

  it.each([false, true])('partitions the rows exactly (balanced=%s)', (balanced) => {
    for (const input of cases) {
      const [l, r] = splitHeaderRows(input, balanced)
      // Every row appears exactly once, in the original order — nothing dropped or doubled.
      expect(labels([...l, ...r])).toEqual(labels(input))
    }
  })

  it('never returns a right column without a left one', () => {
    for (const balanced of [false, true]) {
      for (const input of cases) {
        const [l, r] = splitHeaderRows(input, balanced)
        if (r.length > 0) expect(l.length).toBeGreaterThan(0)
      }
    }
  })
})
