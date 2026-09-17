import { describe, it, expect } from 'vitest'
import {
  missingNewJobFields,
  describeMissingNewJobFields,
  type NewJobDraft,
  type NewJobCheck,
} from './newJobChecks'

const base: NewJobDraft = {
  clientId: '', newClientName: '', jobType: 'Draught Survey', jobStage: 'Final',
  vesselName: 'Chaconia', portLocation: '', voyageNumber: '', surveyorIds: [], notes: '',
}

describe('missingNewJobFields', () => {
  it('asks about a job with no client', () => {
    expect(missingNewJobFields(base).map(c => c.key)).toEqual(['client'])
  })

  it('stays quiet once a client is chosen', () => {
    expect(missingNewJobFields({ ...base, clientId: 'c1' })).toEqual([])
  })

  it('treats a requested new client as answered', () => {
    // The admin links the approved client back to the job (mig 155) — asking here
    // would be nagging about a decision already taken.
    expect(missingNewJobFields({ ...base, newClientName: ' Atlantic LNG ' })).toEqual([])
  })

  it('ignores whitespace typed into the new-client box', () => {
    expect(missingNewJobFields({ ...base, newClientName: '   ' }).map(c => c.key)).toEqual(['client'])
  })
})

describe('describeMissingNewJobFields', () => {
  const two: NewJobCheck[] = [
    { key: 'a', label: 'No client has been selected.', filled: () => false },
    { key: 'b', label: 'No voyage number has been entered.', filled: () => false },
  ]

  it('reads one blank field as a plain sentence', () => {
    expect(describeMissingNewJobFields(two.slice(0, 1)))
      .toBe('No client has been selected.\n\nAre you sure you want to create this job?')
  })

  it('bullets several, one per line', () => {
    expect(describeMissingNewJobFields(two))
      .toBe('• No client has been selected.\n• No voyage number has been entered.\n\nAre you sure you want to create this job?')
  })
})
