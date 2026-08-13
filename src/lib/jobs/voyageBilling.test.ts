import { describe, it, expect } from 'vitest'
import { seedVoyageLine, describeBlock, breakdownNote } from './voyageBilling'
import { groupDraughtVoyages, type VoyageJob } from './voyage'

// Andrew's arithmetic, pinned. With a 350 rate on each draught stage:
//   Initial + Final            = 700
//   Initial + Interim + Final  = 1050
//   Initial + 2 Interim + Final = 1400
//
// And the refusals, which matter more: three legs summed into one figure destroy the
// reader's ability to notice that one of them priced at zero. On a single-job line an
// unpriced job shows a visible "3 × 0"; inside a sum it vanishes — and the leg is still
// closed and locked behind a number that left it out.

let n = 0
const pool = (p: Partial<any> = {}): any => ({
  id: p.id ?? `j${++n}`,
  report_number: p.report_number ?? null,
  vessel_name: p.vessel_name ?? 'Chaconia',
  vessel_type: 'M.V.',
  job_type: 'Draught Survey',
  job_stage: p.job_stage ?? 'Final',
  client_id: 'client-1',
  client_name: 'Nu-Iron',
  cargo_type: null,
  voyage_number: p.voyage_number ?? 'V-086',
  scheduled_date: p.scheduled_date ?? '2026-08-01',
  end_date: null,
  created_at: '2026-08-01T00:00:00Z',
  workflow_status: 'invoice_ready',
  template_id: null,
  labour_unit: 'hours',
  billable_hours: null, billable_days: null, day_span: 1,
  billable_quantity: null, billable_km: p.billable_km ?? null,
  job_date: null, time_from: null, time_to: null,
  ...p,
})

const rate = (stage: string | null, amount: number, extra: Partial<any> = {}): any => ({
  id: `r-${stage ?? 'any'}-${amount}`,
  client_id: 'client-1',
  job_type: extra.job_type !== undefined ? extra.job_type : 'Draught Survey',
  job_stage: stage,
  rate_type: extra.rate_type ?? 'fixed',
  rate: amount,
  unit_label: null,
  currency: extra.currency ?? 'USD',
  is_active: true,
  ...extra,
})

const RATES_350 = [rate('Initial', 350), rate('Interim', 350), rate('Final', 350)]

function build(jobs: any[], rates: any[] = RATES_350, cur: any = 'USD') {
  const group = groupDraughtVoyages(jobs as VoyageJob[])[0]
  const members = new Map(jobs.map(j => [j.id, j]))
  return { group, seed: seedVoyageLine({ group, members, rates, invoiceCurrency: cur }) }
}

describe('Andrew’s numbers', () => {
  it('Initial + Final = 700', () => {
    const { seed } = build([
      pool({ id: 'i', job_stage: 'Initial' }),
      pool({ id: 'f', job_stage: 'Final' }),
    ])
    expect(seed.total).toBe(700)
    expect(seed.unit_price).toBe(700)
    expect(seed.blocks).toEqual([])
  })

  it('Initial + Interim + Final = 1050', () => {
    const { seed } = build([
      pool({ id: 'i', job_stage: 'Initial' }),
      pool({ id: 'x', job_stage: 'Interim', scheduled_date: '2026-08-03' }),
      pool({ id: 'f', job_stage: 'Final', scheduled_date: '2026-08-05' }),
    ])
    expect(seed.total).toBe(1050)
    expect(seed.breakdown.map(c => c.stage)).toEqual(['Initial', 'Interim', 'Final'])
  })

  it('two Interims = 1400', () => {
    const { seed } = build([
      pool({ id: 'i', job_stage: 'Initial' }),
      pool({ id: 'x1', job_stage: 'Interim', scheduled_date: '2026-08-02' }),
      pool({ id: 'x2', job_stage: 'Interim', scheduled_date: '2026-08-03' }),
      pool({ id: 'f', job_stage: 'Final', scheduled_date: '2026-08-05' }),
    ])
    expect(seed.total).toBe(1400)
  })

  it('a Final on its own is just 350', () => {
    const { seed } = build([pool({ id: 'f', job_stage: 'Final' })])
    expect(seed.total).toBe(350)
  })
})

describe('the line the client actually sees', () => {
  it('is qty 1, so the PDF prints no "n × price" note', () => {
    // InvoicePDF only shows the multiplication when qty ≠ 1, and a voyage's price is
    // not a multiple of anything a client would recognise.
    const { seed } = build([pool({ id: 'i', job_stage: 'Initial' }), pool({ id: 'f', job_stage: 'Final' })])
    expect(seed.qty).toBe(1)
  })

  it('keeps the em-dash head shape the PDF parses into columns', () => {
    const { seed } = build([pool({ id: 'i', job_stage: 'Initial' }), pool({ id: 'f', job_stage: 'Final' })])
    const head = seed.description.split('\n')[0]
    // Exactly one ' — ': InvoicePDF splits on the FIRST and lays out three fixed-width
    // columns. A second one would silently break the printed alignment.
    expect(head.split(' — ')).toHaveLength(2)
    expect(head).toContain('M.V. Chaconia')
    expect(head).toContain('(Final)')
  })

  it('names the voyage and its legs on the detail line', () => {
    const { seed } = build([
      pool({ id: 'i', job_stage: 'Initial' }),
      pool({ id: 'x', job_stage: 'Interim' }),
      pool({ id: 'f', job_stage: 'Final' }),
    ])
    const detail = seed.description.split('\n')[1]
    expect(detail).toContain('Voyage V-086')
    expect(detail).toContain('Initial + Interim + Final')
  })

  it('anchors on the Final — the job whose report number the PDF prints', () => {
    const { seed } = build([
      pool({ id: 'i', job_stage: 'Initial' }),
      pool({ id: 'f', job_stage: 'Final', report_number: '26-08-240' }),
    ])
    expect(seed.anchorJobId).toBe('f')
  })
})

describe('refusals — anything ambiguous blocks, never warns', () => {
  it('blocks when a leg has no matching rate', () => {
    const { seed } = build(
      [pool({ id: 'i', job_stage: 'Initial' }), pool({ id: 'f', job_stage: 'Final' })],
      [rate('Final', 350)], // nothing for Initial
    )
    expect(seed.blocks.some(b => b.kind === 'no_rate' || b.kind === 'zero_price')).toBe(true)
  })

  it('blocks when a leg matched only the catch-all rate', () => {
    // pickRate falls through to a client's no-job-type rate by design. Inside a sum
    // nobody can see a Draught Survey priced from an unrelated fee.
    const { seed } = build(
      [pool({ id: 'i', job_stage: 'Initial' }), pool({ id: 'f', job_stage: 'Final' })],
      [rate('Final', 350), rate(null, 99, { job_type: null })],
    )
    expect(seed.blocks.some(b => b.kind === 'catch_all_rate')).toBe(true)
  })

  it('blocks a leg that prices at zero', () => {
    const { seed } = build(
      [pool({ id: 'i', job_stage: 'Initial' }), pool({ id: 'f', job_stage: 'Final' })],
      [rate('Initial', 0), rate('Final', 350)],
    )
    expect(seed.blocks.some(b => b.kind === 'zero_price')).toBe(true)
  })

  it('blocks the hourly-rate-on-a-day-billed-job zero, which is otherwise invisible', () => {
    // seedCharge deliberately seeds unit_price 0 there so a single-job line reads as
    // obviously incomplete. Summed into a voyage, that signal is destroyed.
    const { seed } = build(
      [
        pool({ id: 'i', job_stage: 'Initial', labour_unit: 'days', billable_days: 3 }),
        pool({ id: 'f', job_stage: 'Final' }),
      ],
      [rate('Initial', 100, { rate_type: 'hourly' }), rate('Final', 350)],
    )
    expect(seed.blocks.some(b => b.kind === 'zero_price')).toBe(true)
  })

  it('blocks a leg priced in another currency — there is no FX anywhere', () => {
    const { seed } = build(
      [pool({ id: 'i', job_stage: 'Initial' }), pool({ id: 'f', job_stage: 'Final' })],
      [rate('Initial', 350, { currency: 'TTD' }), rate('Final', 350)],
      'USD',
    )
    expect(seed.blocks.some(b => b.kind === 'currency_mismatch')).toBe(true)
  })

  it('blocks a leg missing from the pool rather than quietly dropping it', () => {
    // A leg the pool cannot see is exactly the leg that would be billed at nothing.
    const jobs = [pool({ id: 'i', job_stage: 'Initial' }), pool({ id: 'f', job_stage: 'Final' })]
    const group = groupDraughtVoyages(jobs as VoyageJob[])[0]
    const members = new Map([[jobs[1].id, jobs[1]]]) // Initial absent
    const seed = seedVoyageLine({ group, members, rates: RATES_350, invoiceCurrency: 'USD' as any })
    expect(seed.blocks.some(b => b.kind === 'no_rate')).toBe(true)
    expect(seed.total).toBe(350)
  })

  it('every block renders a readable sentence', () => {
    const kinds = [
      { kind: 'no_final' as const },
      { kind: 'no_rate' as const, stage: 'Initial' },
      { kind: 'catch_all_rate' as const, stage: 'Interim' },
      { kind: 'zero_price' as const, stage: 'Final' },
      { kind: 'currency_mismatch' as const, stage: 'Initial', currency: 'TTD' },
    ]
    for (const b of kinds) {
      expect(describeBlock(b).length).toBeGreaterThan(20)
    }
  })
})

describe('the internal audit note', () => {
  it('records what every leg contributed and the total', () => {
    const { seed } = build([
      pool({ id: 'i', job_stage: 'Initial', report_number: null }),
      pool({ id: 'x', job_stage: 'Interim' }),
      pool({ id: 'f', job_stage: 'Final', report_number: '26-08-240' }),
    ])
    const note = breakdownNote(seed, 'V-086')
    expect(note).toContain('Voyage V-086')
    expect(note).toContain('Initial')
    expect(note).toContain('26-08-240')
    expect(note).toContain('Total: 1050')
  })
})
