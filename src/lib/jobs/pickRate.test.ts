import { describe, it, expect } from 'vitest'
import { pickRate } from './invoicing'

// Rate matching decides what a client is charged, so the precedence rules are
// pinned here. The bug that prompted migration 163: a client with an Initial and a
// Discharge draught rate got whichever row sorted first, so an Initial survey could
// be priced — and annotated — with the Discharge rate, silently.

type R = { id: string; job_type: string | null; job_stage?: string | null }

const initial: R = { id: 'initial', job_type: 'Draught Survey', job_stage: 'Initial' }
const final: R = { id: 'final', job_type: 'Draught Survey', job_stage: 'Final' }
const anyStage: R = { id: 'any-stage', job_type: 'Draught Survey', job_stage: null }
const catchAll: R = { id: 'catch-all', job_type: null, job_stage: null }

const job = (job_type: string | null, job_stage: string | null = null) => ({ job_type, job_stage })

describe('pickRate', () => {
  it('prefers an exact job type + stage match over a stageless one', () => {
    expect(pickRate([anyStage, initial], job('Draught Survey', 'Initial'))?.id).toBe('initial')
  })

  it('picks the stage that matches, not merely the first rate of that type', () => {
    // Declaration order must not decide the price — this is the original bug.
    expect(pickRate([final, initial], job('Draught Survey', 'Initial'))?.id).toBe('initial')
    expect(pickRate([initial, final], job('Draught Survey', 'Final'))?.id).toBe('final')
  })

  it('never applies a stage-tagged rate to a different stage', () => {
    // Falls through to the catch-all rather than charging the Final rate.
    expect(pickRate([final, catchAll], job('Draught Survey', 'Initial'))?.id).toBe('catch-all')
    // With no catch-all there is simply no rate — the line seeds blank for a human.
    expect(pickRate([final], job('Draught Survey', 'Initial'))).toBeNull()
  })

  it('uses a stageless rate when the job has no stage recorded', () => {
    expect(pickRate([anyStage, initial], job('Draught Survey', null))?.id).toBe('any-stage')
  })

  it('does not fall back to a stage-tagged rate for a stageless job', () => {
    expect(pickRate([initial, catchAll], job('Draught Survey', null))?.id).toBe('catch-all')
  })

  it('falls back to the catch-all rate when the job type has none', () => {
    expect(pickRate([anyStage, catchAll], job('Bunker Survey'))?.id).toBe('catch-all')
  })

  it('returns null when nothing matches', () => {
    expect(pickRate([anyStage], job('Bunker Survey'))).toBeNull()
    expect(pickRate([], job('Draught Survey', 'Initial'))).toBeNull()
  })

  it('treats a missing job_stage property the same as null', () => {
    // Rows read before migration 163 have no job_stage key at all.
    const legacy: R = { id: 'legacy', job_type: 'Draught Survey' }
    expect(pickRate([legacy], job('Draught Survey', 'Initial'))?.id).toBe('legacy')
    expect(pickRate([legacy], job('Draught Survey', null))?.id).toBe('legacy')
  })
})
