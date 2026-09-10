import { describe, it, expect } from 'vitest'
import { caseTitle, isCaseNameable, UNTITLED_CASE } from './title'

describe('caseTitle', () => {
  it('names the matter from its parts', () => {
    expect(caseTitle({ our_vessel: 'Ocean Sun', our_vessel_type: 'M.V.', case_type: 'Collision', other_party: 'Atlantic Star' }))
      .toBe('Collision — M.V. Ocean Sun v. Atlantic Star')
  })

  it('drops each part cleanly when it is absent', () => {
    expect(caseTitle({ our_vessel: 'Ocean Sun', case_type: 'Collision' })).toBe('Collision — M.V. Ocean Sun')
    expect(caseTitle({ our_vessel: 'Ocean Sun' })).toBe('M.V. Ocean Sun')
    expect(caseTitle({ case_type: 'Collision', other_party: 'Atlantic Star' })).toBe('Collision — Atlantic Star')
    expect(caseTitle({ case_type: 'Medical' })).toBe('Medical')
    expect(caseTitle({ other_party: 'J. Smith' })).toBe('J. Smith')
  })

  it('puts the two parties against each other, ours first', () => {
    // The point of the ordering: "Collision v. F.V. Gulf Rambler" reads as the
    // COLLISION being versus the other vessel. The "v." belongs between the parties.
    expect(caseTitle({ our_vessel: 'Ocean Sun', other_party: 'Atlantic Star' }))
      .toBe('M.V. Ocean Sun v. Atlantic Star')
    expect(caseTitle({ our_vessel: 'Ocean Sun', our_vessel_type: 'M.T.', case_type: 'Collision', other_party: 'F.V. Gulf Rambler' }))
      .toBe('Collision — M.T. Ocean Sun v. F.V. Gulf Rambler')
  })

  it('carries the tanker prefix through, and defaults to M.V. like everywhere else', () => {
    expect(caseTitle({ our_vessel: 'Ocean Sun', our_vessel_type: 'M.T.' })).toBe('M.T. Ocean Sun')
    expect(caseTitle({ our_vessel: 'Ocean Sun', our_vessel_type: null })).toBe('M.V. Ocean Sun')
  })

  it('title-cases the vessel the way the rest of the app does', () => {
    expect(caseTitle({ our_vessel: 'OCEAN SUN', case_type: 'Grounding' })).toBe('Grounding — M.V. Ocean Sun')
  })

  it('falls back to a legacy typed title only when nothing derives', () => {
    // A case migrated off the job model (mig 213) has its name here and NULL parts.
    expect(caseTitle({ title: 'Collision' })).toBe('Collision')
    // ...and the moment it has real parts, they win — the stored name is not a
    // second opinion, it is a stand-in for having no parts at all.
    expect(caseTitle({ title: 'Collision', our_vessel: 'Ocean Sun', case_type: 'Allision' }))
      .toBe('Allision — M.V. Ocean Sun')
  })

  it('is never empty', () => {
    expect(caseTitle({})).toBe(UNTITLED_CASE)
    expect(caseTitle({ our_vessel: '  ', case_type: '', other_party: null, title: '   ' })).toBe(UNTITLED_CASE)
  })

  it('trims what was typed', () => {
    expect(caseTitle({ our_vessel: '  Ocean Sun  ', case_type: '  Collision  ' })).toBe('Collision — M.V. Ocean Sun')
  })
})

describe('isCaseNameable', () => {
  it('is what the New Case form requires instead of a title box', () => {
    expect(isCaseNameable({ our_vessel: 'Ocean Sun' })).toBe(true)
    expect(isCaseNameable({ case_type: 'Medical' })).toBe(true)
    expect(isCaseNameable({ other_party: 'J. Smith' })).toBe(true)
    expect(isCaseNameable({})).toBe(false)
    expect(isCaseNameable({ our_vessel: '   ', case_type: null })).toBe(false)
  })

  it('a legacy stored title does NOT count — it cannot be typed on a new case', () => {
    expect(isCaseNameable({ title: 'Collision' })).toBe(false)
  })
})
