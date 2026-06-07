import { describe, it, expect } from 'vitest'
import { monitoringDates, holdsToPages, holdNumbers } from './periods'

describe('holdsToPages', () => {
  it('keeps 1–6 holds on a single page', () => {
    for (let n = 1; n <= 6; n++) {
      const pages = holdsToPages(n)
      expect(pages).toHaveLength(1)
      expect(pages[0]).toEqual(holdNumbers(n))
    }
  })

  it('splits 7–10 holds per the spec', () => {
    expect(holdsToPages(7)).toEqual([[1, 2, 3, 4], [5, 6, 7]])
    expect(holdsToPages(8)).toEqual([[1, 2, 3, 4], [5, 6, 7, 8]])
    expect(holdsToPages(9)).toEqual([[1, 2, 3, 4, 5], [6, 7, 8, 9]])
    expect(holdsToPages(10)).toEqual([[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]])
  })

  it('every hold appears exactly once across pages', () => {
    for (let n = 1; n <= 10; n++) {
      const flat = holdsToPages(n).flat()
      expect(flat).toEqual(holdNumbers(n))
    }
  })
})

describe('monitoringDates', () => {
  it('returns an inclusive ISO date range', () => {
    expect(monitoringDates('2026-06-07', '2026-06-09')).toEqual(['2026-06-07', '2026-06-08', '2026-06-09'])
  })

  it('returns a single day when start === end', () => {
    expect(monitoringDates('2026-06-07', '2026-06-07')).toEqual(['2026-06-07'])
  })

  it('returns empty for an inverted or invalid range', () => {
    expect(monitoringDates('2026-06-09', '2026-06-07')).toEqual([])
    expect(monitoringDates('', '')).toEqual([])
  })

  it('spans month boundaries', () => {
    expect(monitoringDates('2026-06-29', '2026-07-01')).toEqual(['2026-06-29', '2026-06-30', '2026-07-01'])
  })
})
