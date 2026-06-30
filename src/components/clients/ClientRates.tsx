'use client'

// Per-client billing rates — pick a client, set fixed/hourly/per-unit rates by
// job type, and see at a glance which clients have rates entered. Lives under the
// Clients hub (was a Finance tab) so client billing sits with the client record.

import { useState, useEffect } from 'react'
import { Plus, Loader2, Save, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/components/ui/confirm'
import { cn } from '@/lib/utils'
import { CURRENCIES, money, listJobTypes } from '@/lib/jobs/tracker'
import { listClientRates, addClientRate, updateClientRate, deleteClientRate } from '@/lib/jobs/invoicing'
import type { Client, ClientRate, Currency } from '@/lib/types/database'

export default function ClientRates() {
  const [clients, setClients] = useState<Client[]>([])
  const [clientId, setClientId] = useState('')
  const [rates, setRates] = useState<ClientRate[]>([])
  const [allRates, setAllRates] = useState<ClientRate[]>([])
  const [jobTypes, setJobTypes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)

  const loadAll = async () => setAllRates(await listClientRates())

  useEffect(() => {
    (async () => {
      const supabase = createClient()
      const [{ data: cli }, jt, all] = await Promise.all([
        supabase.from('clients').select('*').order('name'),
        listJobTypes(),
        listClientRates(),
      ])
      setClients((cli ?? []) as Client[])
      setJobTypes(jt.map(t => t.name))
      setAllRates(all)
      setLoading(false)
    })()
  }, [])

  async function loadRates(id: string) { setRates(id ? await listClientRates(id) : []) }
  useEffect(() => { loadRates(clientId) }, [clientId])

  // Refresh both the selected client's rates and the cross-client overview.
  function afterChange() { loadRates(clientId); loadAll() }

  if (loading) return <div className="skeleton h-32 w-full" />

  // Group every entered rate by client for the at-a-glance overview.
  const clientById = new Map(clients.map(c => [c.id, c]))
  const byClient = new Map<string, ClientRate[]>()
  for (const r of allRates) { const a = byClient.get(r.client_id) ?? []; a.push(r); byClient.set(r.client_id, a) }
  const withRates = [...byClient.entries()]
    .map(([cid, rs]) => ({ client: clientById.get(cid), rs }))
    .filter((x): x is { client: Client; rs: ClientRate[] } => !!x.client)
    .sort((a, b) => a.client.name.localeCompare(b.client.name))
  const activeCount = clients.filter(c => c.is_active).length
  const selected = clientId ? clientById.get(clientId) : undefined

  return (
    <div className="space-y-5">
      <div className="max-w-sm">
        <label className="label-base">Client</label>
        <select value={clientId} onChange={e => setClientId(e.target.value)} className="input-base">
          <option value="">— Select a client —</option>
          {clients.filter(c => c.is_active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {clientId && (
        <div className="card divide-y divide-gray-100">
          <div className="px-4 py-2.5 text-sm font-medium text-gray-700">{selected?.name ?? 'Client'} — rates</div>
          {rates.length === 0 && !adding && <p className="p-5 text-sm text-gray-400">No rates set for this client. Jobs will start blank.</p>}
          {rates.map(r => <RateRow key={r.id} rate={r} jobTypes={jobTypes} onChanged={afterChange} />)}
          {adding && <RateEditor clientId={clientId} jobTypes={jobTypes} onDone={() => { setAdding(false); afterChange() }} />}
          {!adding && (
            <div className="p-4">
              <button onClick={() => setAdding(true)} className="btn-secondary py-1.5 px-3 text-sm"><Plus className="h-4 w-4" /> Add rate</button>
            </div>
          )}
        </div>
      )}

      {/* Overview: which clients actually have rates entered */}
      <div>
        <h3 className="section-title mb-2">Clients with rates <span className="text-xs font-normal text-gray-400">· {withRates.length} of {activeCount}</span></h3>
        {withRates.length === 0 ? (
          <div className="card p-6 text-center text-sm text-gray-400">No client rates entered yet. Pick a client above and add their rates.</div>
        ) : (
          <div className="card divide-y divide-gray-50">
            {withRates.map(({ client, rs }) => (
              <button key={client.id} onClick={() => setClientId(client.id)}
                className={cn('w-full text-left flex items-start justify-between gap-3 px-4 py-3 hover:bg-gray-50/60 transition-colors', clientId === client.id && 'bg-brand-50/50')}>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{client.name}{!client.is_active && <span className="text-[10px] text-gray-400 ml-1.5">inactive</span>}</p>
                  <p className="text-xs text-gray-500 truncate">{rs.map(r => `${r.job_type || 'Any'} · ${rateSummary(r)}`).join('   ·   ')}</p>
                  {rs.some(r => r.notes) && <p className="text-[11px] text-gray-400 truncate mt-0.5">{rs.filter(r => r.notes).map(r => r.notes).join('  ·  ')}</p>}
                </div>
                <span className="text-xs text-gray-400 tnum shrink-0">{rs.length} rate{rs.length === 1 ? '' : 's'}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const RATE_TYPES: [ClientRate['rate_type'], string][] = [['fixed', 'Fixed'], ['hourly', 'Hourly'], ['per_unit', 'Per unit'], ['per_km', 'Per km (mileage)']]

function rateSummary(r: ClientRate): string {
  const base = money(Number(r.rate), r.currency)
  if (r.rate_type === 'hourly') return `${base} / hr`
  if (r.rate_type === 'per_km') return `${base} / km`
  if (r.rate_type === 'per_unit') return `${base} / ${r.unit_label || 'unit'}`
  return base
}

function RateRow({ rate, jobTypes, onChanged }: { rate: ClientRate; jobTypes: string[]; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  if (editing) return <RateEditor clientId={rate.client_id} jobTypes={jobTypes} existing={rate} onDone={() => { setEditing(false); onChanged() }} />
  async function del() {
    if (!(await confirmDialog({ title: 'Delete rate?', message: 'Remove this billing rate?', confirmLabel: 'Delete', danger: true }))) return
    const res = await deleteClientRate(rate.id)
    if (res.error) { toast.error(res.error); return }
    toast.success('Rate deleted'); onChanged()
  }
  return (
    <div className="flex items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900">{rate.job_type || 'Any job type'} <span className="text-xs text-gray-400 font-normal">· {RATE_TYPES.find(t => t[0] === rate.rate_type)?.[1]}</span></p>
        <p className="text-sm text-gray-600 tnum">{rateSummary(rate)}</p>
        {rate.notes && <p className="text-xs text-gray-500 mt-0.5 whitespace-pre-wrap">{rate.notes}</p>}
      </div>
      <div className="flex items-center gap-1">
        <button onClick={() => setEditing(true)} className="text-xs text-brand-600 hover:text-brand-800 font-medium px-2">Edit</button>
        <button onClick={del} className="btn-ghost py-1 px-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50"><X className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  )
}

function RateEditor({ clientId, jobTypes, existing, onDone }: { clientId: string; jobTypes: string[]; existing?: ClientRate; onDone: () => void }) {
  const [jobType, setJobType] = useState(existing?.job_type ?? '')
  const [rateType, setRateType] = useState<ClientRate['rate_type']>(existing?.rate_type ?? 'fixed')
  const [rate, setRate] = useState(existing ? String(existing.rate) : '')
  const [unitLabel, setUnitLabel] = useState(existing?.unit_label ?? '')
  const [currency, setCurrency] = useState<Currency>(existing?.currency ?? 'USD')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    const payload = { client_id: clientId, job_type: jobType || null, rate_type: rateType, rate: Number(rate) || 0, unit_label: rateType === 'per_unit' ? (unitLabel || null) : rateType === 'per_km' ? 'km' : null, currency, notes: notes.trim() || null }
    const res = existing ? await updateClientRate(existing.id, payload) : await addClientRate(payload as any)
    setSaving(false)
    if (res.error) { toast.error(res.error); return }
    toast.success(existing ? 'Rate updated' : 'Rate added'); onDone()
  }

  const cell = 'input-base py-1.5 text-sm'
  return (
    <div className="p-4 bg-gray-50/60 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] text-gray-400">Job type</label>
          <select value={jobType} onChange={e => setJobType(e.target.value)} className={cell}>
            <option value="">Any job type</option>
            {jobTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-gray-400">Rate type</label>
          <select value={rateType} onChange={e => setRateType(e.target.value as ClientRate['rate_type'])} className={cell}>
            {RATE_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-gray-400">Rate</label>
          <input type="number" min={0} step="0.01" value={rate} onChange={e => setRate(e.target.value)} className={cell} />
        </div>
        <div>
          <label className="text-[11px] text-gray-400">Currency</label>
          <select value={currency} onChange={e => setCurrency(e.target.value as Currency)} className={cell}>{CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}</select>
        </div>
        {rateType === 'per_unit' && (
          <div className="sm:col-span-2">
            <label className="text-[11px] text-gray-400">Unit label</label>
            <input value={unitLabel} onChange={e => setUnitLabel(e.target.value)} placeholder="e.g. vessel" className={cell} />
          </div>
        )}
        <div className="sm:col-span-2">
          <label className="text-[11px] text-gray-400">Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="e.g. Draught survey — initial USD 700, final USD 500" className="input-base py-1.5 text-sm resize-y" />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={save} disabled={saving || !rate} className="btn-primary py-1.5 px-3 text-sm">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save</button>
        <button onClick={onDone} className="btn-secondary py-1.5 px-3 text-sm">Cancel</button>
      </div>
    </div>
  )
}
