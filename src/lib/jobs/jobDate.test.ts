import { describe, it, expect } from 'vitest'
import { jobLastDate, jobLastDateKey, jobSpansDays, byLastDateDesc } from './jobDate'

describe('jobLastDate', () => {
  it('uses the end date when the job spans a range', () => {
    const j = { scheduled_date: '2026-07-12', end_date: '2026-07-19', created_at: '2026-06-01T10:00:00Z' }
    expect(jobLastDate(j)).toBe('2026-07-19')
  })

  it('falls back to the scheduled date on a single-day job', () => {
    expect(jobLastDate({ scheduled_date: '2026-07-12', end_date: null })).toBe('2026-07-12')
  })

  it('never falls back to created_at — that is the caller’s choice', () => {
    expect(jobLastDate({ scheduled_date: null, end_date: null, created_at: '2026-06-01T10:00:00Z' })).toBeNull()
    expect(jobLastDate({})).toBeNull()
  })
})

describe('jobLastDateKey', () => {
  it('normalises a timestamp to its local calendar day so it sorts with plain dates', () => {
    expect(jobLastDateKey({ scheduled_date: '2026-07-19' })).toBe('2026-07-19')
    expect(jobLastDateKey({ created_at: '2026-07-19T14:00:00Z' })).toBe('2026-07-19')
  })

  it('sorts a range job on its end date', () => {
    expect(jobLastDateKey({ scheduled_date: '2026-07-12', end_date: '2026-07-19' })).toBe('2026-07-19')
  })

  it('is an empty string for a dateless job', () => {
    expect(jobLastDateKey({})).toBe('')
  })
})

describe('jobSpansDays', () => {
  it('is true only when start and end are different days', () => {
    expect(jobSpansDays({ scheduled_date: '2026-07-12', end_date: '2026-07-19' })).toBe(true)
    expect(jobSpansDays({ scheduled_date: '2026-07-12', end_date: '2026-07-12' })).toBe(false)
    expect(jobSpansDays({ scheduled_date: '2026-07-12', end_date: null })).toBe(false)
  })
})

describe('byLastDateDesc', () => {
  it('sorts a 12→19 Jul job as 19 Jul, i.e. ahead of a 15 Jul single-day job', () => {
    const range = { scheduled_date: '2026-07-12', end_date: '2026-07-19' }
    const single = { scheduled_date: '2026-07-15', end_date: null }
    expect([single, range].sort(byLastDateDesc)).toEqual([range, single])
  })
})
