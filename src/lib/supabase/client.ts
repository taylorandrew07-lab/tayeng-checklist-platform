import { createBrowserClient } from '@supabase/ssr'

// Persist the auth cookies (~400 days — the browser cap) instead of letting them
// default to session cookies. Without this, the mobile OS killing the browser /
// installed app drops the session and forces a re-login on next open. With it,
// signing in once keeps you signed in across app reopens (Supabase keeps the
// access token fresh via its refresh token). Sign-out still clears them — the
// library passes maxAge:0 per-cookie, which overrides this default.
const AUTH_COOKIE_MAX_AGE = 400 * 24 * 60 * 60

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { maxAge: AUTH_COOKIE_MAX_AGE },
    }
  )
}

// True when a Supabase auth-token cookie is present in the browser (chunked as
// sb-<ref>-auth-token[.N]). The cookies are httpOnly:false by necessity, so JS can
// read them. Used to distinguish "genuinely signed out" (no cookie → redirect to
// /login) from "session momentarily unavailable" — e.g. Android waking the PWA
// before the network is back, when getSession() transiently returns null even
// though the long-lived cookie is intact. In that case we must NOT bounce the user
// to /login. Mirrors the same check the middleware (src/proxy.ts) uses server-side.
export function hasAuthCookie(): boolean {
  if (typeof document === 'undefined') return false
  return document.cookie
    .split('; ')
    .some(c => c.startsWith('sb-') && c.includes('-auth-token'))
}
