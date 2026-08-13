'use client'

import { useEffect, useState } from 'react'
import { Receipt, AlertTriangle, UserX, Clock, CircleDashed, Unlink, Ship } from 'lucide-react'
import { useRealtimeRefresh } from '@/lib/realtime'
import { listReconciliation, RECON_META, type ReconCategory } from '@/lib/jobs/reconciliation'
import { money } from '@/lib/jobs/tracker'
import type { AttentionItem, AttentionTone } from './AttentionCard'
import { vesselWithVoyage } from '@/lib/utils'

const TONE: Record<ReconCategory, AttentionTone> = {
  missing_invoice_record: 'danger',
  missing_client: 'warn',
  ready_to_invoice: 'warn',
  hours_changed: 'warn',
  // A job nobody completed isn't wrong yet — it's unfinished. 'warn' would put it
  // alongside real billing faults; it needs a nudge, not an alarm.
  not_completed: 'info',
  // The three voyage faults where money is ALREADY wrong — a survey billed at
  // nothing, or billed to nobody. These are the loudest thing on the page.
  voyage_leg_unbilled: 'danger',
  orphaned_rollup: 'danger',
  billed_no_line: 'danger',
  // A voyage with no Final can't be billed yet, but it is a real task: somebody has
  // to set the last survey's stage to Final.
  voyage_missing_final: 'warn',
  // Not a fault at all — a leg correctly waiting for its Final. It appears so the
  // page can explain why an invoice-ready survey isn't in the "bill it" pile.
  awaiting_final: 'info',
}

const ICON: Record<ReconCategory, React.ElementType> = {
  missing_invoice_record: AlertTriangle,
  missing_client: UserX,
  ready_to_invoice: Receipt,
  hours_changed: Clock,
  not_completed: CircleDashed,
  voyage_leg_unbilled: AlertTriangle,
  orphaned_rollup: Unlink,
  billed_no_line: AlertTriangle,
  voyage_missing_final: Ship,
  awaiting_final: CircleDashed,
}

/**
 * Billing/work exceptions (jobs done but not invoiced/closed) as AttentionCard
 * items, each deep-linking to the job. Live via useRealtimeRefresh('invoices').
 * Admin-only data; pass enabled=false to skip.
 */
export function useReconciliationAttention(enabled = true): AttentionItem[] {
  const [items, setItems] = useState<AttentionItem[]>([])
  const tick = useRealtimeRefresh('invoices')

  useEffect(() => {
    let cancelled = false
    if (!enabled) { setItems([]); return }
    listReconciliation().then(({ items: recon }) => {
      if (cancelled) return
      setItems(recon.map(r => {
        const meta = RECON_META[r.category]
        const who = r.report_number || (r.vessel_name ? vesselWithVoyage(r.vessel_name, r.vessel_type, r.voyage_number) : 'Job')
        // invoice_total is already null for an absorbed leg (reconciliation.ts) — the
        // amount belongs to the Final's line, and showing it per leg would print one
        // voyage's total three times over.
        const amount = r.invoice_total != null && r.currency ? ` · ${money(r.invoice_total, r.currency)}` : ''
        return {
          icon: ICON[r.category],
          label: `${meta.label} — ${who}`,
          detail: `${meta.blurb}${r.client_name ? ` (${r.client_name})` : ''}${amount}`,
          href: `/admin/jobs/${r.job_id}`,
          tone: TONE[r.category],
        }
      }))
    }).catch(() => { if (!cancelled) setItems([]) })
    return () => { cancelled = true }
  }, [enabled, tick])

  return items
}
