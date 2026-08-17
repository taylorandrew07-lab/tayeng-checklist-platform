'use client'

// The Consumables tab: what we have, where, what needs ordering — and, for an
// admin, the catalogue itself.
//
// There used to be a separate "Items" list under Manage that showed the same
// rows again with Add/Edit/Delete on them. That was one list too many: this tab
// IS the consumables, so adding and editing one belongs here, on the thing.
//
// Table on desktop, stacked cards on a phone, via ResponsiveTable — so the row
// actions are never stranded off-screen behind a horizontal scroll.

import { useEffect, useMemo, useState } from 'react'
import { Archive, ArchiveRestore, Boxes, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Toggle } from '@/components/ui/Toggle'
import { ResponsiveTable, type Column } from '@/components/ui/ResponsiveTable'
import { listAllItems, listItems, listLocations, listCustodyCandidates } from '@/lib/inventory/api'
import { archiveItemWithPrompt, removeItemWithPrompt } from '@/lib/inventory/removeItem'
import { formatQty, formatQtyShort } from '@/lib/inventory/packs'
import { stockLevel, unitsAt, byUrgency } from '@/lib/inventory/stock'
import { expiryStatus } from '@/lib/personal-docs/api'
import { useRealtimeRefresh } from '@/lib/realtime'
import { formatDate } from '@/lib/utils'
import MovementDialog from './MovementDialog'
import ItemFormModal from './ItemFormModal'
import type { InventoryLocation, ItemWithStock } from '@/lib/inventory/types'

const LEVEL_BADGE = {
  negative: { tone: 'danger' as const, label: 'Needs recount' },
  out: { tone: 'danger' as const, label: 'Out' },
  low: { tone: 'warn' as const, label: 'Low' },
  ok: null,
}

export default function ConsumablesList({ canEdit, isAdmin }: { canEdit: boolean; isAdmin: boolean }) {
  const [items, setItems] = useState<ItemWithStock[]>([])
  const [locations, setLocations] = useState<InventoryLocation[]>([])
  const [people, setPeople] = useState<{ id: string; full_name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [locFilter, setLocFilter] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [moving, setMoving] = useState<ItemWithStock | null>(null)
  const [editing, setEditing] = useState<ItemWithStock | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  // Two people at the same shelf see each other's takes without a refresh.
  const tick = useRealtimeRefresh('inventory_stock')

  async function load() {
    const [i, l, p] = await Promise.all([
      showArchived && isAdmin ? listAllItems('consumable') : listItems('consumable'),
      listLocations(),
      listCustodyCandidates(),
    ])
    setItems(i); setLocations(l); setPeople(p); setLoading(false)
  }
  useEffect(() => { void load() }, [tick, showArchived, isAdmin])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items
      .filter(i => !q || i.name.toLowerCase().includes(q) || (i.category ?? '').toLowerCase().includes(q))
      .filter(i => !locFilter || unitsAt(i.stock, locFilter) !== 0)
      .sort(byUrgency)
  }, [items, query, locFilter])

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
      header: 'Item',
      primary: true,
      cell: i => (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={i.is_active ? 'font-medium text-gray-900' : 'text-gray-400'}>{i.name}</span>
            {!i.is_active && <Badge tone="neutral">Archived</Badge>}
            {badgeFor(i)}
            {expiryBadge(i)}
          </div>
          <p className="mt-0.5 text-xs text-gray-400">
            {[i.category, i.units_per_pack > 1 && `${i.units_per_pack} ${i.unit_label} per ${i.pack_label}`]
              .filter(Boolean).join(' · ')}
          </p>
        </div>
      ),
    },
    {
      key: 'total',
      header: 'On hand',
      mobileLabel: 'On hand',
      cell: i => <span className="tnum">{formatQty(i.total_units, i)}</span>,
    },
    {
      key: 'where',
      header: 'Where',
      cell: i => {
        const held = i.stock.filter(s => s.qty_units !== 0)
        if (!held.length) return <span className="text-gray-400">—</span>
        return (
          <div className="space-y-0.5">
            {held.map(s => (
              <div key={s.location_id} className="text-xs text-gray-600">
                {locations.find(l => l.id === s.location_id)?.name ?? 'Unknown'}:{' '}
                <span className="tnum">{formatQtyShort(s.qty_units, i)}</span>
              </div>
            ))}
          </div>
        )
      },
    },
    {
      key: 'min',
      header: 'Reorder at',
      mobileHidden: true,
      cell: i => i.min_qty_units === null
        ? <span className="text-gray-300">—</span>
        : <span className="tnum text-gray-500">{formatQtyShort(i.min_qty_units, i)}</span>,
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
            Update
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
            placeholder="Search consumables…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        <select
          className="input-base min-h-11 sm:min-h-0 sm:w-52"
          value={locFilter}
          onChange={e => setLocFilter(e.target.value)}
        >
          <option value="">All locations</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
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
          icon={Boxes}
          title={items.length ? 'Nothing matches that' : 'No consumables yet'}
          description={items.length
            ? 'Try a different search, or clear the location filter.'
            : 'Sample bottles, bacteria sticks, reagents — anything you use up and reorder.'}
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
        kind="consumable"
        item={editing}
        onClose={() => setFormOpen(false)}
        onSaved={load}
      />
    </div>
  )
}

function badgeFor(i: ItemWithStock) {
  const badge = LEVEL_BADGE[stockLevel(i.total_units, i.min_qty_units)]
  return badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : null
}

function expiryBadge(i: ItemWithStock) {
  const { status, days } = expiryStatus(i.soonest_expiry, 60)
  if (status === 'expired') return <Badge tone="danger">Expired {formatDate(i.soonest_expiry)}</Badge>
  if (status === 'expiring') return <Badge tone="warn">Expires in {days}d</Badge>
  return null
}
