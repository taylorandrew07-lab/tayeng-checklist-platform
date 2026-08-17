'use client'

// The Equipment tab: where each instrument is, who has it, when its certificate
// runs out — and, for an admin, the catalogue itself. Twin of ConsumablesList.
//
// The calibration badge is deliberately visible to EVERYONE, not just admins:
// the point is that nobody carries an out-of-cert gauge to a job.

import { useEffect, useMemo, useState } from 'react'
import { Archive, ArchiveRestore, Gauge, Loader2, Pencil, Plus, Search, Trash2, User } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Toggle } from '@/components/ui/Toggle'
import { ResponsiveTable, type Column } from '@/components/ui/ResponsiveTable'
import { listAllItems, listItems, listLocations, listStaffDirectory } from '@/lib/inventory/api'
import { archiveItemWithPrompt, removeItemWithPrompt } from '@/lib/inventory/removeItem'
import { calibrationStatus, dueLabel } from '@/lib/inventory/calibration'
import { unitsAt } from '@/lib/inventory/stock'
import { useRealtimeRefresh } from '@/lib/realtime'
import { formatDate } from '@/lib/utils'
import MovementDialog from './MovementDialog'
import ItemFormModal from './ItemFormModal'
import type { InventoryLocation, ItemWithStock, StaffMember } from '@/lib/inventory/types'

const SERVICE_LABEL: Record<string, { label: string; tone: 'neutral' | 'warn' | 'danger' }> = {
  in_service: { label: 'In service', tone: 'neutral' },
  out_for_calibration: { label: 'Away for calibration', tone: 'warn' },
  out_of_service: { label: 'Out of service', tone: 'danger' },
  retired: { label: 'Retired', tone: 'danger' },
}

export default function EquipmentList({ canEdit, isAdmin }: { canEdit: boolean; isAdmin: boolean }) {
  const [items, setItems] = useState<ItemWithStock[]>([])
  const [locations, setLocations] = useState<InventoryLocation[]>([])
  const [people, setPeople] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [moving, setMoving] = useState<ItemWithStock | null>(null)
  const [editing, setEditing] = useState<ItemWithStock | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  const tick = useRealtimeRefresh('inventory_items')

  async function load() {
    const [i, l, p] = await Promise.all([
      showArchived && isAdmin ? listAllItems('asset') : listItems('asset'),
      listLocations(),
      listStaffDirectory(),
    ])
    setItems(i); setLocations(l); setPeople(p); setLoading(false)
  }
  useEffect(() => { void load() }, [tick, showArchived, isAdmin])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items
      .filter(i => !q
        || i.name.toLowerCase().includes(q)
        || (i.serial_number ?? '').toLowerCase().includes(q)
        || (i.manufacturer ?? '').toLowerCase().includes(q))
      // Whatever is due soonest first; undated equipment sinks to the bottom.
      .sort((a, b) => (a.calibration_due ?? '9999').localeCompare(b.calibration_due ?? '9999'))
  }, [items, query])

  // Whatever has actually been used, so the picker reflects this company rather
  // than a hard-coded guess.
  const categories = useMemo(
    () => [...new Set(items.map(i => i.category).filter(Boolean) as string[])].sort(),
    [items],
  )

  function openAdd() { setEditing(null); setFormOpen(true) }
  function openEdit(i: ItemWithStock) { setEditing(i); setFormOpen(true) }

  async function archive(i: ItemWithStock) {
    if (await archiveItemWithPrompt(i) === 'archived') void load()
  }
  async function remove(i: ItemWithStock) {
    if (await removeItemWithPrompt(i, { isAdmin }) === 'deleted') void load()
  }

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
            <span className={i.is_active ? 'font-medium text-gray-900' : 'text-gray-400'}>{i.name}</span>
            {!i.is_active && <Badge tone="neutral">Archived</Badge>}
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
            <span className="inline-flex flex-wrap items-center gap-1.5 text-sm text-gray-700">
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
          <button
            className="btn-secondary min-h-11 sm:min-h-0"
            onClick={() => setMoving(i)}
            disabled={!i.is_active}
          >
            {i.held_by ? 'Check in' : 'Check out'}
          </button>
          {isAdmin && (
            <>
              <button className="btn-ghost px-2" onClick={() => openEdit(i)} aria-label={`Edit ${i.name}`} title="Edit">
                <Pencil className="h-4 w-4 text-gray-400" />
              </button>
              <button
                className="btn-ghost px-2" onClick={() => archive(i)}
                aria-label={i.is_active ? `Archive ${i.name}` : `Restore ${i.name}`}
                title={i.is_active ? 'Archive — hides it but keeps the record' : 'Restore'}
              >
                {i.is_active
                  ? <Archive className="h-4 w-4 text-gray-400" />
                  : <ArchiveRestore className="h-4 w-4 text-gray-400" />}
              </button>
              <button className="btn-ghost px-2" onClick={() => remove(i)} aria-label={`Delete ${i.name}`} title="Delete">
                <Trash2 className="h-4 w-4 text-gray-400 transition-colors hover:text-red-600" />
              </button>
            </>
          )}
        </div>
      ),
    }] : []),
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            className="input-base min-h-11 pl-9 sm:min-h-0"
            placeholder="Search by name, make or serial…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        {isAdmin && (
          <button className="btn-primary min-h-11 gap-2 sm:min-h-0" onClick={openAdd}>
            <Plus className="h-4 w-4" /> Add
          </button>
        )}
      </div>

      {isAdmin && (
        <Toggle checked={showArchived} onChange={setShowArchived} label="Show archived" />
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={Gauge}
          title={items.length ? 'Nothing matches that' : 'No equipment yet'}
          description={items.length
            ? 'Try a different search.'
            : 'Gauges, detectors, anemometers — anything with a serial number or a certificate.'}
          action={isAdmin && !items.length
            ? <button className="btn-primary gap-2" onClick={openAdd}><Plus className="h-4 w-4" /> Add the first one</button>
            : undefined}
        />
      ) : (
        <ResponsiveTable rows={rows} columns={columns} rowKey={i => i.id} />
      )}

      <MovementDialog
        item={moving}
        locations={locations}
        people={people}
        onClose={() => setMoving(null)}
        onDone={load}
      />

      <ItemFormModal
        open={formOpen}
        kind="asset"
        item={editing}
        locations={locations}
        categories={categories}
        onClose={() => setFormOpen(false)}
        onSaved={load}
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
