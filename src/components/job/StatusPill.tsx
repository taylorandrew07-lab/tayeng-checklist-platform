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

const INVOICE_PILL: Record<Invoice['status'], string> = {
  draft: 'bg-gray-100 text-gray-600', sent: 'bg-cyan-100 text-cyan-700',
  paid: 'bg-green-100 text-green-700', overdue: 'bg-red-100 text-red-700', void: 'bg-slate-200 text-slate-500',
}

/** One invoice status badge used everywhere (ledger, job page). Pass `overdue` to
 *  override a "sent" invoice that's past its due date. */
export function InvoiceStatusPill({ status, overdue, className }: { status: Invoice['status']; overdue?: boolean; className?: string }) {
  const s = overdue ? 'overdue' : status
  const label = overdue ? 'Overdue' : status[0].toUpperCase() + status.slice(1)
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${INVOICE_PILL[s]} ${className ?? ''}`}>{label}</span>
}
