// Real connectivity check — never trust navigator.onLine alone (it only means a
// local link exists, not that Supabase is reachable). A lightweight, timed GET to
// the Supabase auth health endpoint; failure → treat as offline and back off.

export async function reachable(timeoutMs = 4000): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) return typeof navigator === 'undefined' ? true : navigator.onLine
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    // Send the anon key (the health endpoint returns 401 without it on current
    // Supabase projects). And treat ANY HTTP response — even a 4xx — as "online":
    // a reply at all proves the server is reachable. (Only a network failure throws.)
    // Without this the probe answered "offline" forever after the project move, so
    // offline-queued submissions never synced.
    const res = await fetch(`${url}/auth/v1/health`, {
      method: 'GET', cache: 'no-store', signal: ctrl.signal,
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '' },
    })
    clearTimeout(t)
    return res.status > 0
  } catch {
    return false
  }
}
