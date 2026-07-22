// Shared status pills so every screen renders the unified job status the same
// way. Staff see the full workflow; clients see the simplified version.

import { WORKFLOW, normalizeWorkflowStatus } from '@/lib/jobs/tracker'
import type { WorkflowStatus, Invoice } from '@/lib/types/database'

export function WorkflowPill({ status, className }: { status: WorkflowStatus; className?: string }) {
  // normalize so a pre-145 value still on a cached row renders as its collapsed
  // stage rather than falling through to a wrong default.
  const w = WORKFLOW[status] ?? WORKFLOW[normalizeWorkflowStatus(status)]
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium ${w.pill} ${className ?? ''}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${w.dot}`} />{w.label}
    </span>
  )
}

// Payment is not tracked (migration 146) — an invoice is live or cancelled.
const INVOICE_PILL: Record<Invoice['status'], string> = {
  active: 'bg-cyan-100 text-cyan-700',
  void: 'bg-slate-200 text-slate-500',
}
const INVOICE_LABEL: Record<Invoice['status'], string> = { active: 'Invoiced', void: 'Void' }

/** One invoice status badge used everywhere (ledger, job page). */
export function InvoiceStatusPill({ status, className }: { status: Invoice['status']; className?: string }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${INVOICE_PILL[status] ?? INVOICE_PILL.active} ${className ?? ''}`}>{INVOICE_LABEL[status] ?? 'Invoiced'}</span>
}
