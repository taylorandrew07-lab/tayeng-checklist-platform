import { describe, it, expect } from 'vitest'
import {
  shiftHours, WORKFLOW, WORKFLOW_ORDER, LOCKED_STATUSES,
  isJobLocked, nextStatusFor, normalizeWorkflowStatus, clientStatusFor,
} from './tracker'
import type { WorkflowStatus } from '@/lib/types/database'

describe('shiftHours — overtime spanning dates/times', () => {
  it('computes a same-day shift', () => {
    expect(shiftHours('2026-06-27', '08:00', '2026-06-27', '14:00')).toBe(6)
  })

  it('computes a shift that crosses midnight into the next day', () => {
    // The user's example: 30 Jun 21:00 → 1 Jul 03:00 = 6h
    expect(shiftHours('2026-06-30', '21:00', '2026-07-01', '03:00')).toBe(6)
  })

  it('computes the screenshot shift as ONE entry (no need to split at midnight)', () => {
    // Previously split into 27/06 08:00–23:59 (15.98h) + 28/06 00:01–02:00 (1.98h).
    // As a single span 27/06 08:00 → 28/06 02:00 it is a clean 18h.
    expect(shiftHours('2026-06-27', '08:00', '2026-06-28', '02:00')).toBe(18)
  })

  it('handles a multi-day span (over a month boundary)', () => {
    // 30 Jun 06:00 → 2 Jul 06:00 = 48h
    expect(shiftHours('2026-06-30', '06:00', '2026-07-02', '06:00')).toBe(48)
  })

  it('handles half-hour precision', () => {
    expect(shiftHours('2026-06-27', '08:15', '2026-06-27', '12:45')).toBe(4.5)
  })

  it('returns 0 when the stop is before/equal the start (invalid)', () => {
    expect(shiftHours('2026-06-27', '14:00', '2026-06-27', '08:00')).toBe(0)
    expect(shiftHours('2026-06-27', '08:00', '2026-06-27', '08:00')).toBe(0)
  })

  it('returns 0 for incomplete input', () => {
    expect(shiftHours('2026-06-27', '', '2026-06-27', '14:00')).toBe(0)
    expect(shiftHours(null, '08:00', null, '14:00')).toBe(0)
  })

  it('falls back to the start date when no stop date is given (same-day only)', () => {
    expect(shiftHours('2026-06-27', '08:00', null, '14:00')).toBe(6)
  })
})

// ── The workflow lifecycle (migration 188 added 'invoiced') ──────────────────
describe('WORKFLOW_ORDER', () => {
  it('runs in_progress → report_ready → invoice_ready → invoiced → closed', () => {
    // Order is load-bearing: setWorkflowStatus and advanceWorkflowTo both do index
    // math on it, so a reorder silently changes which stamps get cleared.
    expect(WORKFLOW_ORDER).toEqual(
      ['in_progress', 'report_ready', 'invoice_ready', 'invoiced', 'closed'],
    )
  })

  it('has a label/colour entry for every stage', () => {
    // WORKFLOW is Record<WorkflowStatus, …> so tsc catches a missing key, but not a
    // stage present in the map and absent from the order.
    for (const s of WORKFLOW_ORDER) expect(WORKFLOW[s]).toBeDefined()
    expect(Object.keys(WORKFLOW).sort()).toEqual([...WORKFLOW_ORDER].sort())
  })

  it('ends at closed, so "at or past the target" keeps meaning finished', () => {
    expect(WORKFLOW_ORDER[WORKFLOW_ORDER.length - 1]).toBe('closed')
  })
})

describe('normalizeWorkflowStatus', () => {
  it('treats "invoiced" as the LIVE stage, not the retired pre-145 alias', () => {
    // THE regression pin. 'invoiced' used to fold to 'closed' (both here and in the
    // DB normalizer). Migration 188 brought the word back as a real stage; if this
    // ever returns 'closed' again, invoicing silently stops working.
    expect(normalizeWorkflowStatus('invoiced')).toBe('invoiced')
  })

  it('still folds the genuinely retired statuses', () => {
    expect(normalizeWorkflowStatus('sent')).toBe('closed')
    expect(normalizeWorkflowStatus('paid')).toBe('closed')
    expect(normalizeWorkflowStatus('approved')).toBe('invoice_ready')
    expect(normalizeWorkflowStatus('report_approved')).toBe('invoice_ready')
    expect(normalizeWorkflowStatus('assigned')).toBe('in_progress')
    expect(normalizeWorkflowStatus('report_uploaded')).toBe('report_ready')
  })

  it('falls back to in_progress for empty or unknown input', () => {
    expect(normalizeWorkflowStatus(null)).toBe('in_progress')
    expect(normalizeWorkflowStatus('')).toBe('in_progress')
    expect(normalizeWorkflowStatus('nonsense')).toBe('in_progress')
  })
})

describe('isJobLocked — mirrors job_is_open() (mig 188)', () => {
  it('locks exactly the two billed stages', () => {
    expect(LOCKED_STATUSES).toEqual(['invoiced', 'closed'])
    expect(isJobLocked('invoiced')).toBe(true)
    expect(isJobLocked('closed')).toBe(true)
  })

  it('leaves every pre-billing stage editable', () => {
    expect(isJobLocked('in_progress')).toBe(false)
    expect(isJobLocked('report_ready')).toBe(false)
    expect(isJobLocked('invoice_ready')).toBe(false)
  })

  it('resolves retired slugs before deciding', () => {
    expect(isJobLocked('paid')).toBe(true)        // → closed
    expect(isJobLocked('approved')).toBe(false)   // → invoice_ready
    expect(isJobLocked(null)).toBe(false)
  })
})

describe('nextStatusFor — the double-click advance', () => {
  it('steps forward one stage', () => {
    expect(nextStatusFor('in_progress')).toBe('report_ready')
    expect(nextStatusFor('report_ready')).toBe('invoice_ready')
  })

  it('SKIPS invoiced: invoice_ready advances straight to closed', () => {
    // 'invoiced' claims an invoice exists. A manual step must never assert that.
    expect(nextStatusFor('invoice_ready')).toBe('closed')
  })

  it('advances an invoiced job to closed — the manual close', () => {
    expect(nextStatusFor('invoiced')).toBe('closed')
  })

  it('stops at closed: no wrap, no going backwards', () => {
    expect(nextStatusFor('closed')).toBeNull()
  })

  it('never hands out "invoiced" from any stage', () => {
    for (const s of WORKFLOW_ORDER) expect(nextStatusFor(s)).not.toBe('invoiced')
  })

  it('always returns a later stage, or null', () => {
    for (const s of WORKFLOW_ORDER) {
      const next = nextStatusFor(s)
      if (next === null) continue
      expect(WORKFLOW_ORDER.indexOf(next)).toBeGreaterThan(WORKFLOW_ORDER.indexOf(s))
    }
  })
})

describe('clientStatusFor — clients never see billing internals', () => {
  it('shows an invoiced job exactly as an invoice-ready one', () => {
    // Without a case for it, 'invoiced' hits `default` and tells the client a BILLED
    // job is still "In progress".
    expect(clientStatusFor('invoiced')).toBe('completed')
    expect(clientStatusFor('invoice_ready')).toBe('completed')
  })

  it('maps the rest unchanged', () => {
    expect(clientStatusFor('in_progress')).toBe('in_progress')
    expect(clientStatusFor('report_ready')).toBe('report_ready')
    expect(clientStatusFor('closed')).toBe('closed')
  })

  it('has an answer for every stage', () => {
    for (const s of WORKFLOW_ORDER) expect(clientStatusFor(s as WorkflowStatus)).toBeTruthy()
  })
})
