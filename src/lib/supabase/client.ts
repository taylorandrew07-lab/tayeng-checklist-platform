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
