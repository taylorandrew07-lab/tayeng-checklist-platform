import { describe, it, expect } from 'vitest'
import { voyagePhase, voyageIsOngoing, voyageLastDate, todayKey } from './voyageDate'

const TODAY = '2026-09-07'

describe('voyagePhase', () => {
  it('is finalized on status alone, whatever the dates say', () => {
    expect(voyagePhase({ status: 'finalized', end_date: null }, TODAY)).toBe('finalized')
    expect(voyagePhase({ status: 'finalized', end_date: '2026-12-25' }, TODAY)).toBe('finalized')
  })

  it('is ongoing with no end date — the normal case at sea', () => {
    expect(voyagePhase({ status: 'in_progress', end_date: null }, TODAY)).toBe('ongoing')
    expect(voyagePhase({ status: 'in_progress', end_date: '' }, TODAY)).toBe('ongoing')
    expect(voyagePhase({ status: null, end_date: undefined }, TODAY)).toBe('ongoing')
  })

  it('is completed once the Monitoring End has arrived, finalised or not', () => {
    // Channel Pearl: dated 02 Sep, never finalised, looked at on 07 Sep.
    expect(voyagePhase({ status: 'in_progress', end_date: '2026-09-02' }, TODAY)).toBe('completed')
    // ...and on the end day itself — the owner read it as ended that day.
    expect(voyagePhase({ status: 'in_progress', end_date: '2026-09-07' }, TODAY)).toBe('completed')
  })

  it('treats a future end date as a plan, so the voyage is still ongoing', () => {
    expect(voyagePhase({ status: 'in_progress', end_date: '2026-09-08' }, TODAY)).toBe('ongoing')
  })

  it('reads a timestamp end date by its calendar day', () => {
    expect(voyagePhase({ status: 'in_progress', end_date: '2026-09-07T23:59:00' }, TODAY)).toBe('completed')
  })
})

describe('voyageIsOngoing', () => {
  it('is the inverse of completed-or-finalised', () => {
    expect(voyageIsOngoing({ status: 'in_progress', end_date: null }, TODAY)).toBe(true)
    expect(voyageIsOngoing({ status: 'in_progress', end_date: '2026-09-09' }, TODAY)).toBe(true)
    expect(voyageIsOngoing({ status: 'in_progress', end_date: '2026-09-02' }, TODAY)).toBe(false)
    expect(voyageIsOngoing({ status: 'finalized', end_date: null }, TODAY)).toBe(false)
  })
})

describe('voyageLastDate', () => {
  it('is the end date once set, otherwise never earlier than today', () => {
    expect(voyageLastDate({ start_date: '2026-08-04', end_date: '2026-09-02' })).toBe('2026-09-02')
    const open = voyageLastDate({ start_date: '2026-08-22', end_date: null })!
    expect(open >= '2026-08-22').toBe(true)
  })
})

describe('todayKey', () => {
  // Trinidad is UTC-4 with no DST. Vercel runs in UTC, so a host-local answer
  // would roll over to tomorrow at 20:00 Trinidad time and call a voyage
  // completed a day early every evening.
  it('gives the Trinidad day, not the host day', () => {
    // 2026-09-08 01:30 UTC is still 2026-09-07 21:30 in Trinidad.
    expect(todayKey(new Date('2026-09-08T01:30:00Z'))).toBe('2026-09-07')
    // 2026-09-08 04:30 UTC is 00:30 on the 8th in Trinidad.
    expect(todayKey(new Date('2026-09-08T04:30:00Z'))).toBe('2026-09-08')
  })

  it('makes voyagePhase flip on the Trinidad day boundary', () => {
    const v = { status: 'in_progress', end_date: '2026-09-08' }
    expect(voyagePhase(v, todayKey(new Date('2026-09-08T01:30:00Z')))).toBe('ongoing')
    expect(voyagePhase(v, todayKey(new Date('2026-09-08T04:30:00Z')))).toBe('completed')
  })
})
