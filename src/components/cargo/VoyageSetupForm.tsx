'use client'

import { useEffect, useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import { putVoyage, newId } from '@/lib/cargo/db'
import { currentUserId } from '@/lib/cargo/user'
import { titleCaseVesselName } from '@/lib/utils'
import { loadPickLists, type PickLists } from '@/lib/cargo/picklists'
import {
  type Voyage, type CargoTemplate,
  defaultReadingTypes, cloneReadingTypes, HOLD_COUNT_OPTIONS, DEFAULT_HOLD_COUNT,
} from '@/lib/cargo/types'

interface Props {
  /** When provided, the form edits an existing voyage; otherwise it creates one. */
  voyage?: Voyage
  /** On create, seeds reading types + default hold count from this template. */
  seedTemplate?: CargoTemplate | null
  onSaved: (voyage: Voyage) => void
  submitLabel?: string
}

export default function VoyageSetupForm({ voyage, seedTemplate, onSaved, submitLabel }: Props) {
  const [vesselName, setVesselName] = useState(voyage?.vesselName ?? '')
  const [voyageNumber, setVoyageNumber] = useState(voyage?.voyageNumber ?? '')
  const [cargoType, setCargoType] = useState(voyage?.cargoType ?? '')
  const [loadingPort, setLoadingPort] = useState(voyage?.loadingPort ?? '')
  const [dischargePort, setDischargePort] = useState(voyage?.dischargePort ?? '')
  const [startDate, setStartDate] = useState(voyage?.startDate ?? '')
  const [endDate, setEndDate] = useState(voyage?.endDate ?? '')
  const [holdCount, setHoldCount] = useState(voyage?.holdCount ?? seedTemplate?.default_hold_count ?? DEFAULT_HOLD_COUNT)
  const [surveyorName, setSurveyorName] = useState(voyage?.surveyorName ?? '')
  const [clientId, setClientId] = useState(voyage?.clientId ?? '')
  const [clientName, setClientName] = useState(voyage?.clientName ?? '')
  const [remarks, setRemarks] = useState(voyage?.remarks ?? '')

  const [lists, setLists] = useState<PickLists>({ clients: [], surveyors: [] })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    loadPickLists().then(l => { if (active) setLists(l) })
    return () => { active = false }
  }, [])

  const haveClients = lists.clients.length > 0
  const haveSurveyors = lists.surveyors.length > 0
  // Keep the voyage's saved surveyor selectable even if it's not in the active list.
  const surveyorOptions = haveSurveyors
    ? Array.from(new Set([...lists.surveyors.map(s => s.name), ...(surveyorName ? [surveyorName] : [])]))
    : []

  async function handleSave() {
    if (!vesselName.trim()) return setError('Vessel name is required')
    if (!voyageNumber.trim()) return setError('Voyage number is required')
    if (!startDate || !endDate) return setError('Monitoring start and end dates are required')
    if (endDate < startDate) return setError('End date cannot be before start date')
    if (!surveyorName.trim()) return setError('Surveyor name is required')

    setSaving(true)
    setError(null)
    try {
      const userId = await currentUserId()
      if (!userId) throw new Error('Could not determine your user — please sign in again.')

      const now = Date.now()
      const next: Voyage = voyage
        ? { ...voyage }
        : {
            id: newId('voyage'),
            userId,
            templateId: seedTemplate?.id || null,
            templateName: seedTemplate?.name && seedTemplate.id ? seedTemplate.name : undefined,
            readingTypes: seedTemplate ? cloneReadingTypes(seedTemplate.reading_types) : defaultReadingTypes(),
            readings: {},
            periodMeta: {},
            createdAt: now,
            updatedAt: now,
          } as Voyage

      // Resolve the client: dropdown mode stores id + name snapshot; offline text mode stores name only.
      const resolvedClientName = haveClients
        ? (clientId ? (lists.clients.find(c => c.id === clientId)?.name ?? '') : '')
        : clientName.trim()

      next.vesselName = titleCaseVesselName(vesselName)
      next.voyageNumber = voyageNumber.trim()
      next.cargoType = cargoType.trim()
      next.loadingPort = loadingPort.trim()
      next.dischargePort = dischargePort.trim()
      next.startDate = startDate
      next.endDate = endDate
      next.holdCount = holdCount
      next.surveyorName = surveyorName.trim()
      next.clientId = haveClients ? (clientId || null) : null
      next.clientName = resolvedClientName || undefined
      next.remarks = remarks.trim() || undefined

      await putVoyage(next)
      onSaved(next)
    } catch (err: any) {
      setError(err?.message ?? 'Could not save the voyage.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="card p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="label-base">Vessel Name *</label>
            <input className="input-base" value={vesselName} onChange={e => setVesselName(e.target.value)} placeholder="Atlantic Spirit" />
          </div>
          <div>
            <label className="label-base">Voyage Number *</label>
            <input className="input-base" value={voyageNumber} onChange={e => setVoyageNumber(e.target.value)} placeholder="V-2026-014" />
          </div>
          <div className="sm:col-span-2">
            <label className="label-base">Cargo Type / Description</label>
            <input className="input-base" value={cargoType} onChange={e => setCargoType(e.target.value)} placeholder="Coal, iron ore, woodchips…" />
          </div>
          <div>
            <label className="label-base">Loading Port</label>
            <input className="input-base" value={loadingPort} onChange={e => setLoadingPort(e.target.value)} />
          </div>
          <div>
            <label className="label-base">Discharge Port</label>
            <input className="input-base" value={dischargePort} onChange={e => setDischargePort(e.target.value)} />
          </div>
          <div>
            <label className="label-base">Monitoring Start Date *</label>
            <input type="date" className="input-base" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="label-base">Monitoring End Date *</label>
            <input type="date" className="input-base" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
          <div>
            <label className="label-base">Number of Cargo Holds</label>
            <select className="input-base" value={holdCount} onChange={e => setHoldCount(Number(e.target.value))}>
              {HOLD_COUNT_OPTIONS.map(n => <option key={n} value={n}>{n} Hold{n > 1 ? 's' : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="label-base">Surveyor Name *</label>
            {haveSurveyors ? (
              <select className="input-base" value={surveyorName} onChange={e => setSurveyorName(e.target.value)}>
                <option value="">Select surveyor…</option>
                {surveyorOptions.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            ) : (
              <input className="input-base" value={surveyorName} onChange={e => setSurveyorName(e.target.value)} placeholder="Surveyor name" />
            )}
          </div>
          <div>
            <label className="label-base">Client</label>
            {haveClients ? (
              <select className="input-base" value={clientId} onChange={e => setClientId(e.target.value)}>
                <option value="">No client</option>
                {lists.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : (
              <input className="input-base" value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Client name (optional)" />
            )}
          </div>
          <div className="sm:col-span-2">
            <label className="label-base">Remarks</label>
            <textarea className="input-base min-h-[80px]" value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Optional" />
          </div>
        </div>

        {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
      </div>

      <div className="flex justify-end">
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : (submitLabel ?? 'Save Voyage')}
        </button>
      </div>
    </div>
  )
}
