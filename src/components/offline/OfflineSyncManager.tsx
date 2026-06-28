'use client'

import { createClient } from '@/lib/supabase/client'
import { offlineAvailable, getPendingDrafts } from '@/lib/offline/db'
import { syncDraft } from '@/lib/offline/sync'
import { useBackgroundSync } from '@/lib/hooks/useBackgroundSync'

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
  useBackgroundSync({
    enabled: offlineAvailable(),
    // Read the session LOCALLY (getSession, no network) rather than getUser (a
    // network token validation) — this runs on mount/focus/online/60s and must
    // stay offline-first. The reachable() probe in the hook gates the actual push,
    // and syncDraft fails safely if the token is genuinely stale.
    getUserId: async () => {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession().catch(() => ({ data: { session: null } } as any))
      return session?.user?.id ?? null
    },
    hasPending: async (userId) => {
      const pending = await getPendingDrafts(userId).catch(() => [])
      return pending.length > 0
    },
    flush: async (userId, isCancelled) => {
      const supabase = createClient()
      const pending = await getPendingDrafts(userId).catch(() => [])
      let anyFail = false
      for (const d of pending) {
        if (isCancelled()) break
        const r = await syncDraft(supabase, d.jobId).catch(() => null)
        if (!r || r.ok === false) anyFail = true
      }
      const remaining = await getPendingDrafts(userId).catch(() => [])
      return { ok: remaining.length === 0 && !anyFail }
    },
  })
  return null
}
