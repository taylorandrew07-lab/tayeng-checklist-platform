import { describe, it, expect } from 'vitest'
import { byListRowDesc, listRowIsOngoing, listRowLastDateKey, splitVoyagesByJob, type JobsListRow } from './listRow'
import type { VoyageListRow } from '@/lib/cargo/remote'

type Job = { workflow_status?: string | null; scheduled_date?: string | null; end_date?: string | null; created_at?: string | null }

const job = (id: string, j: Job): JobsListRow<Job> => ({ kind: 'job', id, job: j })

function voyage(id: string, v: Partial<VoyageListRow> = {}): JobsListRow<Job> {
  return {
    kind: 'voyage', id,
    voyage: {
      id, vessel_name: 'Channel Pearl', vessel_type: 'M.V.', voyage_number: 'V-047',
      status: 'in_progress', start_date: '2026-08-04', end_date: null,
      surveyor_name: 'Nary Ramjohn', client_name: null, client_color: null,
      job_id: null, job_number: null,
      created_at: '2026-08-04T00:00:00Z', updated_at: '2026-08-10T00:00:00Z',
      ...v,
    },
  }
}

describe('listRowIsOngoing', () => {
  it('treats an unfinalised voyage and an in-progress job alike', () => {
    expect(listRowIsOngoing(voyage('v', { status: 'in_progress' }))).toBe(true)
    expect(listRowIsOngoing(job('j', { workflow_status: 'in_progress' }))).toBe(true)
  })

  it('treats a finalised voyage and a non-in-progress job alike', () => {
    expect(listRowIsOngoing(voyage('v', { status: 'finalized' }))).toBe(false)
    for (const s of ['report_ready', 'invoice_ready', 'closed']) {
      expect(listRowIsOngoing(job('j', { workflow_status: s }))).toBe(false)
    }
  })
})

describe('byListRowDesc', () => {
  it('floats ongoing work above finished work regardless of date', () => {
    // The finished job is far more recent, and still sorts below.
    const finished = job('j1', { workflow_status: 'closed', scheduled_date: '2026-12-01' })
    const running = voyage('v1', { status: 'in_progress', start_date: '2026-01-05', end_date: null })
    expect([finished, running].sort(byListRowDesc)[0].id).toBe('v1')
  })

  it('orders within a group by last day, newest first', () => {
    const older = job('j1', { workflow_status: 'closed', scheduled_date: '2026-03-01' })
    const newer = job('j2', { workflow_status: 'closed', scheduled_date: '2026-06-01' })
    expect([older, newer].sort(byListRowDesc).map(r => r.id)).toEqual(['j2', 'j1'])
  })

  it('uses a job end date over its start, matching the jobs rule', () => {
    const spanning = job('j1', { workflow_status: 'closed', scheduled_date: '2026-01-01', end_date: '2026-09-09' })
    const single = job('j2', { workflow_status: 'closed', scheduled_date: '2026-05-05' })
    expect([single, spanning].sort(byListRowDesc).map(r => r.id)).toEqual(['j1', 'j2'])
  })

  it('sorts an open-ended voyage by today, not by the day it started', () => {
    // Otherwise a voyage that began months ago sinks out of sight while still running.
    //
    // "Today" is the LOCAL calendar day, matching dayKey() and the date the grid
    // actually displays. Comparing against toISOString() (UTC) made this fail
    // every evening between local midnight and UTC midnight — in Trinidad,
    // every day after 8pm.
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    expect(listRowLastDateKey(voyage('v', { start_date: '2020-01-01', end_date: null }))).toBe(today)
  })

  it('is a stable order for equal rows, so paging cannot reshuffle', () => {
    const a = job('a', { workflow_status: 'closed', scheduled_date: '2026-05-05' })
    const b = job('b', { workflow_status: 'closed', scheduled_date: '2026-05-05' })
    expect([b, a].sort(byListRowDesc).map(r => r.id)).toEqual(['a', 'b'])
    expect([a, b].sort(byListRowDesc).map(r => r.id)).toEqual(['a', 'b'])
  })
})

describe('splitVoyagesByJob', () => {
  const v = (id: string, job_id: string | null): VoyageListRow => {
    const row = voyage(id, { job_id })
    if (row.kind !== 'voyage') throw new Error('unreachable')
    return row.voyage
  }

  it('hides a linked voyage behind its job, so one operation is one row', () => {
    const r = splitVoyagesByJob([v('v1', 'job-1')], new Set(['job-1']))
    expect(r.standalone).toEqual([])
    expect(r.byJob.get('job-1')?.map(x => x.id)).toEqual(['v1'])
  })

  it('gives an unlinked voyage its own row', () => {
    const r = splitVoyagesByJob([v('v1', null)], new Set(['job-1']))
    expect(r.standalone.map(x => x.id)).toEqual(['v1'])
    expect(r.byJob.size).toBe(0)
  })

  it('NEVER hides a voyage whose job is not in the list', () => {
    // The job may be invisible through RLS or simply not loaded. Suppressing the
    // voyage then would make it vanish from every screen with no way to reach it.
    const r = splitVoyagesByJob([v('v1', 'job-missing')], new Set(['job-1']))
    expect(r.standalone.map(x => x.id)).toEqual(['v1'])
  })

  it('groups several voyages under one job', () => {
    const r = splitVoyagesByJob([v('v1', 'job-1'), v('v2', 'job-1')], new Set(['job-1']))
    expect(r.byJob.get('job-1')?.map(x => x.id)).toEqual(['v1', 'v2'])
    expect(r.standalone).toEqual([])
  })
})
