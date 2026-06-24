// Shared status pills so every screen renders the unified job status the same
// way. Staff see the full workflow; clients see the simplified version.

import { WORKFLOW, CLIENT_STATUS, clientStatusFor } from '@/lib/jobs/tracker'
import type { WorkflowStatus, Invoice } from '@/lib/types/database'

export function WorkflowPill({ status, className }: { status: WorkflowStatus; className?: string }) {
  const w = WORKFLOW[status] ?? WORKFLOW.new
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium ${w.pill} ${className ?? ''}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${w.dot}`} />{w.label}
    </span>
  )
}

export function ClientStatusPill({ status, className }: { status: WorkflowStatus; className?: string }) {
  const c = CLIENT_STATUS[clientStatusFor(status)]
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium ${c.pill} ${className ?? ''}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />{c.label}
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
