import { describe, it, expect } from 'vitest'
import { categorize, RECON_JOB_COLUMNS, RECON_ORDER, RECON_META, NON_SNOOZABLE, type ReconJob } from './reconciliation'
import { groupDraughtVoyages } from './voyage'

// The reconcile page is the only tool that catches forgotten billing, so its failure
// mode matters more than its success: a rule that never fires produces a page that
// LOOKS clean. Everything here is aimed at that.

let n = 0
const job = (p: Partial<ReconJob> = {}): ReconJob => ({
  id: p.id ?? `j${++n}`,
  report_number: null,
  job_type: p.job_type !== undefined ? p.job_type : null,
  job_stage: p.job_stage !== undefined ? p.job_stage : null,
  vessel_id: p.vessel_id ?? null,
  vessel_name: p.vessel_name ?? 'Chaconia',
  client_id: p.client_id !== undefined ? p.client_id : 'client-1',
  voyage_number: p.voyage_number ?? null,
  scheduled_date: p.scheduled_date !== undefined ? p.scheduled_date : '2026-08-01',
  end_date: p.end_date ?? null,
  workflow_status: p.workflow_status ?? 'invoice_ready',
  invoice_id: p.invoice_id !== undefined ? p.invoice_id : null,
  billed_under_job_id: p.billed_under_job_id ?? null,
  submitted_at: p.submitted_at ?? null,
  created_at: p.created_at ?? '2026-08-01T00:00:00Z',
} as ReconJob)

const leg = (stage: string, extra: Partial<ReconJob> = {}) =>
  job({ job_type: 'Draught Survey', job_stage: stage, voyage_number: 'V-086', ...extra })

const liveInvoice = { id: 'inv-1', status: 'active' as const, created_at: '2026-08-06T00:00:00Z' }

describe('the select string is the one thing tsc cannot check', () => {
  // A ReconJob field missing from RECON_JOB_COLUMNS arrives undefined at runtime and
  // every rule reading it silently never fires. That is the worst possible outcome for
  // this page, so the two are pinned together here.
  const required = [
    'id', 'report_number', 'vessel_name', 'vessel_type', 'vessel_id', 'voyage_number',
    'job_type', 'job_stage', 'client_id', 'workflow_status', 'invoice_id',
    'billed_under_job_id', 'submitted_at', 'scheduled_date', 'end_date', 'created_at',
  ]
  for (const col of required) {
    it(`selects ${col}`, () => {
      expect(RECON_JOB_COLUMNS.split(/[\s,]+/)).toContain(col)
    })
  }
})

describe('every category has metadata and a place in the order', () => {
  it('RECON_ORDER covers exactly the keys of RECON_META', () => {
    expect([...RECON_ORDER].sort()).toEqual(Object.keys(RECON_META).sort())
  })
  it('the money-wrong categories cannot be snoozed', () => {
    expect(NON_SNOOZABLE).toEqual(['voyage_leg_unbilled', 'orphaned_rollup', 'billed_no_line'])
  })
})

describe('absorbed legs', () => {
  it('a correctly absorbed leg is NOT flagged', () => {
    const final = leg('Final', { id: 'f', invoice_id: 'inv-1', workflow_status: 'closed' })
    const initial = leg('Initial', { id: 'i', invoice_id: 'inv-1', workflow_status: 'closed', billed_under_job_id: 'f' })
    expect(categorize(initial, { inv: liveInvoice, parent: final })).toBeNull()
  })

  it('flags a leg whose parent is on a DIFFERENT invoice', () => {
    const final = leg('Final', { id: 'f', invoice_id: 'inv-2', workflow_status: 'closed' })
    const initial = leg('Initial', { id: 'i', invoice_id: 'inv-1', workflow_status: 'closed', billed_under_job_id: 'f' })
    expect(categorize(initial, { inv: liveInvoice, parent: final })).toBe('orphaned_rollup')
  })

  it('flags a leg whose parent cannot be found at all', () => {
    const initial = leg('Initial', { id: 'i', invoice_id: 'inv-1', workflow_status: 'closed', billed_under_job_id: 'gone' })
    expect(categorize(initial, { inv: liveInvoice, parent: null })).toBe('orphaned_rollup')
  })

  it('an absorbed leg is never told to "bill it" even without an invoice row', () => {
    const initial = leg('Initial', { id: 'i', invoice_id: null, billed_under_job_id: 'f' })
    expect(categorize(initial, { parent: null })).toBe('orphaned_rollup')
  })
})

describe('billed but not charged', () => {
  it('flags a stamped, closed job that no line bills', () => {
    const j = job({ invoice_id: 'inv-1', workflow_status: 'closed' })
    expect(categorize(j, { inv: liveInvoice, hasLine: false, invoiceHasJobLines: true })).toBe('billed_no_line')
  })

  it('does NOT flag the standalone report-only job, which is stamped by design', () => {
    // createConsolidatedInvoice's new_job path: stamped, never line-linked, on an
    // invoice whose only lines are typed by hand.
    const j = job({ invoice_id: 'inv-1', workflow_status: 'closed' })
    expect(categorize(j, { inv: liveInvoice, hasLine: false, invoiceHasJobLines: false })).toBeNull()
  })

  it('does not flag a job that does own a line', () => {
    const j = job({ invoice_id: 'inv-1', workflow_status: 'closed' })
    expect(categorize(j, { inv: liveInvoice, hasLine: true, invoiceHasJobLines: true })).toBeNull()
  })

  it('still reports hours changed on a properly billed job', () => {
    const j = job({ invoice_id: 'inv-1', workflow_status: 'closed' })
    expect(categorize(j, { inv: liveInvoice, hasLine: true, invoiceHasJobLines: true, hoursChanged: true })).toBe('hours_changed')
  })
})

describe('draught legs are never told to bill themselves', () => {
  const group = (members: ReconJob[]) => groupDraughtVoyages(members)[0]

  it('an Initial whose Final is not yet billed is quiet, not "ready to invoice"', () => {
    // THE regression this whole category exists for. The old rule said "marked
    // invoice-ready, no invoice yet" — i.e. raise one — which is exactly the
    // standalone Interim line the roll-up exists to prevent.
    const initial = leg('Initial', { id: 'i' })
    const final = leg('Final', { id: 'f' })
    const g = group([initial, final])
    expect(categorize(initial, { group: g })).toBe('awaiting_final')
  })

  it('flags an Initial whose Final HAS been invoiced — it was missed off', () => {
    const initial = leg('Initial', { id: 'i' })
    const final = leg('Final', { id: 'f', invoice_id: 'inv-1', workflow_status: 'closed' })
    const g = group([initial, final])
    expect(categorize(initial, { group: g })).toBe('voyage_leg_unbilled')
  })

  it('flags a voyage with no Final once its legs are ready to bill', () => {
    const initial = leg('Initial', { id: 'i' })
    const interim = leg('Interim', { id: 'x' })
    const g = group([initial, interim])
    expect(categorize(initial, { group: g })).toBe('voyage_missing_final')
  })

  it('says nothing about a no-Final voyage while the legs are still report_ready', () => {
    // Mid-voyage this is simply normal — the Final has not been done yet.
    const initial = leg('Initial', { id: 'i', workflow_status: 'report_ready' })
    const interim = leg('Interim', { id: 'x', workflow_status: 'report_ready' })
    const g = group([initial, interim])
    expect(categorize(initial, { group: g })).toBeNull()
  })

  it('the FINAL itself still bills normally', () => {
    const initial = leg('Initial', { id: 'i' })
    const final = leg('Final', { id: 'f' })
    const g = group([initial, final])
    expect(categorize(final, { group: g })).toBe('ready_to_invoice')
  })

  it('a Final with no client is still flagged as having no client', () => {
    const final = leg('Final', { id: 'f', client_id: null })
    expect(categorize(final, { group: group([final]) })).toBe('missing_client')
  })
})

describe('non-draught jobs are completely unaffected', () => {
  it('an invoice-ready cargo survey is still "ready to invoice"', () => {
    expect(categorize(job({ job_type: 'Cargo Survey', job_stage: 'Loading' }))).toBe('ready_to_invoice')
  })

  it('a closed job with no invoice is still "invoice missing"', () => {
    expect(categorize(job({ workflow_status: 'closed' }))).toBe('missing_invoice_record')
  })

  it('a submitted job stuck in progress is still "not completed"', () => {
    const j = job({ workflow_status: 'in_progress', submitted_at: '2026-08-02T00:00:00Z' })
    expect(categorize(j)).toBe('not_completed')
  })

  it('a recent in-progress job with nothing submitted is quiet', () => {
    const j = job({ workflow_status: 'in_progress', scheduled_date: '2026-08-01' })
    expect(categorize(j, { staleBefore: '2026-07-01' })).toBeNull()
  })

  it('a voided invoice does not count as billed', () => {
    const j = job({ invoice_id: 'inv-1', workflow_status: 'closed' })
    expect(categorize(j, { inv: { id: 'inv-1', status: 'void' } })).toBe('missing_invoice_record')
  })
})

describe('a draught survey with no recognisable stage falls back to normal rules', () => {
  it('is treated as an ordinary job, not a voyage leg', () => {
    const j = job({ job_type: 'Draught Survey', job_stage: null })
    expect(categorize(j, { group: null })).toBe('ready_to_invoice')
  })
})
