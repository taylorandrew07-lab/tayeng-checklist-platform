import { isAuthSessionCookie } from '@/lib/supabase/cookies'

// The full device wipe already existed — but only on the SIGN-OUT path in the
// sidebar, which is inside the app. A user who cannot get PAST the login screen can
// never reach it, so the one class of fault that a wipe cures (a stale service
// worker pinning an old build, a half-written chunked auth cookie) had no cure for
// exactly the user suffering from it. This is that escape hatch, reachable while
// signed out.
//
// CRITICAL DIFFERENCE from the sign-out wipe: this must NOT touch IndexedDB.
// `tayeng-offline` and `tayeng-cargo` hold checklist drafts, queued photos and cargo
// readings that have not reached the server yet — a surveyor hitting a login problem
// after a week at sea is precisely the person most likely to be carrying unsynced
// work. Sign-out deleting them is a deliberate choice on a shared device; deleting
// them to fix a login error would destroy days of fieldwork to cure a cache problem.

/** Expire a cookie on every path/domain scope the browser might hold it under. */
function expire(name: string) {
  const host = window.location.hostname
  // A cookie set for ".example.com" is not removed by a delete scoped to
  // "example.com", so clear both, plus the no-domain (host-only) form.
  const domains = ['', host, `.${host}`]
  for (const d of domains) {
    document.cookie =
      `${name}=; Max-Age=0; path=/;` + (d ? ` domain=${d};` : '') + ' SameSite=Lax'
  }
}

export type ResetOutcome = {
  caches: number
  workers: number
  cookies: number
}

/**
 * Clear everything device-local that can pin a broken app state, then leave the
 * caller to reload. Each step is independently guarded: a browser that refuses one
 * (iOS Private Browsing, blocked storage) must not stop the others running.
 */
export async function resetDeviceAppState(): Promise<ResetOutcome> {
  const out: ResetOutcome = { caches: 0, workers: 0, cookies: 0 }

  // 1. Service workers — the stale-build culprit.
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? []
    for (const r of regs) {
      if (await r.unregister()) out.workers++
    }
  } catch { /* unsupported or blocked */ }

  // 2. Our caches only. Never `caches.keys()` wholesale — another app on the same
  // origin is not ours to clear, and on a preview domain that is a real possibility.
  try {
    if (typeof caches !== 'undefined') {
      for (const k of await caches.keys()) {
        if (k.startsWith('tayeng-')) { await caches.delete(k); out.caches++ }
      }
    }
  } catch { /* ignore */ }

  // 3. Session cookies, including every chunk of a chunked token. A partially
  // written sb-<ref>-auth-token.0/.1 pair reads as "signed in" to the route guard in
  // proxy.ts while carrying no usable session, which bounces the user between the
  // dashboard and /login. Clearing them puts the device back to a clean signed-out
  // state rather than a contradictory one.
  try {
    for (const pair of document.cookie.split('; ')) {
      const name = pair.split('=')[0]
      if (!name) continue
      // Take the verifier too: this is a reset, and a stranded PKCE verifier is
      // itself a cause of "open the reset link in the same browser" failures.
      if (name.startsWith('sb-')) { expire(name); out.cookies++ }
    }
  } catch { /* ignore */ }

  // 4. App-local flags. te_profile is a cached role/profile copy — if it is stale or
  // corrupt the dashboard can bounce a perfectly valid session back to /login.
  // te_last_email is preserved so the user does not have to retype their address.
  try {
    for (const k of ['te_profile', 'te_remember', 'te_last_activity', 'te_ios_hint']) {
      localStorage.removeItem(k)
    }
  } catch { /* storage unavailable */ }

  return out
}
