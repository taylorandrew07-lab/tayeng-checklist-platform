'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Plus, Ship, Trash2, Loader2, ChevronRight, RefreshCw, Cloud, CloudOff } from 'lucide-react'
import { type Voyage } from '@/lib/cargo/types'
import { listVoyages, deleteVoyage, requestPersistentStorage, cargoAvailable } from '@/lib/cargo/db'
import { currentUserId } from '@/lib/cargo/user'
import { formatVoyageDate } from '@/lib/cargo/periods'
import { createClient } from '@/lib/supabase/client'
import { withTimeout } from '@/lib/utils'
import { deleteRemoteVoyage, syncAllCargo, voyageDirty } from '@/lib/cargo/sync'
import { confirmDialog } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toast'

/** Cargo voyage list. Works under both /surveyor/cargo and /admin/cargo. When
 *  `embedded`, it renders as a subsection (under the admin Cargo Operations
 *  view) and is honest that these voyages live only on this browser. */
export default function CargoListView({ embedded = false }: { embedded?: boolean }) {
  const pathname = usePathname()
  const base = pathname.startsWith('/admin') ? '/admin/cargo' : '/surveyor/cargo'

  const [voyages, setVoyages] = useState<Voyage[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  const pendingCount = voyages.filter(voyageDirty).length

  useEffect(() => {
    let active = true
    async function load() {
      if (!cargoAvailable()) { setLoading(false); return }
      void requestPersistentStorage()
      const uid = await currentUserId()
      if (!active) return
      setUserId(uid)
      if (uid) setVoyages(await listVoyages(uid))
      setLoading(false)
    }
    load()
    return () => { active = false }
  }, [])

  async function handleSyncAll() {
    if (!userId) return
    setSyncing(true)
    setSyncMsg(null)
    try {
      const r = await syncAllCargo(createClient(), userId)
      setVoyages(await listVoyages(userId))
      setSyncMsg(r.failed > 0 ? `Synced ${r.pushed}; ${r.failed} failed (try again when online).` : r.pushed > 0 ? `Synced ${r.pushed} voyage${r.pushed !== 1 ? 's' : ''}.` : 'Everything is already up to date.')
    } finally {
      setSyncing(false)
    }
  }

  async function handleDelete(v: Voyage) {
    if (!userId) return
    if (!(await confirmDialog({ title: 'Delete voyage', message: `Delete the voyage "${v.vesselName} — ${v.voyageNumber}" and all its photos? This cannot be undone.`, danger: true, confirmLabel: 'Delete' }))) return
    setDeleting(v.id)
    try {
      // If it was ever synced, remove the cloud copy first so the client loses
      // access. Requires connectivity — otherwise keep the local copy intact.
      if (v.lastSyncedAt) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          toast.error('This voyage is in the cloud. Connect to the internet to delete it, so the client copy is removed too.')
          return
        }
        try {
          await withTimeout(deleteRemoteVoyage(createClient(), v.id), 15_000, 'Deleting cloud copy')
        } catch {
          toast.error('Could not delete the cloud copy — the voyage was NOT deleted (the client can still see it). Please try again when online.')
          return
        }
      }
      await deleteVoyage(userId, v.id)
      setVoyages(await listVoyages(userId))
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          {embedded
            ? <h2 className="section-title">Voyages on this device</h2>
            : <h1 className="page-title">Cargo</h1>}
          <p className="text-gray-500 mt-0.5">
            {embedded
              ? 'Offline voyages on this browser — use “Sync all” to publish them to Cargo.'
              : 'Offline cargo hold monitoring voyages stored on this device. Sync to publish them.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleSyncAll} disabled={syncing || voyages.length === 0} className="btn-secondary">
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sync all{pendingCount > 0 ? ` (${pendingCount})` : ''}
          </button>
          <Link href={`${base}/new`} className="btn-primary"><Plus className="h-4 w-4" />New Voyage</Link>
        </div>
      </div>
      {syncMsg && <p className="text-xs text-gray-500 -mt-3">{syncMsg}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
      ) : voyages.length === 0 ? (
        <div className="card p-12 text-center">
          <Ship className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 mb-4">No voyages yet.</p>
          <Link href={`${base}/new`} className="btn-primary inline-flex"><Plus className="h-4 w-4" />Create your first voyage</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {voyages.map(v => (
            <div key={v.id} className="card p-0 flex items-center">
              <Link href={`${base}/${v.id}`} className="flex-1 flex items-center gap-4 p-4 min-w-0 hover:bg-gray-50 rounded-l-xl">
                <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
                  <Ship className="h-5 w-5 text-brand-600" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">M.V. {v.vesselName} — {v.voyageNumber}</p>
                  <p className="text-sm text-gray-500 truncate">
                    {v.cargoType || 'Cargo'} · {v.holdCount} holds · {formatVoyageDate(v.startDate)} – {formatVoyageDate(v.endDate)}
                  </p>
                </div>
                <span className={`ml-auto inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${voyageDirty(v) ? 'bg-amber-100 text-amber-700' : v.lastSyncedAt ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {voyageDirty(v) ? <CloudOff className="h-3 w-3" /> : <Cloud className="h-3 w-3" />}
                  {voyageDirty(v) ? 'Pending' : v.lastSyncedAt ? 'Synced' : 'Local'}
                </span>
                <ChevronRight className="h-5 w-5 text-gray-300 flex-shrink-0" />
              </Link>
              <button onClick={() => handleDelete(v)} disabled={deleting === v.id} className="p-4 text-gray-300 hover:text-red-500">
                {deleting === v.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
