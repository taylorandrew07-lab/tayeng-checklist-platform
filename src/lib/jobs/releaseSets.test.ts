import { describe, it, expect } from 'vitest'
import { releaseSets, type InvoiceJobLink } from './invoicing'

// Which jobs an invoice edit frees. This used to be spelled inline three times — in
// create, delete and update — and the three did not agree. Once a draught-survey voyage
// rolls three jobs onto ONE line, the disagreement stops being cosmetic: an absorbed
// Initial sits on no line at all, so a release derived from the lines alone leaves it
// closed and frozen with no invoice left to reopen.
//
// The two invariants everything here defends:
//   1. Releasing a parent must release its absorbed children.
//   2. The standalone report-only job (stamped, deliberately never line-linked) must
//      NEVER be released just because it is not on a line.

const link = (id: string, parent: string | null = null): InvoiceJobLink =>
  ({ id, billed_under_job_id: parent })

describe('releaseSets — ordinary single-job invoices', () => {
  it('releases a job whose line was deleted', () => {
    const r = releaseSets({
      priorLineJobIds: ['a', 'b'],
      stamped: [link('a'), link('b')],
      keptLineJobIds: ['a'],
    })
    expect(r.releasedJobIds).toEqual(['b'])
    expect(r.addedJobIds).toEqual([])
  })

  it('releases nothing when the lines are unchanged', () => {
    const r = releaseSets({
      priorLineJobIds: ['a', 'b'],
      stamped: [link('a'), link('b')],
      keptLineJobIds: ['a', 'b'],
    })
    expect(r.releasedJobIds).toEqual([])
    expect(r.addedJobIds).toEqual([])
  })

  it('reports a newly added job so the caller can stamp it', () => {
    // updateInvoice never stamped added jobs — a pre-existing hole that the roll-up
    // turns into "billed but still open", the exact state this feature exists to kill.
    const r = releaseSets({
      priorLineJobIds: ['a'],
      stamped: [link('a')],
      keptLineJobIds: ['a', 'c'],
    })
    expect(r.addedJobIds).toEqual(['c'])
    expect(r.releasedJobIds).toEqual([])
  })
})

describe('releaseSets — the standalone report-only job carve-out', () => {
  it('does NOT release a stamped job that was never on a line', () => {
    // createConsolidatedInvoice's `new_job` path stamps a report-only job onto the
    // invoice without giving it a line. "Not on a line" must not read as "removed".
    const r = releaseSets({
      priorLineJobIds: [],
      stamped: [link('standalone')],
      keptLineJobIds: [],
    })
    expect(r.releasedJobIds).toEqual([])
  })

  it('leaves it alone while other lines are edited around it', () => {
    const r = releaseSets({
      priorLineJobIds: ['a', 'b'],
      stamped: [link('a'), link('b'), link('standalone')],
      keptLineJobIds: ['a'],
    })
    expect(r.releasedJobIds).toEqual(['b'])
    expect(r.releasedJobIds).not.toContain('standalone')
  })
})

describe('releaseSets — draught-survey voyage roll-ups', () => {
  // final = the job that owns the line; initial + interim are absorbed under it.
  const voyage: InvoiceJobLink[] = [
    link('final'), link('initial', 'final'), link('interim', 'final'),
  ]

  it('releasing the Final releases the whole voyage with it', () => {
    const r = releaseSets({
      priorLineJobIds: ['final'],
      stamped: voyage,
      keptLineJobIds: [],
    })
    expect(new Set(r.releasedJobIds)).toEqual(new Set(['final', 'initial', 'interim']))
  })

  it('keeping the Final keeps its absorbed legs too', () => {
    const r = releaseSets({
      priorLineJobIds: ['final'],
      stamped: voyage,
      keptLineJobIds: ['final'],
    })
    expect(r.releasedJobIds).toEqual([])
  })

  it('dropping one voyage does not disturb another on the same invoice', () => {
    const two: InvoiceJobLink[] = [
      link('finalA'), link('initialA', 'finalA'),
      link('finalB'), link('initialB', 'finalB'), link('interimB', 'finalB'),
    ]
    const r = releaseSets({
      priorLineJobIds: ['finalA', 'finalB'],
      stamped: two,
      keptLineJobIds: ['finalB'],
    })
    expect(new Set(r.releasedJobIds)).toEqual(new Set(['finalA', 'initialA']))
  })

  it('releases a voyage alongside an ordinary job on the same invoice', () => {
    const mixed: InvoiceJobLink[] = [
      link('final'), link('initial', 'final'), link('ordinary'), link('standalone'),
    ]
    const r = releaseSets({
      priorLineJobIds: ['final', 'ordinary'],
      stamped: mixed,
      keptLineJobIds: ['ordinary'],
    })
    expect(new Set(r.releasedJobIds)).toEqual(new Set(['final', 'initial']))
    expect(r.releasedJobIds).not.toContain('standalone')
  })

  it('never returns the same job twice', () => {
    // A child listed as both a line job and an absorbed leg would otherwise appear
    // twice and inflate any count derived from the result.
    const r = releaseSets({
      priorLineJobIds: ['final', 'initial'],
      stamped: [link('final'), link('initial', 'final')],
      keptLineJobIds: [],
    })
    expect(r.releasedJobIds.length).toBe(new Set(r.releasedJobIds).size)
    expect(new Set(r.releasedJobIds)).toEqual(new Set(['final', 'initial']))
  })

  it('ignores a child whose parent is not being released', () => {
    const r = releaseSets({
      priorLineJobIds: ['finalA', 'finalB'],
      stamped: [link('finalA'), link('initialA', 'finalA'), link('finalB')],
      keptLineJobIds: ['finalA', 'finalB'],
    })
    expect(r.releasedJobIds).toEqual([])
  })

  it('does not release a child pointing at a parent on some OTHER invoice', () => {
    // stamped only ever contains this invoice's jobs, so a dangling parent reference
    // must simply not match — never release on a guess.
    const r = releaseSets({
      priorLineJobIds: ['final'],
      stamped: [link('final'), link('stray', 'someone-elses-final')],
      keptLineJobIds: [],
    })
    expect(r.releasedJobIds).toEqual(['final'])
  })
})

describe('releaseSets — empty and degenerate input', () => {
  it('handles an invoice with no jobs at all', () => {
    expect(releaseSets({ priorLineJobIds: [], stamped: [], keptLineJobIds: [] }))
      .toEqual({ releasedJobIds: [], addedJobIds: [] })
  })

  it('deduplicates repeated line job ids (one job, several charges)', () => {
    // UHT bills per hatch cover AND per cargo hold: two lines, one job.
    const r = releaseSets({
      priorLineJobIds: ['a', 'a'],
      stamped: [link('a')],
      keptLineJobIds: [],
    })
    expect(r.releasedJobIds).toEqual(['a'])
  })
})
