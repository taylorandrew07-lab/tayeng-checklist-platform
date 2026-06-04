'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { offlineAvailable, getPendingDrafts } from '@/lib/offline/db'
import { syncDraft } from '@/lib/offline/sync'

/**
 * Background sync for the logged-in staff user: pushes any pending local drafts
 * (e.g. a checklist submitted offline) once back online — even after the editor
 * that created them has unmounted. Runs on mount, on reconnect, and on tab focus.
 */
export default function OfflineSyncManager() {
  useEffect(() => {
    if (!offlineAvailable()) return
    let running = false
    let cancelled = false

    async function syncAll() {
      if (running || typeof navigator === 'undefined' || !navigator.onLine) return
      running = true
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user || cancelled) return
        const pending = await getPendingDrafts(user.id).catch(() => [])
        for (const d of pending) {
          if (cancelled) break
          await syncDraft(supabase, d.jobId).catch(() => { /* leave queued; retried later */ })
        }
      } finally {
        running = false
      }
    }

    void syncAll()
    const onOnline = () => { void syncAll() }
    const onVisible = () => { if (document.visibilityState === 'visible') void syncAll() }
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
