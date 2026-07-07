import { describe, it, expect } from 'vitest'
import { rangesOverlap, composeRange, type JobSchedule } from './conflicts'

const sched = (p: Partial<JobSchedule>): JobSchedule => ({
  scheduled_date: '2026-07-10', end_date: null, start_time: null, end_time: null, ...p,
})

describe('composeRange — date + time → absolute minute range', () => {
  it('treats a time-less job as spanning the whole day (all-day)', () => {
    const r = composeRange(sched({}))
    expect(r.end - r.start).toBe(23 * 60 + 59) // 00:00 → 23:59
  })

  it('spans multiple days when end_date is set', () => {
    const r = composeRange(sched({ end_date: '2026-07-12' }))
    expect(r.end - r.start).toBe(2 * 1440 + 23 * 60 + 59)
  })
})

describe('rangesOverlap — surveyor double-booking', () => {
  it('two all-day jobs on the same day overlap', () => {
    expect(rangesOverlap(sched({}), sched({}))).toBe(true)
  })

  it('same-day jobs at non-overlapping hours do NOT overlap', () => {
    const a = sched({ start_time: '08:00', end_time: '11:00' })
    const b = sched({ start_time: '14:00', end_time: '16:00' })
    expect(rangesOverlap(a, b)).toBe(false)
  })

  it('same-day jobs at overlapping hours overlap', () => {
    const a = sched({ start_time: '08:00', end_time: '12:00' })
    const b = sched({ start_time: '11:00', end_time: '15:00' })
    expect(rangesOverlap(a, b)).toBe(true)
  })

  it('a multi-day job overlaps a single day inside its span', () => {
    const loadout = sched({ scheduled_date: '2026-07-06', end_date: '2026-07-12' })
    const oneDay = sched({ scheduled_date: '2026-07-09' })
    expect(rangesOverlap(loadout, oneDay)).toBe(true)
  })

  it('jobs on different days do not overlap', () => {
    expect(rangesOverlap(sched({ scheduled_date: '2026-07-10' }), sched({ scheduled_date: '2026-07-11' }))).toBe(false)
  })

  it('touching boundaries count as an overlap (inclusive, matches SQL tsrange [])', () => {
    const a = sched({ start_time: '08:00', end_time: '12:00' })
    const b = sched({ start_time: '12:00', end_time: '15:00' })
    expect(rangesOverlap(a, b)).toBe(true)
  })
})
