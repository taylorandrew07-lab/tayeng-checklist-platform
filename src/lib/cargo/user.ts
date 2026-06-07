// Resolve the current staff user's id in an offline-safe way. Prefers the locally
// persisted Supabase session (no network), then the profile cached by the dashboard
// layout. Cargo data is scoped by this id.

import { createClient } from '@/lib/supabase/client'

export async function currentUserId(): Promise<string | null> {
  try {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user?.id) return session.user.id
  } catch {
    /* offline / storage unavailable — try the cached profile */
  }
  try {
    const cached = localStorage.getItem('te_profile')
    if (cached) {
      const parsed = JSON.parse(cached)
      if (parsed?.id) return parsed.id as string
    }
  } catch {
    /* ignore */
  }
  return null
}
