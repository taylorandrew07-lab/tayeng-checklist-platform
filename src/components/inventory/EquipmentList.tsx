'use client'

// The equipment board: where each instrument is, who has it, and when its
// certificate runs out.
//
// The calibration badge is deliberately visible to EVERYONE, not just admins —
// the point is that nobody carries an out-of-cert gauge to a job.

import { useEffect, useMemo, useState } from 'react'
import { Gauge, Loader2, Search, User } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { ResponsiveTable, type Column } from '@/components/ui/ResponsiveTable'
import { listItems, listLocations, listCustodyCandidates } from '@/lib/inventory/api'
import { calibrationStatus, dueLabel } from '@/lib/inventory/calibration'
import { unitsAt } from '@/lib/inventory/stock'
import { useRealtimeRefresh } from '@/lib/realtime'
import { formatDate } from '@/lib/utils'
import MovementDialog from './MovementDialog'
import ItemRowActions from './ItemRowActions'
import type { InventoryLocation, ItemWithStock } from '@/lib/inventory/types'

const SERVICE_LABEL: Record<string, { label: string; tone: 'neutral' | 'warn' | 'danger' }> = {
  in_service: { label: 'In service', tone: 'neutral' },
  out_for_calibration: { label: 'Away for calibration', tone: 'warn' },
  out_of_service: { label: 'Out of service', tone: 'danger' },
  retired: { label: 'Retired', tone: 'danger' },
}

export default function EquipmentList({ canEdit, isAdmin }: { canEdit: boolean; isAdmin: boolean }) {
  const [items, setItems] = useState<ItemWithStock[]>([])
  const [locations, setLocations] = useState<InventoryLocation[]>([])
  const [people, setPeople] = useState<{ id: string; full_name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<ItemWithStock | null>(null)

  const tick = useRealtimeRefresh('inventory_items')

  async function load() {
    const [i, l, p] = await Promise.all([listItems('asset'), listLocations(), listCustodyCandidates()])
    setItems(i); setLocations(l); setPeople(p); setLoading(false)
  }
  useEffect(() => { void load() }, [tick])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items
      .filter(i => !q
        || i.name.toLowerCase().includes(q)
        || (i.serial_number ?? '').toLowerCase().includes(q)
        || (i.manufacturer ?? '').toLowerCase().includes(q))
      // Anything due soonest first; undated equipment sinks to the bottom.
      .sort((a, b) => (a.calibration_due ?? '9999').localeCompare(b.calibration_due ?? '9999'))
  }, [items, query])

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
  }

  const columns: Column<ItemWithStock>[] = [
    {
      key: 'name',
      header: 'Equipment',
      primary: true,
      cell: i => (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-gray-900">{i.name}</span>
            {calibrationBadge(i)}
            {i.service_status !== 'in_service' && (
              <Badge tone={SERVICE_LABEL[i.service_status]?.tone ?? 'neutral'}>
                {SERVICE_LABEL[i.service_status]?.label ?? i.service_status}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-gray-400">
            {[i.manufacturer, i.model, i.serial_number && `s/n ${i.serial_number}`]
              .filter(Boolean).join(' · ') || 'No serial recorded'}
          </p>
        </div>
      ),
    },
    {
      key: 'where',
      header: 'Where',
      mobileLabel: 'Where',
      cell: i => {
        if (i.held_by) {
          return (
            <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
              <User className="h-3.5 w-3.5 text-gray-400" />
              {i.holder_name ?? 'Someone'}
              {i.held_since && <span className="text-xs text-gray-400">since {formatDate(i.held_since)}</span>}
            </span>
          )
        }
        const at = locations.find(l => unitsAt(i.stock, l.id) > 0)
        return at
          ? <span className="text-sm text-gray-700">{at.name}</span>
          : <span className="text-gray-400">Not in stores</span>
      },
    },
    {
      key: 'calibration',
      header: 'Calibration',
      mobileLabel: 'Calibration',
      cell: i => i.calibration_due
        ? (
          <div>
            <div className="tnum text-sm text-gray-700">{formatDate(i.calibration_due)}</div>
            <div className="text-xs text-gray-400">{dueLabel(i.calibration_due)}</div>
          </div>
        )
        : <span className="text-gray-300">—</span>,
    },
    ...(canEdit ? [{
      key: 'actions',
      header: '',
      align: 'right' as const,
      mobileLabel: '',
      cell: (i: ItemWithStock) => (
        <div className="flex items-center justify-end gap-1">
          <button className="btn-secondary min-h-11 sm:min-h-0" onClick={() => setActive(i)}>
            {i.held_by ? 'Check in' : 'Check out'}
          </button>
          {/* Removing a piece of equipment belongs on the equipment, not two tabs
              away in Manage — that is where anyone looks for it. */}
          {isAdmin && <ItemRowActions item={i} onDone={load} />}
        </div>
      ),
    }] : []),
  ]

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          className="input-base min-h-11 pl-9 sm:min-h-0"
          placeholder="Search by name, make or serial…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Gauge}
          title={items.length ? 'Nothing matches that' : 'No equipment yet'}
          description={items.length
            ? 'Try a different search.'
            : 'An admin can add gauges, detectors and anemometers under Manage.'}
        />
      ) : (
        <ResponsiveTable rows={rows} columns={columns} rowKey={i => i.id} />
      )}

      <MovementDialog
        item={active}
        locations={locations}
        people={people}
        onClose={() => setActive(null)}
        onDone={load}
      />
    </div>
  )
}

function calibrationBadge(i: ItemWithStock) {
  if (i.service_status === 'retired') return null
  const { status, days } = calibrationStatus(i.calibration_due)
  if (status === 'expired') return <Badge tone="danger">Calibration overdue</Badge>
  if (status === 'expiring') return <Badge tone="warn">Calibration in {days}d</Badge>
  return null
}
