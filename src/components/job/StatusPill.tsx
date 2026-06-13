// Shared status pills so every screen renders the unified job status the same
// way. Staff see the full workflow; clients see the simplified version.

import { WORKFLOW, CLIENT_STATUS, clientStatusFor } from '@/lib/jobs/tracker'
import type { WorkflowStatus } from '@/lib/types/database'

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
