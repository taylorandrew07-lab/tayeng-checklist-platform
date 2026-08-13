import { describe, it, expect } from 'vitest'
import { suggestVoyageFor, suggestedValue, describeSuggestion, SUGGEST_WITHIN_DAYS, type RecentVoyage } from './recentVoyages'
import { splitVoyageFromVesselName, vesselWithVoyage } from '@/lib/utils'

// The ghost suggestion exists so surveyors stop having to remember voyage numbers —
// only 2 of the 30 draught surveys on the system carried one when this was built. But a
// suggestion that is wrong and gets accepted out of habit bills a survey onto a voyage
// that closed weeks ago, so the staleness rule matters more than the convenience.

const recent = (p: Partial<RecentVoyage> = {}): RecentVoyage => ({
  vessel_key: p.vessel_key ?? 'chaconia',
  vessel_name: p.vessel_name ?? 'Chaconia',
  voyage_number: p.voyage_number ?? 'V-086',
  job_stage: p.job_stage !== undefined ? p.job_stage : 'Initial',
  scheduled_date: p.scheduled_date !== undefined ? p.scheduled_date : '2026-08-11',
})

describe('suggestVoyageFor', () => {
  it('offers the vessel’s last voyage', () => {
    const hit = suggestVoyageFor('Chaconia', [recent()], '2026-08-13')
    expect(hit?.voyage_number).toBe('V-086')
  })

  it('matches the vessel case- and whitespace-insensitively', () => {
    expect(suggestVoyageFor('  chaconia ', [recent()], '2026-08-13')).not.toBeNull()
    expect(suggestVoyageFor('CHACONIA', [recent()], '2026-08-13')).not.toBeNull()
  })

  it('offers nothing for a vessel with no recent voyage', () => {
    expect(suggestVoyageFor('Ocean Star', [recent()], '2026-08-13')).toBeNull()
  })

  it('offers nothing for an empty vessel name', () => {
    expect(suggestVoyageFor('', [recent()], '2026-08-13')).toBeNull()
    expect(suggestVoyageFor(null, [recent()], '2026-08-13')).toBeNull()
  })

  it('REFUSES a stale voyage — the vessel has moved on', () => {
    // Accepting a months-old number out of habit is exactly the mis-stamping the
    // voyage field exists to prevent. No suggestion beats a wrong one.
    const old = recent({ scheduled_date: '2026-01-01' })
    expect(suggestVoyageFor('Chaconia', [old], '2026-08-13')).toBeNull()
  })

  it('offers a voyage right at the edge of the window but not past it', () => {
    const day = (offset: number) =>
      new Date(Date.UTC(2026, 7, 13) - offset * 86_400_000).toISOString().slice(0, 10)
    expect(suggestVoyageFor('Chaconia', [recent({ scheduled_date: day(SUGGEST_WITHIN_DAYS) })], '2026-08-13')).not.toBeNull()
    expect(suggestVoyageFor('Chaconia', [recent({ scheduled_date: day(SUGGEST_WITHIN_DAYS + 1) })], '2026-08-13')).toBeNull()
  })

  it('still offers a voyage with no date rather than nothing', () => {
    expect(suggestVoyageFor('Chaconia', [recent({ scheduled_date: null })], '2026-08-13')?.voyage_number).toBe('V-086')
  })
})

describe('suggestedValue — what accepting actually stores', () => {
  it('canonicalises a legacy number on the way in', () => {
    expect(suggestedValue(recent({ voyage_number: 'V086' }))).toBe('V-086')
  })
  it('is empty when there is no suggestion', () => {
    expect(suggestedValue(null)).toBe('')
  })
})

describe('describeSuggestion — why this number is being offered', () => {
  const fmt = (d: string) => d
  it('names the stage it came from, so a Final reads differently from an Initial', () => {
    expect(describeSuggestion(recent({ job_stage: 'Initial' }), fmt)).toBe('from Initial, 2026-08-11')
  })
  it('copes with a missing stage', () => {
    expect(describeSuggestion(recent({ job_stage: null, scheduled_date: null }), fmt)).toBe('last used')
  })
})

describe('splitVoyageFromVesselName — the guard that stops the old habit', () => {
  it('lifts a typed voyage out of the vessel name', () => {
    expect(splitVoyageFromVesselName('Chaconia (V086)')).toEqual({ name: 'Chaconia', voyage: 'V086' })
    expect(splitVoyageFromVesselName('Chaconia (V-086)')).toEqual({ name: 'Chaconia', voyage: 'V-086' })
  })

  it('leaves an ordinary vessel name completely alone', () => {
    expect(splitVoyageFromVesselName('Chaconia')).toEqual({ name: 'Chaconia', voyage: null })
    expect(splitVoyageFromVesselName('M.V. Ocean Star')).toEqual({ name: 'M.V. Ocean Star', voyage: null })
  })

  it('does not mistake other parentheticals for a voyage', () => {
    // These are the false positives that would silently rename vessels.
    for (const name of ['Chaconia (Final)', 'Chaconia (Hull 4)', 'Ocean Star 7', 'Delta (Tug)']) {
      expect(splitVoyageFromVesselName(name).voyage).toBeNull()
      expect(splitVoyageFromVesselName(name).name).toBe(name)
    }
  })

  it('only matches a voyage at the END of the name', () => {
    expect(splitVoyageFromVesselName('(V086) Chaconia').voyage).toBeNull()
  })

  it('handles empty input', () => {
    expect(splitVoyageFromVesselName('')).toEqual({ name: '', voyage: null })
    expect(splitVoyageFromVesselName(null)).toEqual({ name: '', voyage: null })
  })
})

describe('vesselWithVoyage — one-line display', () => {
  it('renders the voyage beside the prefixed name', () => {
    expect(vesselWithVoyage('Chaconia', 'M.V.', 'V-086')).toBe('M.V. Chaconia (V-086)')
  })
  it('falls back to just the vessel when there is no voyage', () => {
    expect(vesselWithVoyage('Chaconia', 'M.V.', null)).toBe('M.V. Chaconia')
    expect(vesselWithVoyage('Chaconia', 'M.T.', '  ')).toBe('M.T. Chaconia')
  })
  it('is empty for an empty vessel', () => {
    expect(vesselWithVoyage('', 'M.V.', 'V-086')).toBe('')
  })
})
