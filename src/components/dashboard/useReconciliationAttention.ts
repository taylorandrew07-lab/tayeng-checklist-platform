'use client'

import { useEffect, useState } from 'react'
import { Receipt, AlertTriangle, UserX, Clock } from 'lucide-react'
import { useRealtimeRefresh } from '@/lib/realtime'
import { listReconciliation, RECON_META, type ReconCategory } from '@/lib/jobs/reconciliation'
import { money } from '@/lib/jobs/tracker'
import type { AttentionItem, AttentionTone } from './AttentionCard'

const TONE: Record<ReconCategory, AttentionTone> = {
  missing_invoice_record: 'danger',
  missing_client: 'warn',
  ready_to_invoice: 'warn',
  hours_changed: 'warn',
}

const ICON: Record<ReconCategory, React.ElementType> = {
  missing_invoice_record: AlertTriangle,
  missing_client: UserX,
  ready_to_invoice: Receipt,
  hours_changed: Clock,
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
        const who = r.report_number || (r.vessel_name ? `M.V. ${r.vessel_name}` : 'Job')
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
