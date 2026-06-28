'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { offlineAvailable, getPendingDrafts } from '@/lib/offline/db'
import { syncDraft } from '@/lib/offline/sync'
import { reachable } from '@/lib/offline/reachable'

/**
 * Background sync for the logged-in staff user: pushes any pending local drafts
 * (e.g. a checklist submitted offline) once back online — even after the editor
 * that created them has unmounted.
 *
 * Triggers: mount, `online`, tab focus, and a 60s tick. Before each flush it does
 * a real connectivity probe (not just navigator.onLine). On failure it backs off
 * (5s → 30s → 2min) and retries; success/empty resets the backoff.
 */
export default function OfflineSyncManager() {
  useEffect(() => {
    if (!offlineAvailable()) return
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

    async function run() {
      if (running || cancelled) return
      running = true
      try {
        const supabase = createClient()
        // Read the session LOCALLY (getSession, no network) rather than getUser (a
        // network token validation) — this runs on mount/focus/online/60s and must
        // stay offline-first. The reachable() probe below gates the actual push, and
        // syncDraft fails safely if the token is genuinely stale.
        const { data: { session } } = await supabase.auth.getSession().catch(() => ({ data: { session: null } } as any))
        const user = session?.user
        if (!user || cancelled) return
        const pending = await getPendingDrafts(user.id).catch(() => [])
        if (!pending.length) { backoff = 0; return }
        if (!(await reachable())) { schedule(); return }

        let anyFail = false
        for (const d of pending) {
          if (cancelled) break
          const r = await syncDraft(supabase, d.jobId).catch(() => null)
          if (!r || r.ok === false) anyFail = true
        }
        const remaining = await getPendingDrafts(user.id).catch(() => [])
        if (remaining.length > 0 || anyFail) schedule()
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
