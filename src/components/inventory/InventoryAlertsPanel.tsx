'use client'

// "Inventory needs attention" — the standing queue on the admin dashboard.
//
// Like ReportsDuePanel, this is deliberately INDEPENDENT of the reminder cron.
// It derives everything live from the tables, so it is correct even if the
// scheduler never runs, is misconfigured, or the inbox message was archived.
// The cron owns the one-off nudge; this is the list you work from.
//
// Renders nothing at all when there is nothing to say, and nothing for anyone
// who is not an admin — so it can be dropped into a dashboard unconditionally.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Boxes, Gauge } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { listCalibrationDue, listExpiringSoon, listLowStock } from '@/lib/inventory/api'
import { calibrationStatus, dueLabel } from '@/lib/inventory/calibration'
import { formatQty, formatQtyShort } from '@/lib/inventory/packs'
import { stockLevel } from '@/lib/inventory/stock'
import { expiryStatus } from '@/lib/personal-docs/api'
import { formatDate } from '@/lib/utils'
import type { ItemWithStock } from '@/lib/inventory/types'

interface Row {
  key: string
  icon: typeof Gauge
  title: string
  detail: string
  urgent: boolean
}

export default function InventoryAlertsPanel() {
  const [rows, setRows] = useState<Row[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => { void load() }, [])

  async function load() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setReady(true); return }
    const { data: me } = await supabase
      .from('profiles').select('role, is_super_admin').eq('id', user.id).maybeSingle()
    if (!(me?.role === 'admin' || me?.is_super_admin === true)) { setReady(true); return }

    const [low, calibration, expiring] = await Promise.all([
      listLowStock(), listCalibrationDue(60), listExpiringSoon(60),
    ])

    const next: Row[] = [
      ...calibration.map(calibrationRow),
      ...low.map(lowRow),
      ...expiring.map(expiryRow),
    ]
    // Overdue and out-of-stock first, then everything else in the order built.
    next.sort((a, b) => Number(b.urgent) - Number(a.urgent))
    setRows(next)
    setReady(true)
  }

  if (!ready || rows.length === 0) return null

  return (
    <div className="card border-l-4 border-l-amber-400">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-6 py-4">
        <h2 className="section-title flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          Inventory needs attention
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{rows.length}</span>
        </h2>
        <Link href="/inventory" className="text-sm text-brand-700 hover:underline">Open inventory</Link>
      </div>

      <div className="divide-y divide-gray-100">
        {rows.slice(0, 12).map(r => (
          <Link
            key={r.key}
            href="/inventory"
            className="flex items-center gap-3 px-6 py-3 transition-colors hover:bg-amber-50/60"
          >
            <r.icon className={`h-4 w-4 shrink-0 ${r.urgent ? 'text-red-500' : 'text-amber-500'}`} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900">{r.title}</p>
              <p className="truncate text-xs text-gray-500">{r.detail}</p>
            </div>
          </Link>
        ))}
        {rows.length > 12 && (
          <Link href="/inventory" className="block px-6 py-2.5 text-xs text-gray-500 hover:bg-amber-50/60">
            and {rows.length - 12} more…
          </Link>
        )}
      </div>
    </div>
  )
}

function calibrationRow(i: ItemWithStock): Row {
  const { status } = calibrationStatus(i.calibration_due)
  return {
    key: `cal-${i.id}`,
    icon: Gauge,
    title: i.name,
    detail: `Calibration ${dueLabel(i.calibration_due).toLowerCase()} (${formatDate(i.calibration_due)})`,
    urgent: status === 'expired',
  }
}

function lowRow(i: ItemWithStock): Row {
  const level = stockLevel(i.total_units, i.min_qty_units)
  return {
    key: `low-${i.id}`,
    icon: Boxes,
    title: i.name,
    detail: level === 'negative'
      ? `Recorded at ${formatQty(i.total_units, i)} — needs a recount`
      : level === 'out'
        ? 'Out of stock'
        : `Down to ${formatQty(i.total_units, i)} (reorder at ${formatQtyShort(i.min_qty_units ?? 0, i)})`,
    urgent: level === 'negative' || level === 'out',
  }
}

function expiryRow(i: ItemWithStock): Row {
  const { status, days } = expiryStatus(i.soonest_expiry, 60)
  return {
    key: `exp-${i.id}`,
    icon: Boxes,
    title: i.name,
    detail: status === 'expired'
      ? `Expired ${formatDate(i.soonest_expiry)}`
      : `Expires in ${days} days (${formatDate(i.soonest_expiry)})`,
    urgent: status === 'expired',
  }
}
