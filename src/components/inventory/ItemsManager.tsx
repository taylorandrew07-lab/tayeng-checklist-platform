'use client'

// The catalogue — admin only. A modal rather than inline editing, because an
// item has fifteen-odd fields and the pack and calibration groups only apply to
// one kind each.
//
// `kind` is fixed at creation and read-only afterwards: migration 190's
// inventory_items_kind_shape CHECK means flipping a consumable that already has
// pack settings into equipment would be rejected by the database anyway, and the
// stock it carries would no longer make sense.

import { useEffect, useState } from 'react'
import { Archive, ArchiveRestore, Boxes, Gauge, Loader2, Package, Pencil, Plus, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { ResponsiveTable, type Column } from '@/components/ui/ResponsiveTable'
import { confirmDialog } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toast'
import EmptyState from '@/components/ui/EmptyState'
import { createItem, listAllItems, updateItem, type ItemInput } from '@/lib/inventory/api'
import { archiveItemWithPrompt, removeItemWithPrompt } from '@/lib/inventory/removeItem'
import { nextDueDate } from '@/lib/inventory/calibration'
import { formatQtyShort } from '@/lib/inventory/packs'
import type { InventoryKind, ItemWithStock, ServiceStatus } from '@/lib/inventory/types'

const SERVICE: { value: ServiceStatus; label: string }[] = [
  { value: 'in_service', label: 'In service' },
  { value: 'out_for_calibration', label: 'Away for calibration' },
  { value: 'out_of_service', label: 'Out of service' },
  { value: 'retired', label: 'Retired' },
]

type Form = {
  kind: InventoryKind
  name: string
  category: string
  sku: string
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
  kind,
  name: '', category: '', sku: '', notes: '',
  unit_label: kind === 'asset' ? 'unit' : 'unit',
  pack_label: 'box',
  units_per_pack: '1',
  min_qty_units: '', reorder_qty_units: '',
  serial_number: '', manufacturer: '', model: '',
  calibrated_at: '', calibration_due: '', calibration_interval_months: '',
  calibration_note: '', service_status: 'in_service',
})

export default function ItemsManager() {
  const [rows, setRows] = useState<ItemWithStock[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ItemWithStock | null>(null)
  const [form, setForm] = useState<Form>(blank('consumable'))
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setRows(await listAllItems())
    setLoading(false)
  }
  useEffect(() => { void load() }, [])

  function openCreate(kind: InventoryKind) {
    setEditing(null); setForm(blank(kind)); setError(null); setOpen(true)
  }

  function openEdit(i: ItemWithStock) {
    setEditing(i); setError(null); setOpen(true)
    setForm({
      kind: i.kind,
      name: i.name,
      category: i.category ?? '',
      sku: i.sku ?? '',
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
  }

  const isAsset = form.kind === 'asset'
  const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s))

  async function save() {
    const name = form.name.trim()
    if (!name) { setError('Give it a name.'); return }

    const perPack = isAsset ? 1 : Math.max(1, Math.trunc(Number(form.units_per_pack) || 1))

    // Changing a pack size after stock exists keeps every base-unit count
    // correct but shifts how they READ ("3 boxes of 24" becomes "6 boxes of 12").
    // Past entries are safe — the ledger stores units_per_pack_at_time.
    if (editing && !isAsset && perPack !== editing.units_per_pack && editing.total_units !== 0) {
      const ok = await confirmDialog({
        title: 'Change the pack size?',
        message: `${editing.name} currently holds ${formatQtyShort(editing.total_units, editing)}.\n\nThe actual count stays exactly the same — only how it is grouped changes. Past history keeps the old pack size.`,
        confirmLabel: 'Change it',
      })
      if (!ok) return
    }

    const payload: ItemInput = {
      kind: form.kind,
      name,
      category: form.category.trim() || null,
      sku: form.sku.trim() || null,
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
    const res = editing ? await updateItem(editing.id, payload) : await createItem(payload)
    setSaving(false)
    if (res.error) { setError(res.error); return }
    toast.success(editing ? 'Item saved' : 'Item added')
    setOpen(false); void load()
  }

  // Both go through lib/inventory/removeItem.ts, so Manage asks exactly the same
  // question the Stock and Equipment rows ask.
  async function remove(i: ItemWithStock) {
    const result = await removeItemWithPrompt(i, { isAdmin: true })
    if (result === 'deleted') void load()
  }

  async function archive(i: ItemWithStock) {
    const result = await archiveItemWithPrompt(i)
    if (result === 'archived') void load()
  }

  // Offer the next due date the moment there is enough to compute one, but never
  // apply it silently — the certificate is the authority, not our arithmetic.
  const suggestedDue = isAsset
    ? nextDueDate(form.calibrated_at || null, numOrNull(form.calibration_interval_months))
    : null

  const columns: Column<ItemWithStock>[] = [
    {
      key: 'name',
      header: 'Item',
      primary: true,
      cell: i => (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={i.is_active ? 'font-medium text-gray-900' : 'text-gray-400'}>{i.name}</span>
            <Badge tone={i.kind === 'asset' ? 'brand' : 'neutral'}>
              {i.kind === 'asset' ? 'Equipment' : 'Consumable'}
            </Badge>
            {!i.is_active && <Badge tone="neutral">Archived</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-gray-400">
            {i.kind === 'asset'
              ? [i.manufacturer, i.model, i.serial_number && `s/n ${i.serial_number}`].filter(Boolean).join(' · ') || '—'
              : [i.category, i.units_per_pack > 1 && `${i.units_per_pack} ${i.unit_label} per ${i.pack_label}`]
                  .filter(Boolean).join(' · ') || '—'}
          </p>
        </div>
      ),
    },
    {
      key: 'stock',
      header: 'On hand',
      mobileLabel: 'On hand',
      cell: i => <span className="tnum text-sm text-gray-600">{formatQtyShort(i.total_units, i)}</span>,
    },
    {
      key: 'min',
      header: 'Reorder at',
      mobileHidden: true,
      cell: i => i.min_qty_units === null
        ? <span className="text-gray-300">—</span>
        : <span className="tnum text-sm text-gray-500">{formatQtyShort(i.min_qty_units, i)}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      mobileLabel: '',
      cell: i => (
        <div className="flex items-center justify-end gap-1">
          <button className="btn-ghost px-2" onClick={() => openEdit(i)} aria-label={`Edit ${i.name}`}>
            <Pencil className="h-4 w-4 text-gray-400" />
          </button>
          <button
            className="btn-ghost px-2"
            onClick={() => archive(i)}
            aria-label={i.is_active ? `Archive ${i.name}` : `Restore ${i.name}`}
            title={i.is_active ? 'Archive — hides it but keeps the record' : 'Restore'}
          >
            {i.is_active
              ? <Archive className="h-4 w-4 text-gray-400" />
              : <ArchiveRestore className="h-4 w-4 text-gray-400" />}
          </button>
          <button
            className="btn-ghost px-2"
            onClick={() => remove(i)}
            aria-label={`Delete ${i.name}`}
            title="Delete"
          >
            <Trash2 className="h-4 w-4 text-gray-400 transition-colors hover:text-red-600" />
          </button>
        </div>
      ),
    },
  ]

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="section-title">Items</h2>
          <p className="mt-1 text-sm text-gray-500">
            Consumables are counted; equipment is one physical thing with a certificate.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary gap-2" onClick={() => openCreate('consumable')}>
            <Package className="h-4 w-4" /> Consumable
          </button>
          <button className="btn-primary gap-2" onClick={() => openCreate('asset')}>
            <Gauge className="h-4 w-4" /> Equipment
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No items yet"
          description="Add your sample bottles, bacteria sticks and gauges to get started."
          action={
            <button className="btn-primary gap-2" onClick={() => openCreate('consumable')}>
              <Plus className="h-4 w-4" /> Add the first item
            </button>
          }
        />
      ) : (
        <ResponsiveTable rows={rows} columns={columns} rowKey={i => i.id} />
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="xl"
        title={editing ? `Edit ${editing.name}` : isAsset ? 'Add equipment' : 'Add a consumable'}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setOpen(false)} disabled={saving}>Cancel</button>
            <button className="btn-primary gap-2" onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? 'Saving…' : editing ? 'Save' : 'Add'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Name" hint={isAsset ? 'One row per physical unit — three identical detectors are three items.' : undefined}>
              <input className="input-base" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoFocus />
            </Field>
            <Field label="Category" hint="Free text — Sampling, Safety, Test equipment…">
              <input className="input-base" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} />
            </Field>
          </div>

          {isAsset ? (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Field label="Manufacturer">
                  <input className="input-base" value={form.manufacturer} onChange={e => setForm({ ...form, manufacturer: e.target.value })} />
                </Field>
                <Field label="Model">
                  <input className="input-base" value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} />
                </Field>
                <Field label="Serial number">
                  <input className="input-base" value={form.serial_number} onChange={e => setForm({ ...form, serial_number: e.target.value })} />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Field label="Last calibrated">
                  <input type="date" className="input-base" value={form.calibrated_at} onChange={e => setForm({ ...form, calibrated_at: e.target.value })} />
                </Field>
                <Field label="Interval (months)" hint="Only used to suggest the next date.">
                  <input type="number" min={1} className="input-base" value={form.calibration_interval_months}
                    onChange={e => setForm({ ...form, calibration_interval_months: e.target.value })} />
                </Field>
                <Field
                  label="Next due"
                  hint={suggestedDue && suggestedDue !== form.calibration_due ? undefined : 'Reminders fire 60, 30 and 7 days before, and again when it passes.'}
                >
                  <input type="date" className="input-base" value={form.calibration_due} onChange={e => setForm({ ...form, calibration_due: e.target.value })} />
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
                  <input className="input-base" value={form.calibration_note} onChange={e => setForm({ ...form, calibration_note: e.target.value })} />
                </Field>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Field label="Unit" hint="What one of them is called — bottle, stick.">
                  <input className="input-base" value={form.unit_label} onChange={e => setForm({ ...form, unit_label: e.target.value })} />
                </Field>
                <Field label="Pack" hint="What a full pack is called — box, case.">
                  <input className="input-base" value={form.pack_label} onChange={e => setForm({ ...form, pack_label: e.target.value })} />
                </Field>
                <Field label="Units per pack" hint="Leave at 1 if it isn't packed.">
                  <input type="number" min={1} className="input-base" value={form.units_per_pack}
                    onChange={e => setForm({ ...form, units_per_pack: e.target.value })} />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label={`Reorder at (${form.unit_label || 'units'})`} hint="Leave blank for no low-stock warning.">
                  <input type="number" min={0} className="input-base" value={form.min_qty_units}
                    onChange={e => setForm({ ...form, min_qty_units: e.target.value })} />
                </Field>
                <Field label={`Order up to (${form.unit_label || 'units'})`} hint="Optional — what a sensible restock looks like.">
                  <input type="number" min={0} className="input-base" value={form.reorder_qty_units}
                    onChange={e => setForm({ ...form, reorder_qty_units: e.target.value })} />
                </Field>
              </div>
            </>
          )}

          <Field label="Notes">
            <textarea className="input-base" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </Field>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}
        </div>
      </Modal>
    </div>
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
