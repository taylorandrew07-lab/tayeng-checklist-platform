'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cargoAvailable } from '@/lib/cargo/db'
import { currentUserId } from '@/lib/cargo/user'
import { syncAllCargo } from '@/lib/cargo/sync'

/**
 * Background push of cargo voyages for the logged-in staff user — uploads local
 * voyage docs + assigned photos to Supabase once back online, so clients can view
 * them. Runs on mount, on reconnect, and on tab focus. Mirrors OfflineSyncManager.
 */
export default function CargoSyncManager() {
  useEffect(() => {
    if (!cargoAvailable()) return
    let running = false
    let cancelled = false

    async function run() {
      if (running || typeof navigator === 'undefined' || !navigator.onLine) return
      running = true
      try {
        const uid = await currentUserId()
        if (!uid || cancelled) return
        await syncAllCargo(createClient(), uid).catch(() => { /* retried later */ })
      } finally {
        running = false
      }
    }

    void run()
    const onOnline = () => { void run() }
    const onVisible = () => { if (document.visibilityState === 'visible') void run() }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return null
}
