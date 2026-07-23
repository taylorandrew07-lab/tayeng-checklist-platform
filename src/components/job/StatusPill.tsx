// Shared status pills so every screen renders the unified job status the same
// way. Staff see the full workflow; clients see the simplified version. One pill
// per domain — never re-declare a status/role colour map inline at a call site.

import { CheckCircle2, CircleDot } from 'lucide-react'
import { WORKFLOW, normalizeWorkflowStatus } from '@/lib/jobs/tracker'
import type { WorkflowStatus, Invoice, UserRole, TemplateStatus } from '@/lib/types/database'
import type { VoyageStatus } from '@/lib/cargo/types'

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

const PILL_BASE = 'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium'

// Client active/inactive — was inlined 3+ ways (green text+Check / rounded pill / tag).
export function ClientStatusPill({ active, className }: { active: boolean; className?: string }) {
  return (
    <span className={`${PILL_BASE} ${active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'} ${className ?? ''}`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

// Staff role badge — single source for the role colour map (was inlined in the users list).
const ROLE_PILL: Record<UserRole, string> = {
  admin: 'bg-red-100 text-red-700',
  surveyor: 'bg-blue-100 text-blue-700',
  client: 'bg-green-100 text-green-700',
  office: 'bg-teal-100 text-teal-700',
}
const ROLE_LABEL: Record<UserRole, string> = { admin: 'Admin', surveyor: 'Surveyor', client: 'Client', office: 'Office' }
export function RolePill({ role, className }: { role: UserRole; className?: string }) {
  return <span className={`${PILL_BASE} ${ROLE_PILL[role] ?? 'bg-gray-100 text-gray-700'} ${className ?? ''}`}>{ROLE_LABEL[role] ?? role}</span>
}

// Template publish state (draft / active / archived) — one source for the colour map.
const TEMPLATE_PILL: Record<TemplateStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  active: 'bg-green-100 text-green-700',
  archived: 'bg-red-100 text-red-700',
}
const TEMPLATE_LABEL: Record<TemplateStatus, string> = { draft: 'Draft', active: 'Active', archived: 'Archived' }
export function TemplateStatusPill({ status, className }: { status: TemplateStatus; className?: string }) {
  return <span className={`${PILL_BASE} ${TEMPLATE_PILL[status] ?? TEMPLATE_PILL.draft} ${className ?? ''}`}>{TEMPLATE_LABEL[status] ?? status}</span>
}

// Cargo voyage state — one colour + spelling ("Finalised") app-wide. Previously
// inlined with disagreeing colours (amber vs sky) and two spellings.
export function CargoStatusPill({ status, className }: { status: VoyageStatus; className?: string }) {
  const finalized = status === 'finalized'
  return (
    <span className={`${PILL_BASE} ${finalized ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'} ${className ?? ''}`}>
      {finalized ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleDot className="h-3.5 w-3.5" />}
      {finalized ? 'Finalised' : 'In progress'}
    </span>
  )
}
