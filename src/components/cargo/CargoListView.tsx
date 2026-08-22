'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Plus, Ship, Trash2, Loader2, ChevronRight, RefreshCw, Cloud, CloudOff, DownloadCloud, AlertTriangle, WifiOff, ShieldAlert } from 'lucide-react'
import { type Voyage } from '@/lib/cargo/types'
import { listVoyages, deleteVoyage, requestPersistentStorage, cargoAvailable } from '@/lib/cargo/db'
import { listRestorable, restoreVoyage, type RestorableVoyage } from '@/lib/cargo/restore'
import { currentUserId } from '@/lib/cargo/user'
import { formatVoyageRange } from '@/lib/cargo/periods'
import { createClient } from '@/lib/supabase/client'
import { withTimeout, withVesselPrefix } from '@/lib/utils'
import EmptyState from '@/components/ui/EmptyState'
import { deleteRemoteVoyage, syncAllCargo, voyageDirty } from '@/lib/cargo/sync'
import { confirmDialog } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toast'
import { displayVoyageNumber } from '@/lib/cargo/voyageNumber'

/** Cargo voyage list. Works under both /surveyor/cargo and /admin/cargo. When
 *  `embedded`, it renders as a subsection (under the admin Cargo Operations
 *  view) and is honest that these voyages live only on this browser. */
export default function CargoListView({ embedded = false }: { embedded?: boolean }) {
  const pathname = usePathname()
  const base = pathname.startsWith('/admin') ? '/admin/cargo' : '/surveyor/cargo'

  const [voyages, setVoyages] = useState<Voyage[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  // Why the list is what it is. "No voyages yet" used to be shown for all of
  // these, so a browser that could not be read looked exactly like a surveyor
  // who had not started — which is how a voyage that was safe in the cloud the
  // whole time got reported as lost.
  type Load = 'loading' | 'ok' | 'no-storage' | 'no-user' | 'error'
  const [load, setLoad] = useState<Load>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)

  // Voyages of this user that are in the cloud but not on this device.
  const [restorable, setRestorable] = useState<RestorableVoyage[]>([])
  const [cloud, setCloud] = useState<'idle' | 'checking' | 'offline' | 'error' | 'done'>('idle')
  const [restoring, setRestoring] = useState<string | null>(null)
  const [restoreProgress, setRestoreProgress] = useState<string | null>(null)
  /** Whether the browser has promised not to evict this site's storage. */
  const [durable, setDurable] = useState<boolean | null>(null)

  const pendingCount = voyages.filter(voyageDirty).length

  const checkCloud = useCallback(async (uid: string, localIds: string[]) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) { setCloud('offline'); return }
    setCloud('checking')
    try {
      setRestorable(await withTimeout(listRestorable(createClient(), uid, localIds), 10000, 'Checking the cloud'))
      setCloud('done')
    } catch {
      // Never fatal: the device's own voyages are already on screen.
      setCloud('error')
    }
  }, [])

  const refresh = useCallback(async () => {
    setLoad('loading')
    setLoadError(null)
    if (!cargoAvailable()) { setLoad('no-storage'); return }

    // Ask the browser to make this site's storage durable. Without it IndexedDB
    // is best-effort and can be evicted under disk pressure — the likeliest way
    // for a voyage to vanish from a device that never cleared anything.
    requestPersistentStorage().then(setDurable).catch(() => setDurable(null))

    let uid: string | null = null
    try { uid = await currentUserId() } catch { uid = null }
    if (!uid) { setLoad('no-user'); return }
    setUserId(uid)

    let local: Voyage[] = []
    try {
      local = await listVoyages(uid)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Unknown error')
      setLoad('error')
      return
    }
    setVoyages(local)
    setLoad('ok')
    void checkCloud(uid, local.map(v => v.id))
  }, [checkCloud])

  useEffect(() => { void refresh() }, [refresh])

  // Coming back online is the moment the cloud check becomes possible, so take
  // it rather than making the surveyor reload the page.
  useEffect(() => {
    function onOnline() { if (userId) void checkCloud(userId, voyages.map(v => v.id)) }
    function onOffline() { setCloud('offline') }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    // Both are named so both come off again — this effect re-runs whenever the
    // voyage list changes, and an inline handler would pile up a new listener
    // every time.
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [userId, voyages, checkCloud])

  async function handleRestore(r: RestorableVoyage) {
    if (!userId) return
    setRestoring(r.id)
    setRestoreProgress(r.photoCount ? `0 of ${r.photoCount} photos` : null)
    try {
      const res = await restoreVoyage(createClient(), userId, r.id, {
        onProgress: (done, total) => setRestoreProgress(total ? `${done} of ${total} photos` : null),
      })
      toast.success(`Restored ${withVesselPrefix(res.voyage.vesselName, res.voyage.vesselType)}${res.photos ? ` with ${res.photos} photo${res.photos === 1 ? '' : 's'}` : ''}.`)
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not restore that voyage.')
    } finally {
      setRestoring(null)
      setRestoreProgress(null)
    }
  }

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
            : <h1 className="page-title">Cargo Monitoring</h1>}
          <p className="text-gray-500 mt-0.5">
            {embedded
              ? 'Offline voyages on this browser — use “Sync all” to publish them to Cargo Monitoring.'
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

      {/* Storage that the browser has not promised to keep can be evicted when
          the disk runs low, taking unsynced work with it. Worth saying out loud. */}
      {durable === false && load === 'ok' && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 flex items-start gap-2">
          <ShieldAlert className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>This browser has not guaranteed to keep offline data, so it could be cleared if the device runs low on space. <strong>Sync often</strong> — a synced voyage can always be restored here.</span>
        </div>
      )}

      {load === 'loading' ? (
        <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="skeleton h-16 w-full" />)}</div>
      ) : load === 'no-storage' ? (
        <EmptyState
          icon={AlertTriangle}
          title="This browser can't store offline data"
          description="Cargo Monitoring keeps voyages on the device, which needs browser storage. A private/incognito window or a locked-down browser policy will block it. Nothing has been lost — voyages already synced are safe and can be restored from another browser."
          action={<button onClick={() => void refresh()} className="btn-secondary inline-flex"><RefreshCw className="h-4 w-4" />Try again</button>}
        />
      ) : load === 'no-user' ? (
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't confirm who's signed in"
          description="Your voyages are stored against your user account, so they can't be listed until that's known. This is NOT a sign that anything was deleted. Sign in again — then anything on this device reappears, and anything synced can be restored."
          action={<Link href="/login" className="btn-primary inline-flex">Sign in again</Link>}
        />
      ) : load === 'error' ? (
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't read this device's storage"
          description={`The voyages on this device could not be read${loadError ? ` (${loadError})` : ''}. This is a read failure, not a deletion — nothing has been removed.`}
          action={<button onClick={() => void refresh()} className="btn-secondary inline-flex"><RefreshCw className="h-4 w-4" />Try again</button>}
        />
      ) : voyages.length === 0 && restorable.length === 0 ? (
        <EmptyState
          icon={Ship}
          title="No voyages on this device"
          description={cloud === 'offline'
            ? "Nothing is stored on this device. You're offline, so voyages in the cloud can't be checked yet — reconnect and they'll appear here to restore."
            : cloud === 'error'
              ? "Nothing is stored on this device, and the cloud couldn't be checked just now. Try again before assuming a voyage is gone."
              : 'Nothing on this device, and nothing of yours in the cloud waiting to be restored.'}
          action={<Link href={`${base}/new`} className="btn-primary inline-flex"><Plus className="h-4 w-4" />Create your first voyage</Link>}
        />
      ) : (
        <div className="space-y-2">
          {voyages.map(v => (
            <div key={v.id} className="card p-0 flex items-center">
              <Link href={`${base}/${v.id}`} className="flex-1 flex items-center gap-4 p-4 min-w-0 hover:bg-gray-50 rounded-l-xl">
                <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
                  <Ship className="h-5 w-5 text-brand-600" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{withVesselPrefix(v.vesselName, v.vesselType)} — {displayVoyageNumber(v.voyageNumber)}</p>
                  <p className="text-sm text-gray-500 truncate">
                    {v.cargoType || 'Cargo'} · {v.holdCount} holds · {formatVoyageRange(v)}
                  </p>
                </div>
                <span className={`ml-auto inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${voyageDirty(v) ? 'bg-amber-100 text-amber-700' : v.lastSyncedAt ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {voyageDirty(v) ? <CloudOff className="h-3 w-3" /> : <Cloud className="h-3 w-3" />}
                  {voyageDirty(v) ? 'Pending' : v.lastSyncedAt ? 'Synced' : 'Local'}
                </span>
                <ChevronRight className="h-5 w-5 text-gray-300 flex-shrink-0" />
              </Link>
              <button onClick={() => handleDelete(v)} disabled={deleting === v.id} aria-label="Delete voyage" className="p-4 text-gray-400 transition-colors hover:text-red-600">
                {deleting === v.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Synced voyages that aren't on this device. Sync only ever pushed
          upward, so a device that lost its copy had no way back — this is it. */}
      {load === 'ok' && restorable.length > 0 && (
        <div className="card p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-brand-50 text-brand-700 p-2"><DownloadCloud className="h-4 w-4" /></div>
            <div className="min-w-0">
              <h3 className="font-semibold text-sm">In the cloud, not on this device</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Synced from another device or browser. Restore one to carry on working on it here — readings, settings and photos all come back.
              </p>
            </div>
          </div>
          <div className="space-y-2">
            {restorable.map(r => (
              <div key={r.id} className="flex items-center gap-3 rounded-lg border border-gray-200 p-3">
                <Ship className="h-4 w-4 text-gray-400 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm text-gray-900 truncate">{r.vesselName || 'Voyage'}{r.voyageNumber ? ` — ${displayVoyageNumber(r.voyageNumber)}` : ''}</p>
                  <p className="text-xs text-gray-500">
                    Last synced {new Date(r.syncedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                    {r.photoCount > 0 ? ` · ${r.photoCount} photo${r.photoCount === 1 ? '' : 's'}` : ''}
                  </p>
                </div>
                <button
                  onClick={() => handleRestore(r)}
                  disabled={restoring !== null || cloud === 'offline'}
                  className="btn-secondary whitespace-nowrap"
                >
                  {restoring === r.id
                    ? <><Loader2 className="h-4 w-4 animate-spin" />{restoreProgress ?? 'Restoring…'}</>
                    : <><DownloadCloud className="h-4 w-4" />Restore</>}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Say which half of the picture is on screen while offline, rather than
          letting a short list imply that something is missing. */}
      {load === 'ok' && cloud === 'offline' && (
        <p className="text-xs text-gray-500 flex items-center gap-1.5">
          <WifiOff className="h-3.5 w-3.5" />
          Offline — showing what&apos;s on this device. Voyages in the cloud can&apos;t be checked until you reconnect.
        </p>
      )}
      {load === 'ok' && cloud === 'error' && (
        <p className="text-xs text-gray-500 flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5" />
          Couldn&apos;t check the cloud for other voyages.{' '}
          <button onClick={() => userId && void checkCloud(userId, voyages.map(v => v.id))} className="underline hover:text-gray-700">Try again</button>
        </p>
      )}
    </div>
  )
}
