import { describe, it, expect } from 'vitest'
import { typeSkipsReportNumber, autoReportNotRequired } from './reportPolicy'
import { STAGE_OPTIONS } from './newJobConfig'

// A draught survey is a sequence on one voyage — Initial, any number of Interims, then
// exactly one Final — and only the Final has enough information to produce a report.
// Until migration 186 only 'Initial' was exempt, so every Interim burned a number out of
// the single global running series (next_report_number(), mig 158).
//
// This predicate is mirrored by the set_report_number trigger in migration 186. If you
// change one you must change the other; the DB is the real safety net because offline
// sync can send an explicit report_not_required:false that skips createDraftJob's rule.

describe('typeSkipsReportNumber — draught survey stages', () => {
  it('skips the Initial (no information yet)', () => {
    expect(typeSkipsReportNumber('Draught Survey', 'Initial')).toBe(true)
  })

  it('skips the Interim — the migration-186 fix', () => {
    // The old rule numbered these. Andrew, 2026-08-13: "the initials and the interims
    // don't have reports because they obviously don't have all the information".
    expect(typeSkipsReportNumber('Draught Survey', 'Interim')).toBe(true)
  })

  it('NUMBERS the Final — it is the one that carries the report', () => {
    expect(typeSkipsReportNumber('Draught Survey', 'Final')).toBe(false)
  })

  it('numbers a draught survey with no stage set, rather than silently skipping', () => {
    // An unknown stage must fail safe towards HAVING a number: a missing number is
    // visible and fixable, a wrongly-issued one is not.
    expect(typeSkipsReportNumber('Draught Survey', null)).toBe(false)
    expect(typeSkipsReportNumber('Draught Survey', undefined)).toBe(false)
    expect(typeSkipsReportNumber('Draught Survey', 'Something Else')).toBe(false)
  })
})

describe('typeSkipsReportNumber — other job types are untouched', () => {
  it('still skips the whole Ultrasonic Hatch Testing type', () => {
    expect(typeSkipsReportNumber('Ultrasonic Hatch Testing')).toBe(true)
  })

  it('does not apply the draught stage rule to another type that shares a stage name', () => {
    // 'Initial' is only special ON a draught survey. Scope is the whole point.
    expect(typeSkipsReportNumber('Cargo Survey', 'Initial')).toBe(false)
    expect(typeSkipsReportNumber('Hire Survey', 'Interim')).toBe(false)
  })

  it('numbers a merged Cargo Survey by default (mig 154)', () => {
    expect(typeSkipsReportNumber('Cargo Survey', 'Loading')).toBe(false)
    expect(typeSkipsReportNumber('Cargo Survey', 'Discharging')).toBe(false)
  })

  it('returns false for a job with no type at all', () => {
    expect(typeSkipsReportNumber(null)).toBe(false)
    expect(typeSkipsReportNumber(undefined)).toBe(false)
  })
})

describe('the stage literals match the picker', () => {
  // The rule is written against exact strings. If someone renames a stage in the picker
  // the predicate silently stops matching and Interims start burning numbers again.
  it('Draught Survey still offers exactly Initial, Interim, Final', () => {
    expect(STAGE_OPTIONS['Draught Survey'].options).toEqual(['Initial', 'Interim', 'Final'])
  })

  it('every non-Final draught stage in the picker is exempt', () => {
    for (const stage of STAGE_OPTIONS['Draught Survey'].options) {
      expect(typeSkipsReportNumber('Draught Survey', stage)).toBe(stage !== 'Final')
    }
  })
})

describe('autoReportNotRequired', () => {
  it('an opted-out template wins regardless of type/stage', () => {
    expect(autoReportNotRequired({
      jobType: 'Draught Survey', jobStage: 'Final',
      template: { requires_report_number: false },
    })).toBe(true)
  })

  it('a numbering template does not rescue an Interim', () => {
    expect(autoReportNotRequired({
      jobType: 'Draught Survey', jobStage: 'Interim',
      template: { requires_report_number: true },
    })).toBe(true)
  })

  it('a Final with a numbering template still gets a number', () => {
    expect(autoReportNotRequired({
      jobType: 'Draught Survey', jobStage: 'Final',
      template: { requires_report_number: true },
    })).toBe(false)
  })

  it('no template at all falls through to the type/stage rule', () => {
    expect(autoReportNotRequired({ jobType: 'Draught Survey', jobStage: 'Interim', template: null })).toBe(true)
    expect(autoReportNotRequired({ jobType: 'Draught Survey', jobStage: 'Final', template: null })).toBe(false)
  })
})
