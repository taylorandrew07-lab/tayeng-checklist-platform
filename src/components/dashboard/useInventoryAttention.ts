'use client'

import { useEffect, useState } from 'react'
import { Gauge } from 'lucide-react'
import { useRealtimeRefresh } from '@/lib/realtime'
import { listMyHeldAssets } from '@/lib/inventory/api'
import { calibrationStatus, dueLabel } from '@/lib/inventory/calibration'
import type { AttentionItem } from './AttentionCard'

/**
 * Equipment THIS surveyor is currently holding, as AttentionCard items.
 *
 * Deliberately narrow. A surveyor does not need the company-wide calibration
 * board on their dashboard — but they do need to know that the gauge in their
 * van is about to go out of certification, and that they are still holding kit
 * someone else may be looking for.
 *
 * Reads inventory_items.held_by, not the ledger, so it needs no history access
 * at all — which is exactly why custody is denormalised onto the item row.
 */
export function useInventoryAttention({ enabled = true }: { enabled?: boolean } = {}): AttentionItem[] {
  const [items, setItems] = useState<AttentionItem[]>([])
  const tick = useRealtimeRefresh('inventory_items')

  useEffect(() => {
    let cancelled = false
    if (!enabled) { setItems([]); return }

    async function load() {
      const held = await listMyHeldAssets().catch(() => [])
      if (cancelled) return

      setItems(held.map(i => {
        const { status } = calibrationStatus(i.calibration_due)
        return {
          icon: Gauge,
          label: `You have ${i.name}`,
          detail: status === 'expired'
            ? `Calibration overdue — ${dueLabel(i.calibration_due).toLowerCase()}`
            : status === 'expiring'
              ? dueLabel(i.calibration_due)
              : 'Check it back in when you are done with it',
          href: '/inventory',
          tone: status === 'expired' ? 'danger' : status === 'expiring' ? 'warn' : 'info',
        }
      }))
    }

    load()
    return () => { cancelled = true }
  }, [enabled, tick])

  return items
}
