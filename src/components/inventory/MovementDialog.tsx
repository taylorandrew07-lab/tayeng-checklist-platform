'use client'

// Take / Add / Move / Recount for a consumable, and Check out / Check in for a
// piece of equipment. Mobile-first: this is the one inventory surface a surveyor
// uses standing at a shelf.
//
// TWO THINGS HERE ARE LOAD-BEARING:
//
// 1. clientRef is generated ONCE when the dialog opens for an item, and reused
//    for every retry INCLUDING the "Record it anyway" confirmation. That
//    confirmation is a retry of the same tap, not a new one — giving it a fresh
//    ref would let a slow first attempt land as well and double the movement.
//
// 2. The quantity is entered in packs AND loose units, and converted through
//    toBaseUnits() exactly once. The preview under the button restates the
//    result in the user's own words, so "1 box" never silently means 1 bottle.

import { useEffect, useMemo, useState } from 'react'
import { Loader2, AlertTriangle } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { QuantityStepper } from '@/components/ui/QuantityStepper'
import { toast } from '@/components/ui/toast'
import { formatQty, hasPacks, toBaseUnits, pluralise } from '@/lib/inventory/packs'
import { unitsAt } from '@/lib/inventory/stock'
import { newMovementRef, recordMovement } from '@/lib/inventory/movements'
import type { InventoryLocation, ItemWithStock, StaffMember } from '@/lib/inventory/types'

type Mode = 'take' | 'receive' | 'move' | 'adjust'

/** Order matters: surveyors first, because they take equipment out most. */
const ROLE_GROUPS: { role: string; label: string }[] = [
  { role: 'surveyor', label: 'Surveyors' },
  { role: 'admin', label: 'Admins' },
  { role: 'office', label: 'Office' },
]

interface Props {
  item: ItemWithStock | null
  locations: InventoryLocation[]
  people: StaffMember[]
  onClose: () => void
  onDone: () => void
}

export default function MovementDialog({ item, locations, people, onClose, onDone }: Props) {
  const isAsset = item?.kind === 'asset'

  const [mode, setMode] = useState<Mode>('take')
  const [packs, setPacks] = useState(0)
  const [loose, setLoose] = useState(0)
  const [counted, setCounted] = useState(0)
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [holderId, setHolderId] = useState('')
  const [expiry, setExpiry] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [shortWarning, setShortWarning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // One ref per opening of the dialog for this item — see the header.
  const [clientRef, setClientRef] = useState(newMovementRef)

  const stocked = useMemo(
    () => locations.filter(l => unitsAt(item?.stock ?? [], l.id) > 0),
    [locations, item],
  )

  useEffect(() => {
    if (!item) return
    setClientRef(newMovementRef())
    setMode(item.kind === 'asset' ? 'move' : 'take')
    setPacks(0); setLoose(item.kind === 'asset' ? 1 : 0); setCounted(0)
    setHolderId(''); setExpiry(''); setNote('')
    setShortWarning(null); setError(null); setSaving(false)
    // Default the source to wherever the stock actually is, so the common case
    // is zero taps. Only helpful when it is unambiguous.
    const withStock = locations.filter(l => unitsAt(item.stock, l.id) > 0)
    setFromId(withStock.length === 1 ? withStock[0].id : '')
    setToId(locations.length === 1 ? locations[0].id : '')
  }, [item, locations])

  if (!item) return null

  const perPack = item.units_per_pack
  const showPacks = hasPacks(item) && !isAsset
  const units = isAsset ? 1 : toBaseUnits(packs, loose, perPack)
  const sourceUnits = fromId ? unitsAt(item.stock, fromId) : 0

  const preview = (() => {
    if (mode === 'adjust') {
      if (!fromId) return null
      const delta = counted - sourceUnits
      if (delta === 0) return 'Matches what we have recorded — this will be logged as a check.'
      return `${delta > 0 ? 'Adds' : 'Removes'} ${pluralise(Math.abs(delta), item.unit_label)} — leaves ${formatQty(counted, item)}.`
    }
    if (units <= 0) return null
    if (mode === 'take') return `Leaves ${formatQty(sourceUnits - units, item)} at that location.`
    if (mode === 'receive') return `Brings that location to ${formatQty(unitsAt(item.stock, toId) + units, item)}.`
    if (mode === 'move') {
      if (!fromId || !toId) return null
      return `Leaves ${formatQty(sourceUnits - units, item)}; brings the other to ${formatQty(unitsAt(item.stock, toId) + units, item)}.`
    }
    return null
  })()

  function validate(): string | null {
    if (mode === 'adjust') return fromId ? null : 'Which location did you count?'
    if (mode === 'take') {
      if (!fromId) return 'Where are you taking it from?'
      if (units <= 0) return 'How many?'
    }
    if (mode === 'receive') {
      if (!toId) return 'Where is it going?'
      if (units <= 0) return 'How many?'
    }
    if (mode === 'move') {
      if (!fromId || !toId) return 'Pick both locations.'
      if (fromId === toId) return 'Those are the same location.'
      if (units <= 0) return 'How many?'
    }
    return null
  }

  async function submit(allowNegative = false) {
    const problem = validate()
    if (problem) { setError(problem); return }
    setSaving(true); setError(null)

    const res = await recordMovement({
      itemId: item!.id,
      kind: mode,
      qtyUnits: mode === 'adjust' ? undefined : units,
      countedUnits: mode === 'adjust' ? counted : undefined,
      packs: showPacks ? packs : null,
      fromLocationId: mode === 'take' || mode === 'move' || mode === 'adjust' ? fromId : null,
      toLocationId: mode === 'receive' || mode === 'move' ? toId : null,
      expiryDate: mode === 'receive' && expiry ? expiry : null,
      note: note || null,
      allowNegative,
      clientRef,   // same ref on the confirm — this IS the same tap
    })
    setSaving(false)

    if (res.outcome === 'short') { setShortWarning(res.error ?? null); return }
    if (res.outcome !== 'ok') { setError(res.error ?? 'Could not record that.'); return }

    toast.success(
      res.result?.warning === 'negative'
        ? 'Recorded — this item now needs a recount.'
        : 'Recorded.',
    )
    onDone(); onClose()
  }

  async function custody(kind: 'check_out' | 'check_in') {
    if (kind === 'check_out' && !holderId) { setError('Who is taking it?'); return }
    setSaving(true); setError(null)
    const res = await recordMovement({
      itemId: item!.id, kind, holderId: kind === 'check_out' ? holderId : null,
      note: note || null, clientRef,
    })
    setSaving(false)
    if (res.outcome !== 'ok') { setError(res.error ?? 'Could not record that.'); return }
    toast.success(kind === 'check_out' ? 'Checked out.' : 'Checked back in.')
    onDone(); onClose()
  }

  const modes: { value: Mode; label: string }[] = [
    { value: 'take', label: 'Take' },
    { value: 'receive', label: 'Add' },
    { value: 'move', label: 'Move' },
    { value: 'adjust', label: 'Recount' },
  ]

  return (
    <Modal
      open={!!item}
      onClose={onClose}
      size="md"
      title={item.name}
      footer={
        <>
          <button className="btn-secondary min-h-11 sm:min-h-0" onClick={onClose} disabled={saving}>Cancel</button>
          {isAsset ? (
            item.held_by ? (
              <button className="btn-primary min-h-11 sm:min-h-0" onClick={() => custody('check_in')} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}Check in
              </button>
            ) : (
              <button className="btn-primary min-h-11 sm:min-h-0" onClick={() => custody('check_out')} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}Check out
              </button>
            )
          ) : shortWarning ? (
            <button className="btn-danger min-h-11 sm:min-h-0" onClick={() => submit(true)} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}Record it anyway
            </button>
          ) : (
            <button className="btn-primary min-h-11 sm:min-h-0" onClick={() => submit(false)} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {modes.find(m => m.value === mode)?.label}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          {isAsset
            ? item.held_by
              ? `Held by ${item.holder_name ?? 'someone'}.`
              : 'In stores.'
            : `On hand: ${formatQty(item.total_units, item)}`}
        </p>

        {isAsset ? (
          <>
            {!item.held_by && (
              <div className="space-y-1">
                <label className="label-base" htmlFor="mv-holder">Who is taking it?</label>
                {/* Grouped by role so it is obvious who you are picking — the list
                    mixes surveyors, admins and office staff, and two people can
                    easily share a first name. */}
                <select
                  id="mv-holder" className="input-base min-h-11"
                  value={holderId} onChange={e => setHolderId(e.target.value)}
                >
                  <option value="">Choose a person…</option>
                  {ROLE_GROUPS.map(g => {
                    const members = people.filter(p => p.role === g.role)
                    if (!members.length) return null
                    return (
                      <optgroup key={g.role} label={g.label}>
                        {members.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                      </optgroup>
                    )
                  })}
                </select>
                {people.length === 0 && (
                  <p className="text-xs text-amber-700">
                    No active staff to pick from — check the Team page.
                  </p>
                )}
              </div>
            )}
            {item.held_by && (
              <p className="text-sm text-gray-600">
                Checking it in returns it to stores and clears who is holding it.
              </p>
            )}
          </>
        ) : (
          <>
            <SegmentedControl
              value={mode}
              onChange={m => { setMode(m); setShortWarning(null); setError(null) }}
              options={modes}
              ariaLabel="What are you doing?"
              className="w-full"
            />

            {(mode === 'take' || mode === 'move' || mode === 'adjust') && (
              <div className="space-y-1">
                <label className="label-base" htmlFor="mv-from">
                  {mode === 'adjust' ? 'Which location did you count?' : 'From'}
                </label>
                <select
                  id="mv-from" className="input-base min-h-11"
                  value={fromId}
                  onChange={e => { setFromId(e.target.value); setShortWarning(null) }}
                >
                  <option value="">Choose a location…</option>
                  {(mode === 'adjust' ? locations : stocked.length ? stocked : locations).map(l => (
                    <option key={l.id} value={l.id}>
                      {l.name} — {formatQty(unitsAt(item.stock, l.id), item)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {(mode === 'receive' || mode === 'move') && (
              <div className="space-y-1">
                <label className="label-base" htmlFor="mv-to">To</label>
                <select
                  id="mv-to" className="input-base min-h-11"
                  value={toId} onChange={e => setToId(e.target.value)}
                >
                  <option value="">Choose a location…</option>
                  {locations.filter(l => l.id !== fromId).map(l => (
                    <option key={l.id} value={l.id}>
                      {l.name} — {formatQty(unitsAt(item.stock, l.id), item)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {mode === 'adjust' ? (
              <QuantityStepper
                label={`How many ${item.unit_label === 'unit' ? 'units' : item.unit_label} are actually there?`}
                value={counted}
                onChange={v => { setCounted(v); setShortWarning(null) }}
                hint={fromId ? `We have ${formatQty(sourceUnits, item)} recorded.` : undefined}
                id="mv-counted"
              />
            ) : (
              <div className={showPacks ? 'grid grid-cols-2 gap-3' : ''}>
                {showPacks && (
                  <QuantityStepper
                    label={item.pack_label.charAt(0).toUpperCase() + item.pack_label.slice(1)}
                    value={packs}
                    onChange={v => { setPacks(v); setShortWarning(null) }}
                    hint={`of ${perPack}`}
                    id="mv-packs"
                  />
                )}
                <QuantityStepper
                  label={showPacks ? 'Loose' : 'How many'}
                  value={loose}
                  onChange={v => { setLoose(v); setShortWarning(null) }}
                  hint={showPacks ? item.unit_label : undefined}
                  id="mv-loose"
                />
              </div>
            )}

            {mode === 'receive' && (
              <div className="space-y-1">
                <label className="label-base" htmlFor="mv-expiry">Expiry date (optional)</label>
                <input
                  id="mv-expiry" type="date" className="input-base min-h-11"
                  value={expiry} onChange={e => setExpiry(e.target.value)}
                />
                <p className="text-xs text-gray-500">Applies to this location&apos;s stock.</p>
              </div>
            )}
          </>
        )}

        <div className="space-y-1">
          <label className="label-base" htmlFor="mv-note">Note (optional)</label>
          <input
            id="mv-note" className="input-base min-h-11" value={note}
            onChange={e => setNote(e.target.value)} placeholder="What it is for, who it is for…"
          />
        </div>

        {preview && !shortWarning && (
          <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">{preview}</p>
        )}

        {shortWarning && (
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p>{shortWarning}</p>
              <p className="mt-1 text-amber-700">
                If that is what you really took, record it — the item will be flagged for a recount.
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}
      </div>
    </Modal>
  )
}
