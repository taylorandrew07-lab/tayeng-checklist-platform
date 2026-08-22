'use client'

// Super-admin corrections for a synced voyage.
//
// Laid out like the surveyor's Setup card on purpose — same labels, same order,
// same input classes — so it reads as "his screen, editable".
//
// Nothing here writes cargo_voyages. Corrections go to cargo_voyage_corrections
// (mig 195) and are merged over the document at read time, because the
// surveyor's next push replaces the whole document and would destroy anything
// written into it. See lib/cargo/corrections.ts.

import { useMemo, useState } from 'react'
import { Loader2, Save, RotateCcw, ShieldCheck, AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/components/ui/confirm'
import type { Voyage } from '@/lib/cargo/types'
import { saveCorrections } from '@/lib/cargo/remote'
import {
  docValue, staleCorrections,
  type CorrectableField, type CorrectionPatch, type CorrectionLogEntry,
} from '@/lib/cargo/corrections'

/** Label and input type per correctable field, in the surveyor's Setup order. */
const FIELDS: { key: CorrectableField; label: string; type?: 'date' | 'number'; wide?: boolean }[] = [
  { key: 'vesselName', label: 'Vessel Name' },
  { key: 'voyageNumber', label: 'Voyage Number' },
  { key: 'cargoType', label: 'Cargo Type / Description', wide: true },
  { key: 'loadingPort', label: 'Loading Port' },
  { key: 'dischargePort', label: 'Discharge Port' },
  { key: 'startDate', label: 'Monitoring Start', type: 'date' },
  { key: 'endDate', label: 'Monitoring End', type: 'date' },
  { key: 'holdCount', label: 'Number of Holds', type: 'number' },
  { key: 'surveyorName', label: 'Surveyor' },
  { key: 'clientName', label: 'Client (display name)' },
  { key: 'remarks', label: 'Remarks', wide: true },
  { key: 'observations', label: 'Voyage Observations', wide: true },
]

interface Props {
  /** The voyage as currently READ — corrections already applied. */
  voyage: Voyage
  /** The voyage as the SURVEYOR recorded it, with no corrections applied. */
  original: Voyage
  patch: CorrectionPatch | null
  onSaved: (patch: CorrectionPatch) => void
}

export default function VoyageCorrectionsPanel({ voyage, original, patch, onSaved }: Props) {
  // Seeded from the corrected view, so the boxes show what everyone else sees.
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(FIELDS.map(f => [f.key, docValue(voyage, f.key)]))
  )
  const [saving, setSaving] = useState(false)

  const stale = useMemo(() => staleCorrections(original, patch), [original, patch])

  /** Fields whose box now differs from what the surveyor actually recorded. */
  const changed = useMemo(
    () => FIELDS.filter(f => draft[f.key] !== docValue(original, f.key)).map(f => f.key),
    [draft, original]
  )

  async function handleSave() {
    setSaving(true)
    try {
      const now = new Date().toISOString()
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      const by = user?.id ?? ''

      const fields: NonNullable<CorrectionPatch['fields']> = {}
      const log: CorrectionLogEntry[] = []
      for (const f of FIELDS) {
        const from = docValue(original, f.key)
        const value = draft[f.key] ?? ''
        // Only fields that genuinely differ from the surveyor's own value are
        // stored. A correction identical to the document is not a correction —
        // keeping one would shadow him forever for no reason.
        if (value === from) continue
        fields[f.key] = { value, from, at: now, by }
        log.push({ at: now, by, field: f.key, from, to: value })
      }

      const next: CorrectionPatch = { ...(patch ?? {}), fields }
      await saveCorrections(supabase, voyage.id, next, log)
      onSaved(next)
      toast.success(log.length ? `Saved ${log.length} correction${log.length === 1 ? '' : 's'}.` : 'Corrections cleared.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save. Only a super admin may correct a voyage.')
    } finally {
      setSaving(false)
    }
  }

  async function revertAll() {
    const ok = await confirmDialog({
      title: 'Remove all corrections?',
      message: "Every field goes back to exactly what the surveyor recorded. Nothing of his is affected either way — this only removes your overrides.",
      confirmLabel: 'Remove corrections',
      danger: true,
    })
    if (!ok) return
    setDraft(Object.fromEntries(FIELDS.map(f => [f.key, docValue(original, f.key)])))
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-brand-50 border border-brand-200 p-3 text-sm text-brand-900 flex items-start gap-2">
        <ShieldCheck className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <span>
          Super-admin corrections. These are stored separately and laid over the surveyor&apos;s
          record when anyone reads it &mdash; <strong>his device is never changed</strong> and his
          work can never overwrite yours. Remove a correction at any time and his original returns.
        </span>
      </div>

      {stale.length > 0 && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>
            The surveyor has since changed {stale.length === 1 ? 'a field' : `${stale.length} fields`} you
            corrected ({stale.join(', ')}). Your correction is still being applied &mdash; check it still
            says what you want.
          </span>
        </div>
      )}

      <div className="card p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {FIELDS.map(f => {
            const surveyorValue = docValue(original, f.key)
            const isChanged = changed.includes(f.key)
            return (
              <div key={f.key} className={f.wide ? 'sm:col-span-2' : undefined}>
                <label className="label-base flex items-center gap-2">
                  {f.label}
                  {isChanged && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-brand-100 text-brand-700">corrected</span>
                  )}
                </label>
                <input
                  className="input-base"
                  type={f.type ?? 'text'}
                  value={draft[f.key] ?? ''}
                  onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                />
                {isChanged && (
                  <p className="text-[11px] text-gray-400 mt-1 truncate">
                    Surveyor recorded: {surveyorValue || '(blank)'}
                  </p>
                )}
              </div>
            )
          })}
        </div>

        <p className="text-[11px] text-gray-400 leading-relaxed mt-4 pt-3 border-t border-gray-100">
          Correcting the vessel name here fixes every report and every list, but it does <strong>not</strong> rename
          it in the vessels directory &mdash; the surveyor&apos;s device recreates that from his own spelling on
          each sync, so ask him to fix it there too. The client and the voyage status are not correctable here:
          both decide who may read the voyage, and that decision has to live on the record itself.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save corrections'}
        </button>
        <button onClick={revertAll} disabled={saving} className="btn-secondary">
          <RotateCcw className="h-4 w-4" />Reset to surveyor&apos;s record
        </button>
        {changed.length > 0 && (
          <span className="text-xs text-gray-500">
            {changed.length} field{changed.length === 1 ? '' : 's'} differ from his record
          </span>
        )}
      </div>
    </div>
  )
}
