'use client'

// "Cargo voyages" card on the admin job Overview. Attach synced cargo-monitoring
// voyages to this job so their work is billed through the normal job/Finance flow
// (and shows up in reconciliation + insights). The link is server-side metadata —
// see migration 085; the surveyor device never overwrites it on sync.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Ship, Loader2, Plus, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/components/ui/toast'
import { CargoStatusPill } from '@/components/job/StatusPill'
import type { VoyageStatus } from '@/lib/cargo/types'
import { listVoyagesForJob, listUnlinkedVoyages, setVoyageJob, type LinkedVoyageRow } from '@/lib/cargo/remote'

function StatusPill({ status }: { status: string }) {
  return <CargoStatusPill status={status as VoyageStatus} />
}

function voyageLabel(v: LinkedVoyageRow): string {
  return `M.V. ${v.vessel_name || '—'}${v.voyage_number ? ` · ${v.voyage_number}` : ''}${v.owner_name ? ` — ${v.owner_name}` : ''}`
}

export default function JobCargoVoyages({ jobId, vesselName, isCargoJob = false }: { jobId: string; vesselName?: string | null; isCargoJob?: boolean }) {
  const [voyages, setVoyages] = useState<LinkedVoyageRow[] | null>(null)
  const [attaching, setAttaching] = useState(false)
  const [options, setOptions] = useState<LinkedVoyageRow[] | null>(null)
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    try { setVoyages(await listVoyagesForJob(createClient(), jobId)) }
    catch { setVoyages([]) }
  }
  useEffect(() => { load() }, [jobId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function openAttach() {
    setAttaching(true)
    setPick('')
    setOptions(null)
    try {
      const rows = await listUnlinkedVoyages(createClient())
      // Surface voyages for the same vessel first — the likely match for this job.
      const target = (vesselName ?? '').trim().toLowerCase()
      rows.sort((a, b) => {
        const am = (a.vessel_name ?? '').trim().toLowerCase() === target ? 0 : 1
        const bm = (b.vessel_name ?? '').trim().toLowerCase() === target ? 0 : 1
        return am - bm
      })
      setOptions(rows)
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not load voyages.')
      setAttaching(false)
    }
  }

  async function attach() {
    if (!pick) return
    setBusy(true)
    try {
      await setVoyageJob(createClient(), pick, jobId)
      toast.success('Voyage linked')
      setAttaching(false)
      await load()
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not link the voyage.')
    } finally {
      setBusy(false)
    }
  }

  async function detach(v: LinkedVoyageRow) {
    setBusy(true)
    try {
      await setVoyageJob(createClient(), v.id, null)
      toast.success('Voyage unlinked')
      await load()
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not unlink the voyage.')
    } finally {
      setBusy(false)
    }
  }

  // Keep non-cargo jobs uncluttered: until we know there are links, only render
  // for cargo jobs (or once the attach picker is open).
  if (voyages === null) {
    return isCargoJob ? <div className="card p-5"><div className="skeleton h-5 w-40 mb-3" /><div className="skeleton h-12 w-full" /></div> : null
  }
  if (voyages.length === 0 && !isCargoJob && !attaching) return null

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="section-title flex items-center gap-2"><Ship className="h-4 w-4 text-gray-400" /> Cargo voyages</h2>
          <p className="text-xs text-gray-400 mt-0.5">Attach synced monitoring voyages so this job bills their work.</p>
        </div>
        {!attaching && (
          <button onClick={openAttach} className="btn-secondary py-1.5 px-3 text-sm shrink-0"><Plus className="h-4 w-4" />Attach voyage</button>
        )}
      </div>

      {/* Attach picker */}
      {attaching && (
        <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3 space-y-3">
          {options === null ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-1"><Loader2 className="h-4 w-4 animate-spin" /> Loading synced voyages…</div>
          ) : options.length === 0 ? (
            <p className="text-sm text-gray-500">No unlinked voyages. Voyages appear here once a surveyor syncs them and they aren&apos;t already on another job.</p>
          ) : (
            <>
              <select value={pick} onChange={e => setPick(e.target.value)} className="input-base py-1.5 text-sm">
                <option value="">— Select a synced voyage —</option>
                {options.map(v => <option key={v.id} value={v.id}>{voyageLabel(v)}</option>)}
              </select>
              <div className="flex gap-2">
                <button onClick={attach} disabled={!pick || busy} className="btn-primary py-1.5 px-3 text-sm">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Link to this job
                </button>
                <button onClick={() => setAttaching(false)} className="btn-secondary py-1.5 px-3 text-sm">Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Linked voyages */}
      {voyages.length === 0 ? (
        !attaching && <p className="text-sm text-gray-400">No cargo voyages linked yet.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {voyages.map(v => (
            <div key={v.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <Link href={`/admin/cargo/cloud/${v.id}`} className="group flex items-center gap-2.5 min-w-0 flex-1">
                <span className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0"><Ship className="h-4 w-4 text-brand-600" /></span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-900 group-hover:text-brand-700 truncate">M.V. {v.vessel_name || '—'}</span>
                  <span className="block text-xs text-gray-500 truncate">{v.voyage_number || 'No voyage no.'}{v.owner_name ? ` · ${v.owner_name}` : ''}</span>
                </span>
              </Link>
              <StatusPill status={v.status} />
              <button onClick={() => detach(v)} disabled={busy} title="Unlink from this job" className="btn-ghost py-1 px-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 shrink-0"><X className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
