'use client'

// Add or edit one item. Shared by the Consumables and Equipment tabs, which each
// own their own catalogue — there is no separate "Items" list any more.
//
// `kind` is fixed at creation and never editable afterwards. Migration 190's
// inventory_items_kind_shape CHECK would reject the flip anyway (equipment has no
// pack size, a consumable has no calibration date), and any stock the item
// carries would stop making sense.

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { confirmDialog } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toast'
import { createItem, updateItem, type ItemInput } from '@/lib/inventory/api'
import { nextDueDate } from '@/lib/inventory/calibration'
import { formatQtyShort } from '@/lib/inventory/packs'
import type { InventoryKind, ItemWithStock, ServiceStatus } from '@/lib/inventory/types'

const SERVICE: { value: ServiceStatus; label: string }[] = [
  { value: 'in_service', label: 'In service' },
  { value: 'out_for_calibration', label: 'Away for calibration' },
  { value: 'out_of_service', label: 'Out of service' },
  { value: 'retired', label: 'Retired' },
]

interface Form {
  name: string
  category: string
  notes: string
  unit_label: string
  pack_label: string
  units_per_pack: string
  min_qty_units: string
  reorder_qty_units: string
  serial_number: string
  manufacturer: string
  model: string
  calibrated_at: string
  calibration_due: string
  calibration_interval_months: string
  calibration_note: string
  service_status: ServiceStatus
}

const blank = (kind: InventoryKind): Form => ({
  name: '', category: '', notes: '',
  unit_label: kind === 'asset' ? 'unit' : 'bottle',
  pack_label: 'box',
  units_per_pack: '1',
  min_qty_units: '', reorder_qty_units: '',
  serial_number: '', manufacturer: '', model: '',
  calibrated_at: '', calibration_due: '', calibration_interval_months: '',
  calibration_note: '', service_status: 'in_service',
})

const fromItem = (i: ItemWithStock): Form => ({
  name: i.name,
  category: i.category ?? '',
  notes: i.notes ?? '',
  unit_label: i.unit_label,
  pack_label: i.pack_label,
  units_per_pack: String(i.units_per_pack),
  min_qty_units: i.min_qty_units === null ? '' : String(i.min_qty_units),
  reorder_qty_units: i.reorder_qty_units === null ? '' : String(i.reorder_qty_units),
  serial_number: i.serial_number ?? '',
  manufacturer: i.manufacturer ?? '',
  model: i.model ?? '',
  calibrated_at: i.calibrated_at ?? '',
  calibration_due: i.calibration_due ?? '',
  calibration_interval_months: i.calibration_interval_months === null ? '' : String(i.calibration_interval_months),
  calibration_note: i.calibration_note ?? '',
  service_status: i.service_status,
})

interface Props {
  open: boolean
  /** Which kind to create. Ignored when `item` is set — kind is never editable. */
  kind: InventoryKind
  item: ItemWithStock | null
  onClose: () => void
  onSaved: () => void
}

export default function ItemFormModal({ open, kind, item, onClose, onSaved }: Props) {
  const effectiveKind = item?.kind ?? kind
  const isAsset = effectiveKind === 'asset'

  const [form, setForm] = useState<Form>(() => blank(effectiveKind))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setForm(item ? fromItem(item) : blank(effectiveKind))
    setError(null)
    setSaving(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id, effectiveKind])

  const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s))

  // Offered the moment there is enough to compute one, never applied silently —
  // the certificate is the authority on the next due date, not our arithmetic.
  const suggestedDue = isAsset
    ? nextDueDate(form.calibrated_at || null, numOrNull(form.calibration_interval_months))
    : null

  async function save() {
    const name = form.name.trim()
    if (!name) { setError('Give it a name.'); return }

    const perPack = isAsset ? 1 : Math.max(1, Math.trunc(Number(form.units_per_pack) || 1))

    // Changing a pack size after stock exists keeps every base-unit count correct
    // but shifts how they READ ("3 boxes of 24" becomes "6 boxes of 12"). Past
    // history is safe — the ledger stores units_per_pack_at_time.
    if (item && !isAsset && perPack !== item.units_per_pack && item.total_units !== 0) {
      const ok = await confirmDialog({
        title: 'Change the pack size?',
        message: `${item.name} currently holds ${formatQtyShort(item.total_units, item)}.\n\nThe actual count stays exactly the same — only how it is grouped changes. Past history keeps the old pack size.`,
        confirmLabel: 'Change it',
      })
      if (!ok) return
    }

    const payload: ItemInput = {
      kind: effectiveKind,
      name,
      category: form.category.trim() || null,
      notes: form.notes.trim() || null,
      unit_label: form.unit_label.trim() || 'unit',
      pack_label: form.pack_label.trim() || 'pack',
      units_per_pack: perPack,
      min_qty_units: isAsset ? null : numOrNull(form.min_qty_units),
      reorder_qty_units: isAsset ? null : numOrNull(form.reorder_qty_units),
      serial_number: isAsset ? form.serial_number.trim() || null : null,
      manufacturer: isAsset ? form.manufacturer.trim() || null : null,
      model: isAsset ? form.model.trim() || null : null,
      calibrated_at: isAsset ? form.calibrated_at || null : null,
      calibration_due: isAsset ? form.calibration_due || null : null,
      calibration_interval_months: isAsset ? numOrNull(form.calibration_interval_months) : null,
      calibration_note: isAsset ? form.calibration_note.trim() || null : null,
      service_status: isAsset ? form.service_status : 'in_service',
    }

    setSaving(true)
    const res = item ? await updateItem(item.id, payload) : await createItem(payload)
    setSaving(false)
    if (res.error) { setError(res.error); return }
    toast.success(item ? 'Saved' : `${name} added`)
    onSaved()
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={item ? `Edit ${item.name}` : isAsset ? 'Add equipment' : 'Add a consumable'}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary gap-2" onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? 'Saving…' : item ? 'Save' : 'Add'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field
            label="Name"
            hint={isAsset ? 'One row per physical unit — three identical detectors are three items.' : undefined}
          >
            <input className="input-base" value={form.name} autoFocus
              onChange={e => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Category" hint="Free text — Sampling, Safety, Test equipment…">
            <input className="input-base" value={form.category}
              onChange={e => setForm({ ...form, category: e.target.value })} />
          </Field>
        </div>

        {isAsset ? (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="Manufacturer">
                <input className="input-base" value={form.manufacturer}
                  onChange={e => setForm({ ...form, manufacturer: e.target.value })} />
              </Field>
              <Field label="Model">
                <input className="input-base" value={form.model}
                  onChange={e => setForm({ ...form, model: e.target.value })} />
              </Field>
              <Field label="Serial number">
                <input className="input-base" value={form.serial_number}
                  onChange={e => setForm({ ...form, serial_number: e.target.value })} />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="Last calibrated">
                <input type="date" className="input-base" value={form.calibrated_at}
                  onChange={e => setForm({ ...form, calibrated_at: e.target.value })} />
              </Field>
              <Field label="Interval (months)" hint="Only used to suggest the next date.">
                <input type="number" min={1} className="input-base" value={form.calibration_interval_months}
                  onChange={e => setForm({ ...form, calibration_interval_months: e.target.value })} />
              </Field>
              <Field
                label="Next due"
                hint={suggestedDue && suggestedDue !== form.calibration_due
                  ? undefined
                  : 'Reminders go out 60, 30 and 7 days before, and again when it passes.'}
              >
                <input type="date" className="input-base" value={form.calibration_due}
                  onChange={e => setForm({ ...form, calibration_due: e.target.value })} />
                {suggestedDue && suggestedDue !== form.calibration_due && (
                  <button
                    type="button"
                    className="mt-1 text-xs text-brand-700 underline"
                    onClick={() => setForm({ ...form, calibration_due: suggestedDue })}
                  >
                    Use {suggestedDue}
                  </button>
                )}
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Status">
                <select className="input-base" value={form.service_status}
                  onChange={e => setForm({ ...form, service_status: e.target.value as ServiceStatus })}>
                  {SERVICE.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Certificate / who calibrates it">
                <input className="input-base" value={form.calibration_note}
                  onChange={e => setForm({ ...form, calibration_note: e.target.value })} />
              </Field>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="Unit" hint="What one of them is called — bottle, stick.">
                <input className="input-base" value={form.unit_label}
                  onChange={e => setForm({ ...form, unit_label: e.target.value })} />
              </Field>
              <Field label="Pack" hint="What a full pack is called — box, case.">
                <input className="input-base" value={form.pack_label}
                  onChange={e => setForm({ ...form, pack_label: e.target.value })} />
              </Field>
              <Field label="Units per pack" hint="Leave at 1 if it isn't packed.">
                <input type="number" min={1} className="input-base" value={form.units_per_pack}
                  onChange={e => setForm({ ...form, units_per_pack: e.target.value })} />
              </Field>
            </div>

            {/* Restate the pack maths in the user's own words, so "24" is never
                ambiguous between "24 per box" and "24 boxes". */}
            {Number(form.units_per_pack) > 1 && (
              <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
                One {form.pack_label.trim() || 'pack'} holds {form.units_per_pack}{' '}
                {form.unit_label.trim() || 'unit'}
                {Number(form.units_per_pack) === 1 ? '' : 's'}.
              </p>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field
                label={`Reorder at (${form.unit_label.trim() || 'units'})`}
                hint="Leave blank for no low-stock warning."
              >
                <input type="number" min={0} className="input-base" value={form.min_qty_units}
                  onChange={e => setForm({ ...form, min_qty_units: e.target.value })} />
              </Field>
              <Field
                label={`Order up to (${form.unit_label.trim() || 'units'})`}
                hint="Optional — what a sensible restock looks like."
              >
                <input type="number" min={0} className="input-base" value={form.reorder_qty_units}
                  onChange={e => setForm({ ...form, reorder_qty_units: e.target.value })} />
              </Field>
            </div>
          </>
        )}

        <Field label="Notes">
          <textarea className="input-base" rows={2} value={form.notes}
            onChange={e => setForm({ ...form, notes: e.target.value })} />
        </Field>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}
      </div>
    </Modal>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="label-base">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  )
}
