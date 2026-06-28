'use client'

import { createClient } from '@/lib/supabase/client'
import { cargoAvailable, listVoyages, getPhotosForVoyage } from '@/lib/cargo/db'
import { currentUserId } from '@/lib/cargo/user'
import { syncAllCargo, voyageDirty } from '@/lib/cargo/sync'
import { useBackgroundSync } from '@/lib/hooks/useBackgroundSync'

/**
 * Background push of cargo voyages for the logged-in staff user — uploads local
 * voyage docs + assigned photos to Supabase once back online, so clients can view
 * them. Triggers on mount / online / focus / 60s tick, gated by a real
 * connectivity probe with exponential backoff on failure.
 */
export default function CargoSyncManager() {
  useBackgroundSync({
    enabled: cargoAvailable(),
    getUserId: () => currentUserId(),
    hasPending: async (uid) => {
      const voyages = await listVoyages(uid).catch(() => [])
      for (const v of voyages) {
        if (voyageDirty(v)) return true
        const photos = await getPhotosForVoyage(uid, v.id).catch(() => [])
        if (photos.some(p => p.assigned && !p.uploaded)) return true
      }
      return false
    },
    flush: async (uid) => {
      const r = await syncAllCargo(createClient(), uid).catch(() => ({ pushed: 0, failed: 1 }))
      return { ok: r.failed === 0 }
    },
  })
  return null
}
