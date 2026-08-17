'use client'

// The full ledger. Admins, and office holding inventory.history.view.
//
// The CSV goes out through deliverFile, NOT an <a download>: an installed iPhone
// PWA has no download manager at all, so a download link there is inert. See
// lib/pdf/deliver.ts.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, History, Loader2, Undo2 } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { ResponsiveTable, type Column } from '@/components/ui/ResponsiveTable'
import { confirmDialog } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toast'
import { listAllItems, listAllLocations, listMovements, listStaffDirectory } from '@/lib/inventory/api'
import { reverseMovement } from '@/lib/inventory/movements'
import { CSV_MIME, deliverFile } from '@/lib/pdf/deliver'
import { formatDateTime } from '@/lib/utils'
import { MOVEMENT_VERB, MovementLine, movementQty, movementSentence } from './movementText'
import type { InventoryLocation, ItemWithStock, MovementDetail, StaffMember } from '@/lib/inventory/types'

const KINDS = ['receive', 'take', 'move', 'adjust', 'check_out', 'check_in', 'correction'] as const

export default function HistoryTable() {
  const [rows, setRows] = useState<MovementDetail[]>([])
  const [items, setItems] = useState<ItemWithStock[]>([])
  const [locations, setLocations] = useState<InventoryLocation[]>([])
  const [people, setPeople] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const [itemId, setItemId] = useState('')
  const [actorId, setActorId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [kind, setKind] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setRows(await listMovements({
      itemId: itemId || undefined,
      actorId: actorId || undefined,
      locationId: locationId || undefined,
      kind: kind || undefined,
      from: from ? new Date(from).toISOString() : undefined,
      // Inclusive of the whole end day, which is what a person means by "to".
      to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
      limit: 500,
    }))
    setLoading(false)
  }, [itemId, actorId, locationId, kind, from, to])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    void (async () => {
      const [i, l, p] = await Promise.all([listAllItems(), listAllLocations(), listStaffDirectory()])
      setItems(i); setLocations(l); setPeople(p)
    })()
  }, [])

  const filtered = useMemo(() => rows, [rows])

  async function undo(m: MovementDetail) {
    const ok = await confirmDialog({
      title: 'Correct this entry?',
      message: `${movementSentence(m)} — recorded by ${m.actor_name ?? 'someone'}.\n\nThis writes a correcting entry. The original stays in the history.`,
      confirmLabel: 'Correct it',
    })
    if (!ok) return
    setBusy(m.id)
    const res = await reverseMovement(m.id)
    setBusy(null)
    if (res.outcome !== 'ok') { toast.error(res.error ?? 'Could not correct that.'); return }
    toast.success('Correction recorded.')
    void load()
  }

  async function exportCsv() {
    const header = ['When', 'Item', 'What happened', 'Quantity', 'From', 'To', 'Person', 'By', 'Note', 'Corrected']
    const lines = [header, ...filtered.map(m => [
      formatDateTime(m.created_at),
      m.item_name,
      MOVEMENT_VERB[m.kind],
      movementQty(m),
      m.from_location_name ?? '',
      m.to_location_name ?? '',
      m.holder_name ?? '',
      m.actor_name ?? '',
      m.note ?? '',
      m.reversed ? 'yes' : '',
    ])]
    const csv = lines.map(r => r.map(csvCell).join(',')).join('\r\n')
    try {
      await deliverFile(new Blob([csv], { type: CSV_MIME }), 'inventory-history.csv', CSV_MIME)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save that file.')
    }
  }

  const columns: Column<MovementDetail>[] = [
    {
      key: 'when',
      header: 'When',
      className: 'w-44',
      mobileLabel: 'When',
      cell: m => <span className="tnum text-xs text-gray-500">{formatDateTime(m.created_at)}</span>,
    },
    {
      key: 'what',
      header: 'What happened',
      primary: true,
      cell: m => (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-gray-900">{m.item_name}</span>
            {m.reversed && <Badge tone="neutral">Corrected</Badge>}
            {m.kind === 'correction' && <Badge tone="warn">Correction</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-gray-500"><MovementLine m={m} /></p>
          {m.note && <p className="mt-0.5 text-xs text-gray-400">{m.note}</p>}
        </div>
      ),
    },
    {
      key: 'by',
      header: 'By',
      mobileLabel: 'By',
      cell: m => <span className="text-sm text-gray-700">{m.actor_name ?? 'Unknown'}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      mobileLabel: '',
      cell: m => (!m.reversed && m.kind !== 'correction') ? (
        <button
          className="btn-ghost min-h-11 gap-1.5 text-sm sm:min-h-0"
          onClick={() => undo(m)}
          disabled={busy === m.id}
        >
          {busy === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
          Correct
        </button>
      ) : null,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <select className="input-base" value={itemId} onChange={e => setItemId(e.target.value)}>
            <option value="">All items</option>
            {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <select className="input-base" value={actorId} onChange={e => setActorId(e.target.value)}>
            <option value="">Anyone</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
          <select className="input-base" value={locationId} onChange={e => setLocationId(e.target.value)}>
            <option value="">All locations</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select className="input-base" value={kind} onChange={e => setKind(e.target.value)}>
            <option value="">Everything</option>
            {KINDS.map(k => <option key={k} value={k}>{MOVEMENT_VERB[k]}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1">
            <label className="label-base" htmlFor="hist-from">From</label>
            <input id="hist-from" type="date" className="input-base" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div className="flex-1 space-y-1">
            <label className="label-base" htmlFor="hist-to">To</label>
            <input id="hist-to" type="date" className="input-base" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <button className="btn-secondary gap-2" onClick={exportCsv} disabled={!filtered.length}>
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={History}
          title="Nothing recorded"
          description="No movements match those filters yet."
        />
      ) : (
        <>
          <p className="text-sm text-gray-500">
            {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
            {filtered.length === 500 && ' (showing the most recent 500 — narrow the dates to see more)'}
          </p>
          <ResponsiveTable rows={filtered} columns={columns} rowKey={m => m.id} />
        </>
      )}
    </div>
  )
}

/** RFC-4180 quoting: a note containing a comma or a newline must not split the row. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}
