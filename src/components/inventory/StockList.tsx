'use client'

// The consumables board: what we have, where, and what needs ordering.
// Table on desktop, stacked cards on a phone — via ResponsiveTable, so the
// row action is never stranded off-screen behind a horizontal scroll.

import { useEffect, useMemo, useState } from 'react'
import { Boxes, Loader2, Search } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { ResponsiveTable, type Column } from '@/components/ui/ResponsiveTable'
import { listItems, listLocations, listCustodyCandidates } from '@/lib/inventory/api'
import { formatQty, formatQtyShort } from '@/lib/inventory/packs'
import { stockLevel, unitsAt, byUrgency } from '@/lib/inventory/stock'
import { expiryStatus } from '@/lib/personal-docs/api'
import { useRealtimeRefresh } from '@/lib/realtime'
import { formatDate } from '@/lib/utils'
import MovementDialog from './MovementDialog'
import ItemRowActions from './ItemRowActions'
import type { InventoryLocation, ItemWithStock } from '@/lib/inventory/types'

const LEVEL_BADGE = {
  negative: { tone: 'danger' as const, label: 'Needs recount' },
  out: { tone: 'danger' as const, label: 'Out' },
  low: { tone: 'warn' as const, label: 'Low' },
  ok: null,
}

export default function StockList({ canEdit, isAdmin }: { canEdit: boolean; isAdmin: boolean }) {
  const [items, setItems] = useState<ItemWithStock[]>([])
  const [locations, setLocations] = useState<InventoryLocation[]>([])
  const [people, setPeople] = useState<{ id: string; full_name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [locFilter, setLocFilter] = useState('')
  const [active, setActive] = useState<ItemWithStock | null>(null)

  // Two people at the same shelf see each other's takes without a refresh.
  const tick = useRealtimeRefresh('inventory_stock')

  async function load() {
    const [i, l, p] = await Promise.all([listItems('consumable'), listLocations(), listCustodyCandidates()])
    setItems(i); setLocations(l); setPeople(p); setLoading(false)
  }
  useEffect(() => { void load() }, [tick])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items
      .filter(i => !q || i.name.toLowerCase().includes(q) || (i.category ?? '').toLowerCase().includes(q))
      .filter(i => !locFilter || unitsAt(i.stock, locFilter) !== 0)
      .sort(byUrgency)
  }, [items, query, locFilter])

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
            <span className="font-medium text-gray-900">{i.name}</span>
            {badgeFor(i)}
            {expiryBadge(i)}
          </div>
          {i.category && <p className="mt-0.5 text-xs text-gray-400">{i.category}</p>}
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
            {held.map(s => {
              const loc = locations.find(l => l.id === s.location_id)
              return (
                <div key={s.location_id} className="text-xs text-gray-600">
                  {loc?.short_name ?? loc?.name ?? 'Unknown'}:{' '}
                  <span className="tnum">{formatQtyShort(s.qty_units, i)}</span>
                </div>
              )
            })}
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
          <button className="btn-secondary min-h-11 sm:min-h-0" onClick={() => setActive(i)}>Update</button>
          {/* Removing an item belongs on the item, not two tabs away in Manage —
              that is where anyone looks for it. */}
          {isAdmin && <ItemRowActions item={i} onDone={load} />}
        </div>
      ),
    }] : []),
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            className="input-base min-h-11 pl-9 sm:min-h-0"
            placeholder="Search items…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        <select
          className="input-base min-h-11 sm:min-h-0 sm:w-56"
          value={locFilter}
          onChange={e => setLocFilter(e.target.value)}
        >
          <option value="">All locations</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title={items.length ? 'Nothing matches that' : 'No items yet'}
          description={items.length
            ? 'Try a different search, or clear the location filter.'
            : 'An admin can add sample bottles, bacteria sticks and the rest under Manage.'}
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
