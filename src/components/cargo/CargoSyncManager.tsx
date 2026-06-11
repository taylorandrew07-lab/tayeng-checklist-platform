'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cargoAvailable, listVoyages, getPhotosForVoyage } from '@/lib/cargo/db'
import { currentUserId } from '@/lib/cargo/user'
import { syncAllCargo, voyageDirty } from '@/lib/cargo/sync'
import { reachable } from '@/lib/offline/reachable'

/**
 * Background push of cargo voyages for the logged-in staff user — uploads local
 * voyage docs + assigned photos to Supabase once back online, so clients can view
 * them. Triggers on mount / online / focus / 60s tick, gated by a real
 * connectivity probe with exponential backoff on failure.
 */
export default function CargoSyncManager() {
  useEffect(() => {
    if (!cargoAvailable()) return
    let running = false
    let cancelled = false
    let backoff = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const DELAYS = [5000, 30000, 120000]

    function schedule() {
      if (cancelled) return
      if (timer) clearTimeout(timer)
      const d = DELAYS[Math.min(backoff, DELAYS.length - 1)]
      backoff++
      timer = setTimeout(() => { void run() }, d)
    }

    async function hasPending(uid: string): Promise<boolean> {
      const voyages = await listVoyages(uid).catch(() => [])
      for (const v of voyages) {
        if (voyageDirty(v)) return true
        const photos = await getPhotosForVoyage(uid, v.id).catch(() => [])
        if (photos.some(p => p.assigned && !p.uploaded)) return true
      }
      return false
    }

    async function run() {
      if (running || cancelled) return
      running = true
      try {
        const uid = await currentUserId()
        if (!uid || cancelled) return
        if (!(await hasPending(uid))) { backoff = 0; return }
        if (!(await reachable())) { schedule(); return }
        const r = await syncAllCargo(createClient(), uid).catch(() => ({ pushed: 0, failed: 1 }))
        if (r.failed > 0) schedule()
        else backoff = 0
      } finally {
        running = false
      }
    }

    void run()
    const kick = () => { backoff = 0; void run() }
    const onVisible = () => { if (document.visibilityState === 'visible') kick() }
    window.addEventListener('online', kick)
    document.addEventListener('visibilitychange', onVisible)
    const interval = setInterval(() => { void run() }, 60_000)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      clearInterval(interval)
      window.removeEventListener('online', kick)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return null
}
