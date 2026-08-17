'use client'

// Locations are yours to shape: add, rename, reorder, retype, deactivate, delete.
// Modelled on JobTypesManager — inline add and rename, re-fetch after every
// mutation, no optimistic updates.
//
// THE DELETE RULE, and why it is in the database rather than here:
// inventory_stock.location_id and both movement FKs are ON DELETE RESTRICT, so
// removing a location that still holds stock or appears in any history fails at
// the schema level. We catch that and offer Deactivate instead. History can
// therefore never be orphaned by a click, no matter what the UI does.

import { useEffect, useState } from 'react'
import { Check, Eye, EyeOff, Loader2, MapPin, Pencil, Plus, X } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { RowDeleteButton } from '@/components/ui/RowDeleteButton'
import { confirmDialog } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toast'
import {
  createLocation, deleteLocation, listAllLocations, updateLocation,
} from '@/lib/inventory/api'
import type { InventoryLocation, LocationKind } from '@/lib/inventory/types'

const KINDS: { value: LocationKind; label: string }[] = [
  { value: 'office', label: 'Office' },
  { value: 'store', label: 'Store room' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'vessel', label: 'Vessel' },
  { value: 'other', label: 'Other' },
]

export default function LocationsManager() {
  const [rows, setRows] = useState<InventoryLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [newShort, setNewShort] = useState('')
  const [newKind, setNewKind] = useState<LocationKind>('office')
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editShort, setEditShort] = useState('')

  async function load() {
    setRows(await listAllLocations())
    setLoading(false)
  }
  useEffect(() => { void load() }, [])

  async function add() {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    const { error } = await createLocation({
      name,
      short_name: newShort.trim() || null,
      kind: newKind,
      // Append to the end so a new location never jumps the existing order.
      sort_order: (rows.at(-1)?.sort_order ?? 0) + 10,
    })
    setBusy(false)
    if (error) { toast.error(error); return }
    setNewName(''); setNewShort(''); setNewKind('office')
    toast.success('Location added')
    void load()
  }

  function startEdit(l: InventoryLocation) {
    setEditId(l.id); setEditName(l.name); setEditShort(l.short_name ?? '')
  }

  async function saveEdit(id: string) {
    const name = editName.trim()
    if (!name) { setEditId(null); return }
    const { error } = await updateLocation(id, { name, short_name: editShort.trim() || null })
    if (error) { toast.error(error); return }
    setEditId(null); void load()
  }

  async function setKind(l: InventoryLocation, kind: LocationKind) {
    const { error } = await updateLocation(l.id, { kind })
    if (error) { toast.error(error); return }
    void load()
  }

  async function toggleActive(l: InventoryLocation) {
    if (l.is_active) {
      const ok = await confirmDialog({
        title: `Deactivate ${l.name}?`,
        message: 'It disappears from the pickers, but its stock and its history stay exactly as they are. You can turn it back on any time.',
        confirmLabel: 'Deactivate',
      })
      if (!ok) return
    }
    const { error } = await updateLocation(l.id, { is_active: !l.is_active })
    if (error) { toast.error(error); return }
    toast.success(l.is_active ? 'Deactivated' : 'Reactivated')
    void load()
  }

  async function move(l: InventoryLocation, direction: -1 | 1) {
    const index = rows.findIndex(r => r.id === l.id)
    const swap = rows[index + direction]
    if (!swap) return
    // Swap the two sort values rather than renumbering the list — one round trip
    // each, and untouched rows keep whatever spacing they had.
    const [a, b] = await Promise.all([
      updateLocation(l.id, { sort_order: swap.sort_order }),
      updateLocation(swap.id, { sort_order: l.sort_order }),
    ])
    if (a.error || b.error) { toast.error(a.error ?? b.error!); return }
    void load()
  }

  async function remove(l: InventoryLocation) {
    const { error } = await deleteLocation(l.id)
    if (!error) { toast.success('Location deleted'); void load(); return }

    // The schema refused it — offer the thing they actually want.
    const ok = await confirmDialog({
      title: `${l.name} can't be deleted`,
      message: `${error}\n\nDeactivate it instead? It leaves every picker but keeps its stock and history.`,
      confirmLabel: 'Deactivate it',
    })
    if (!ok) return
    const res = await updateLocation(l.id, { is_active: false })
    if (res.error) { toast.error(res.error); return }
    toast.success('Deactivated')
    void load()
  }

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>
  }

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h2 className="section-title flex items-center gap-2">
          <MapPin className="h-4 w-4 text-gray-400" />
          Locations
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Where stock lives. Add as many as you need — offices, store rooms, vehicles.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className="input-base flex-1"
          placeholder="Location name"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void add() }}
        />
        <input
          className="input-base sm:w-32"
          placeholder="Short"
          value={newShort}
          onChange={e => setNewShort(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void add() }}
        />
        <select className="input-base sm:w-40" value={newKind} onChange={e => setNewKind(e.target.value as LocationKind)}>
          {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        <button className="btn-primary gap-2" onClick={add} disabled={busy || !newName.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add
        </button>
      </div>

      <div className="divide-y divide-gray-100">
        {rows.map((l, index) => (
          <div key={l.id} className="flex flex-wrap items-center gap-2 py-2.5">
            {editId === l.id ? (
              <>
                <input
                  className="input-base flex-1"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void saveEdit(l.id); if (e.key === 'Escape') setEditId(null) }}
                  autoFocus
                />
                <input
                  className="input-base w-24"
                  value={editShort}
                  placeholder="Short"
                  onChange={e => setEditShort(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void saveEdit(l.id); if (e.key === 'Escape') setEditId(null) }}
                />
                <button className="btn-ghost" onClick={() => saveEdit(l.id)} aria-label="Save">
                  <Check className="h-4 w-4 text-green-600" />
                </button>
                <button className="btn-ghost" onClick={() => setEditId(null)} aria-label="Cancel">
                  <X className="h-4 w-4 text-gray-400" />
                </button>
              </>
            ) : (
              <>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={l.is_active ? 'font-medium text-gray-900' : 'text-gray-400'}>{l.name}</span>
                    {l.short_name && <span className="text-xs text-gray-400">({l.short_name})</span>}
                    {!l.is_active && <Badge tone="neutral">Inactive</Badge>}
                  </div>
                </div>

                <select
                  className="input-base w-36 py-1.5 text-sm"
                  value={l.kind}
                  onChange={e => setKind(l, e.target.value as LocationKind)}
                  aria-label={`Type of ${l.name}`}
                >
                  {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>

                <div className="flex items-center">
                  <button
                    className="btn-ghost px-2" onClick={() => move(l, -1)}
                    disabled={index === 0} aria-label={`Move ${l.name} up`}
                  >↑</button>
                  <button
                    className="btn-ghost px-2" onClick={() => move(l, 1)}
                    disabled={index === rows.length - 1} aria-label={`Move ${l.name} down`}
                  >↓</button>
                </div>

                <button className="btn-ghost" onClick={() => startEdit(l)} aria-label={`Rename ${l.name}`}>
                  <Pencil className="h-4 w-4 text-gray-400" />
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => toggleActive(l)}
                  aria-label={l.is_active ? `Deactivate ${l.name}` : `Reactivate ${l.name}`}
                >
                  {l.is_active
                    ? <Eye className="h-4 w-4 text-gray-400" />
                    : <EyeOff className="h-4 w-4 text-gray-300" />}
                </button>
                <RowDeleteButton
                  onDelete={() => remove(l)}
                  ariaLabel={`Delete ${l.name}`}
                  itemLabel={l.name}
                  confirmMessage={`Delete ${l.name}? This only works if it holds no stock and has no history — otherwise you'll be offered Deactivate.`}
                />
              </>
            )}
          </div>
        ))}
        {rows.length === 0 && (
          <p className="py-6 text-center text-sm text-gray-400">No locations yet. Add your first one above.</p>
        )}
      </div>
    </div>
  )
}
