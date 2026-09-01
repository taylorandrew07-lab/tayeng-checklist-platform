import { createBrowserClient } from '@supabase/ssr'
import { isAuthSessionCookie } from './cookies'

// Persist the auth cookies (~400 days — the browser cap) instead of letting them
// default to session cookies. Without this, the mobile OS killing the browser /
// installed app drops the session and forces a re-login on next open. With it,
// signing in once keeps you signed in across app reopens (Supabase keeps the
// access token fresh via its refresh token). Sign-out still clears them — the
// library passes maxAge:0 per-cookie, which overrides this default.
const AUTH_COOKIE_MAX_AGE = 400 * 24 * 60 * 60

const SUPABASE_BASE = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')
// Mirrors the allowlist in src/app/api/sb/[...path]/route.ts.
const RELAY_PREFIX = '/api/sb/'
const RELAY_FLAG = 'te_sb_relay'

// Some networks reach us but not Supabase — a ship's wifi that permits our Vercel
// domain and refuses nbszz….supabase.co. That is fatal rather than merely slow,
// because the app cannot open without a session and a session cannot be got
// without that host. When the direct call is REJECTED (not merely slow, not merely
// a 4xx — a genuine transport failure), retry the identical request against our own
// origin, which relays it server-side.
//
// The fallback is deliberately reactive, never the default. On a normal network the
// direct call succeeds and this code does nothing, so users keep talking to Supabase
// with their own IP and full upstream rate limiting; only a device that has already
// proved it cannot get through pays the relay's cost or loses that property. See the
// route file for the full security note.
let relayEngaged = false

function readRelayFlag(): boolean {
  if (relayEngaged) return true
  try {
    // Sticky for the tab so a reload on a blocked network does not re-pay a failed
    // direct attempt on every single request.
    relayEngaged = sessionStorage.getItem(RELAY_FLAG) === '1'
  } catch { /* storage unavailable */ }
  return relayEngaged
}

function engageRelay() {
  relayEngaged = true
  try { sessionStorage.setItem(RELAY_FLAG, '1') } catch { /* storage unavailable */ }
}

/**
 * The same-origin URL for a Supabase one, or null if it isn't a Supabase URL.
 *
 * Exported (with both bases passed in) purely so this can be tested: a silent
 * off-by-one in the slicing would send every relayed request to the wrong path and
 * the fallback would look like it simply didn't work — on a network we cannot
 * reproduce here. The query string must survive, because PostgREST puts the entire
 * query in it.
 */
export function relayUrlFor(url: string, supabaseBase: string, appOrigin: string): string | null {
  const base = supabaseBase.replace(/\/+$/, '')
  if (!base || !url.startsWith(base)) return null
  // A bare startsWith would also match `https://<base>.evil.test/…`, whose host is
  // not ours at all. The next character has to end the host — the relay route's
  // path allowlist would refuse the result anyway, but a URL matcher that accepts a
  // lookalike host is the wrong thing to have written down.
  const next = url.charAt(base.length)
  if (next !== '' && next !== '/' && next !== '?') return null
  const rest = url.slice(base.length).replace(/^\/+/, '')
  return `${appOrigin}${RELAY_PREFIX}${rest}`
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

async function resilientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const relay = relayUrlFor(urlOf(input), SUPABASE_BASE, window.location.origin)

  // A Request's body may only be read once, so keep a clone before the first
  // attempt — otherwise the retry would send an empty body and a sign-in would fail
  // as "invalid credentials" for a reason that has nothing to do with the password.
  const retryInput: RequestInfo | URL | null =
    relay === null ? null
      : input instanceof Request ? new Request(relay, input.clone())
      : relay

  if (retryInput && readRelayFlag()) return fetch(retryInput, init)

  try {
    return await fetch(input, init)
  } catch (err) {
    // Only a transport rejection reaches here; any HTTP status, including 401 and
    // 500, resolves normally and must be passed straight through untouched.
    if (!retryInput) throw err
    const res = await fetch(retryInput, init)
    // Only remember the relay once it has actually worked.
    engageRelay()
    return res
  }
}

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { maxAge: AUTH_COOKIE_MAX_AGE },
      global: { fetch: resilientFetch },
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
    .some(c => isAuthSessionCookie(c.split('=')[0]))
}
