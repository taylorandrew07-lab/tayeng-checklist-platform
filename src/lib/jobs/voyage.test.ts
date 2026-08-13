import { describe, it, expect } from 'vitest'
import {
  normaliseVoyage, voyageKey, vesselKey, isDraughtStageJob, gapDays,
  groupDraughtVoyages, isRollUp, isBillableAsVoyage, describeGrouping,
  VOYAGE_GAP_DAYS, VOYAGE_SPAN_DAYS, type VoyageJob,
} from './voyage'

// Which draught surveys belong to one voyage decides what the client is charged and
// which jobs get closed. Everything that could silently over- or under-bill is pinned
// here.

let n = 0
const job = (p: Partial<VoyageJob> & { stage?: string | null }): VoyageJob => ({
  id: p.id ?? `j${++n}`,
  job_type: p.job_type !== undefined ? p.job_type : 'Draught Survey',
  job_stage: p.stage !== undefined ? p.stage : (p.job_stage ?? 'Final'),
  vessel_id: p.vessel_id,
  vessel_name: p.vessel_name ?? 'Chaconia',
  client_id: p.client_id !== undefined ? p.client_id : 'client-1',
  voyage_number: p.voyage_number,
  scheduled_date: p.scheduled_date !== undefined ? p.scheduled_date : '2026-08-01',
  end_date: p.end_date,
})

describe('normaliseVoyage — the V-### standard', () => {
  it('canonicalises every way a surveyor types the same voyage', () => {
    for (const raw of ['86', 'V86', 'v86', 'V086', 'v-086', 'V-86', 'V 86', 'voyage 86', 'VOY-086']) {
      expect(normaliseVoyage(raw)).toBe('V-086')
    }
  })

  it('pads to three digits but never TRUNCATES a longer number', () => {
    // SQL's lpad(s, 3, '0') silently returns '120' for '1204'. An unguarded pad here
    // would renumber every voyage above 999 — and match the wrong voyage forever.
    expect(normaliseVoyage('V1204')).toBe('V-1204')
    expect(normaliseVoyage('1204')).toBe('V-1204')
    expect(normaliseVoyage('V-99999')).toBe('V-99999')
  })

  it('keeps an unparseable reference verbatim instead of rejecting it', () => {
    // Entered dockside and offline: refusing to save a job because the voyage is oddly
    // shaped is a worse failure than storing an odd shape. The cargo module's own
    // numbers look like this.
    expect(normaliseVoyage('V-2026-014')).toBe('V-2026-014')
    expect(normaliseVoyage('26/04')).toBe('26/04')
  })

  it('trims, and treats blank as absent', () => {
    expect(normaliseVoyage('  V86  ')).toBe('V-086')
    expect(normaliseVoyage('   ')).toBeNull()
    expect(normaliseVoyage('')).toBeNull()
    expect(normaliseVoyage(null)).toBeNull()
    expect(normaliseVoyage(undefined)).toBeNull()
  })
})

describe('voyageKey — legacy and new spellings must match', () => {
  it('keys a historic V086 and a freshly typed V-086 identically', () => {
    // This is what lets grouping work before every historic row is rewritten.
    expect(voyageKey('V086')).toBe(voyageKey('V-086'))
    expect(voyageKey('86')).toBe(voyageKey('v-86'))
  })

  it('keeps genuinely different voyages apart', () => {
    expect(voyageKey('V-086')).not.toBe(voyageKey('V-087'))
    // Leading zeros are significant only as padding, never as a different voyage.
    expect(voyageKey('V-086')).toBe(voyageKey('V-0086'))
  })

  it('still keys an unparseable reference to itself', () => {
    expect(voyageKey('V-2026-014')).toBe('V2026014')
    expect(voyageKey('V-2026-014')).toBe(voyageKey('v 2026 014'))
  })
})

describe('isDraughtStageJob — the scope gate', () => {
  it('accepts the three draught stages and nothing else', () => {
    expect(isDraughtStageJob({ job_type: 'Draught Survey', job_stage: 'Initial' })).toBe(true)
    expect(isDraughtStageJob({ job_type: 'Draught Survey', job_stage: 'Interim' })).toBe(true)
    expect(isDraughtStageJob({ job_type: 'Draught Survey', job_stage: 'Final' })).toBe(true)
  })

  it('refuses a draught survey with no or an unknown stage', () => {
    // Guessing which leg it is would be guessing what to charge.
    expect(isDraughtStageJob({ job_type: 'Draught Survey', job_stage: null })).toBe(false)
    expect(isDraughtStageJob({ job_type: 'Draught Survey', job_stage: 'Whatever' })).toBe(false)
  })

  it('refuses every other job type, including ones sharing a stage name', () => {
    expect(isDraughtStageJob({ job_type: 'Cargo Survey', job_stage: 'Loading' })).toBe(false)
    expect(isDraughtStageJob({ job_type: 'Cargo Survey', job_stage: 'Initial' })).toBe(false)
    expect(isDraughtStageJob({ job_type: null, job_stage: 'Final' })).toBe(false)
  })
})

describe('vesselKey', () => {
  it('prefers vessel_id', () => {
    expect(vesselKey({ vessel_id: 'abc', vessel_name: 'Chaconia' })).toBe('abc')
  })
  it('falls back to the name — an offline job has no vessel_id until it syncs', () => {
    expect(vesselKey({ vessel_id: null, vessel_name: '  Chaconia ' })).toBe('chaconia')
  })
})

describe('gapDays — measured between ranges', () => {
  it('measures end of the earlier to start of the later', () => {
    const a = job({ scheduled_date: '2026-08-01', end_date: '2026-08-03' })
    const b = job({ scheduled_date: '2026-08-06' })
    expect(gapDays(a, b)).toBe(3)
  })

  it('treats overlap as zero, not as a negative that makes everything adjacent', () => {
    const a = job({ scheduled_date: '2026-08-01', end_date: '2026-08-10' })
    const b = job({ scheduled_date: '2026-08-04' })
    expect(gapDays(a, b)).toBe(0)
  })

  it('is infinite when either job has no date', () => {
    expect(gapDays(job({ scheduled_date: null }), job({}))).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('grouping by voyage number — the confident path', () => {
  it("groups Andrew's Chaconia Initial + Final on V-086", () => {
    const groups = groupDraughtVoyages([
      job({ id: 'i', stage: 'Initial', voyage_number: 'V086', scheduled_date: '2026-08-01' }),
      job({ id: 'f', stage: 'Final', voyage_number: 'V-086', scheduled_date: '2026-08-05' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].confidence).toBe('confident')
    expect(groups[0].voyage).toBe('V-086')
    expect(groups[0].members.map(m => m.id)).toEqual(['i', 'f'])
    expect(groups[0].final?.id).toBe('f')
    expect(isBillableAsVoyage(groups[0])).toBe(true)
    expect(isRollUp(groups[0])).toBe(true)
  })

  it('groups Initial + Interim + Final and orders them by stage', () => {
    const groups = groupDraughtVoyages([
      job({ id: 'f', stage: 'Final', voyage_number: 'V-1', scheduled_date: '2026-08-05' }),
      job({ id: 'i', stage: 'Initial', voyage_number: 'V-1', scheduled_date: '2026-08-01' }),
      job({ id: 'x', stage: 'Interim', voyage_number: 'V-1', scheduled_date: '2026-08-03' }),
    ])
    expect(groups[0].members.map(m => m.id)).toEqual(['i', 'x', 'f'])
  })

  it('ignores the date window entirely when the voyage number agrees', () => {
    // A recorded voyage number is a fact; proximity is only ever a guess.
    const groups = groupDraughtVoyages([
      job({ id: 'i', stage: 'Initial', voyage_number: 'V-9', scheduled_date: '2026-01-01' }),
      job({ id: 'f', stage: 'Final', voyage_number: 'V-9', scheduled_date: '2026-11-01' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].confidence).toBe('confident')
  })

  it('DEMOTES a two-Final voyage to a suggestion and flags it', () => {
    // Two Finals is a data error, not a voyage. It must never bill on its own say-so.
    const groups = groupDraughtVoyages([
      job({ id: 'f1', stage: 'Final', voyage_number: 'V-2' }),
      job({ id: 'f2', stage: 'Final', voyage_number: 'V-2' }),
    ])
    expect(groups[0].confidence).toBe('suggested')
    expect(groups[0].problems).toContain('multiple_finals')
    expect(groups[0].final).toBeNull()
    expect(isBillableAsVoyage(groups[0])).toBe(false)
  })

  it('flags a voyage with no Final rather than billing the legs alone', () => {
    const groups = groupDraughtVoyages([
      job({ id: 'i', stage: 'Initial', voyage_number: 'V-3' }),
      job({ id: 'x', stage: 'Interim', voyage_number: 'V-3' }),
    ])
    expect(groups[0].problems).toEqual(['no_final'])
    expect(isBillableAsVoyage(groups[0])).toBe(false)
  })

  it('never groups the same voyage number across two different vessels', () => {
    const groups = groupDraughtVoyages([
      job({ id: 'a', stage: 'Initial', voyage_number: 'V-4', vessel_name: 'Chaconia' }),
      job({ id: 'b', stage: 'Final', voyage_number: 'V-4', vessel_name: 'Ocean Star' }),
    ])
    expect(groups).toHaveLength(2)
  })

  it('never groups across two different clients — one line cannot have two payers', () => {
    const groups = groupDraughtVoyages([
      job({ id: 'a', stage: 'Initial', voyage_number: 'V-5', client_id: 'c1' }),
      job({ id: 'b', stage: 'Final', voyage_number: 'V-5', client_id: 'c2' }),
    ])
    expect(groups).toHaveLength(2)
  })
})

describe('grouping by date proximity — the suggestion path', () => {
  it("chains Andrew's 1st / 3rd / 5th with no voyage numbers", () => {
    const groups = groupDraughtVoyages([
      job({ id: 'i', stage: 'Initial', scheduled_date: '2026-08-01' }),
      job({ id: 'x', stage: 'Interim', scheduled_date: '2026-08-03' }),
      job({ id: 'f', stage: 'Final', scheduled_date: '2026-08-05' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].confidence).toBe('suggested')
    expect(groups[0].voyage).toBeNull()
    expect(groups[0].members.map(m => m.id)).toEqual(['i', 'x', 'f'])
    expect(isBillableAsVoyage(groups[0])).toBe(true)
  })

  it('does NOT chain across a gap wider than the limit', () => {
    const groups = groupDraughtVoyages([
      job({ id: 'i', stage: 'Initial', scheduled_date: '2026-08-01' }),
      job({ id: 'f', stage: 'Final', scheduled_date: `2026-09-${String(1 + VOYAGE_GAP_DAYS + 5).padStart(2, '0')}` }),
    ])
    expect(groups).toHaveLength(2)
  })

  it('a Final ENDS its chain — the next survey is a new voyage', () => {
    const groups = groupDraughtVoyages([
      job({ id: 'i1', stage: 'Initial', scheduled_date: '2026-08-01' }),
      job({ id: 'f1', stage: 'Final', scheduled_date: '2026-08-03' }),
      job({ id: 'i2', stage: 'Initial', scheduled_date: '2026-08-05' }),
      job({ id: 'f2', stage: 'Final', scheduled_date: '2026-08-07' }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups.map(g => g.members.map(m => m.id))).toEqual([['i1', 'f1'], ['i2', 'f2']])
  })

  it('a second Initial also ends the previous chain, even with no Final between', () => {
    // The vessel has moved on to its next voyage; the first one is simply incomplete.
    const groups = groupDraughtVoyages([
      job({ id: 'i1', stage: 'Initial', scheduled_date: '2026-08-01' }),
      job({ id: 'i2', stage: 'Initial', scheduled_date: '2026-08-03' }),
      job({ id: 'f2', stage: 'Final', scheduled_date: '2026-08-05' }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].members.map(m => m.id)).toEqual(['i1'])
    expect(groups[0].problems).toEqual(['no_final'])
    expect(groups[1].members.map(m => m.id)).toEqual(['i2', 'f2'])
  })

  it('refuses to stretch a chain beyond the maximum voyage span', () => {
    // Each hop is inside the gap limit, but the whole thing is far too long to be one
    // voyage — without this, a busy vessel chains all year into a single group.
    const members = []
    for (let d = 0; d <= VOYAGE_SPAN_DAYS + 20; d += 10) {
      const date = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10)
      members.push(job({ id: `x${d}`, stage: 'Interim', scheduled_date: date }))
    }
    const groups = groupDraughtVoyages(members)
    expect(groups.length).toBeGreaterThan(1)
  })

  it('a lone unnumbered survey is a group of one, not a suggestion', () => {
    const groups = groupDraughtVoyages([job({ id: 'f', stage: 'Final', scheduled_date: '2026-08-01' })])
    expect(groups).toHaveLength(1)
    expect(groups[0].confidence).toBe('confident')
    expect(isRollUp(groups[0])).toBe(false)
  })

  it('groups overlapping multi-day surveys — overlap is strong evidence', () => {
    const groups = groupDraughtVoyages([
      job({ id: 'i', stage: 'Initial', scheduled_date: '2026-08-01', end_date: '2026-08-06' }),
      job({ id: 'f', stage: 'Final', scheduled_date: '2026-08-04', end_date: '2026-08-08' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].members).toHaveLength(2)
  })
})

describe('dates the grouper refuses to guess from', () => {
  it('never uses created_at — a backlog entered in one sitting must not fuse', () => {
    // Ten jobs typed up on one evening share a created_at. If that counted as
    // proximity, ten unrelated voyages would collapse into one suggestion.
    const groups = groupDraughtVoyages([
      { ...job({ id: 'a', stage: 'Initial' }), scheduled_date: null },
      { ...job({ id: 'b', stage: 'Final' }), scheduled_date: null },
    ])
    expect(groups).toHaveLength(2)
    expect(groups.every(g => g.members.length === 1)).toBe(true)
  })

  it('an undated survey can still join by voyage number', () => {
    const groups = groupDraughtVoyages([
      { ...job({ id: 'a', stage: 'Initial', voyage_number: 'V-7' }), scheduled_date: null },
      job({ id: 'b', stage: 'Final', voyage_number: 'V-7' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].members).toHaveLength(2)
  })
})

describe('scope — nothing else is touched', () => {
  it('returns no groups for non-draught jobs', () => {
    const groups = groupDraughtVoyages([
      job({ id: 'c1', job_type: 'Cargo Survey', stage: 'Loading' }),
      job({ id: 'c2', job_type: 'Cargo Survey', stage: 'Discharging' }),
      job({ id: 'u', job_type: 'Ultrasonic Hatch Testing', stage: null }),
    ])
    expect(groups).toHaveLength(0)
  })

  it('leaves a stageless draught survey out of every group', () => {
    const groups = groupDraughtVoyages([
      job({ id: 'i', stage: 'Initial', voyage_number: 'V-8' }),
      job({ id: 'f', stage: 'Final', voyage_number: 'V-8' }),
      job({ id: 'orphan', stage: null, voyage_number: 'V-8' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].members.map(m => m.id)).toEqual(['i', 'f'])
  })
})

describe('describeGrouping', () => {
  it('names the voyage when there is one', () => {
    const groups = groupDraughtVoyages([
      job({ id: 'i', stage: 'Initial', voyage_number: 'V086' }),
      job({ id: 'f', stage: 'Final', voyage_number: 'V086' }),
    ])
    expect(describeGrouping(groups[0])).toBe('Voyage V-086')
  })

  it('explains a date-proximity suggestion in days', () => {
    const groups = groupDraughtVoyages([
      job({ id: 'i', stage: 'Initial', scheduled_date: '2026-08-01' }),
      job({ id: 'f', stage: 'Final', scheduled_date: '2026-08-05' }),
    ])
    expect(describeGrouping(groups[0])).toContain('within 4 days')
    expect(describeGrouping(groups[0])).toContain('no voyage number')
  })
})
