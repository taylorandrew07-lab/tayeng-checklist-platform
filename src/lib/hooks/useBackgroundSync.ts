'use client'

import { useEffect } from 'react'
import { reachable } from '@/lib/offline/reachable'

/**
 * Shared background-sync state machine for the logged-in staff user. Extracted from
 * OfflineSyncManager (pending checklist drafts) and CargoSyncManager (cargo voyages)
 * which were ~95% identical.
 *
 * Triggers: mount, `online`, tab focus, and a 60s tick. Before each flush it does a
 * real connectivity probe (reachable(), not just navigator.onLine). On failure it
 * backs off (5s → 30s → 2min) and retries; success/empty resets the backoff.
 *
 * Callers inject their specifics:
 *  - enabled   — gate the whole effect (e.g. offlineAvailable()/cargoAvailable()).
 *  - getUserId — resolve the current user id (offline-first; no network if possible).
 *  - hasPending(userId) — is there anything to push? Empty resets backoff, no probe.
 *  - flush(userId) — push it; return { ok } where ok=false reschedules with backoff.
 *
 * `isCancelled()` (passed to hasPending/flush) reports unmount mid-run, so a flush
 * that loops over items can stop early — matching the original per-item guard.
 */
export function useBackgroundSync(opts: {
  enabled?: boolean
  getUserId: () => Promise<string | null>
  hasPending: (userId: string, isCancelled: () => boolean) => Promise<boolean>
  flush: (userId: string, isCancelled: () => boolean) => Promise<{ ok: boolean }>
}): void {
  const { enabled = true, getUserId, hasPending, flush } = opts
  useEffect(() => {
    // Gate checked inside the (mount-once) effect, mirroring the original managers
    // which read offlineAvailable()/cargoAvailable() in the effect body.
    if (!enabled) return
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
        const isCancelled = () => cancelled
        const uid = await getUserId()
        if (!uid || cancelled) return
        if (!(await hasPending(uid, isCancelled))) { backoff = 0; return }
        if (!(await reachable())) { schedule(); return }
        const r = await flush(uid, isCancelled)
        if (!r.ok) schedule()
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
