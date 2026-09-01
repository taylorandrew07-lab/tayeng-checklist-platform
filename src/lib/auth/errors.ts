import type { AuthError } from '@supabase/supabase-js'

// Sign-in used to report EVERY failure as "Invalid email or password", which is
// actively misleading: a rate-limited, unconfirmed, deactivated or offline user was
// told their password was wrong, so they "corrected" a password that was already
// right — and each retry pushed them further into the rate limit.
//
// Supabase's built-in mailer allows only a couple of auth emails per hour
// project-wide, so hitting a send limit is a normal, expected state here and has to
// read differently from a bad credential.
export function signInErrorMessage(err: AuthError): string {
  const code = err.code ?? ''
  const status = err.status ?? 0
  const raw = (err.message ?? '').toLowerCase()

  if (code === 'invalid_credentials' || raw.includes('invalid login credentials')) {
    return 'Invalid email or password. Please try again.'
  }
  if (code === 'email_not_confirmed' || raw.includes('email not confirmed')) {
    // Deliberately names the action that actually works. "Ask an administrator to
    // activate your account" sent admins to the Activate toggle, which only writes
    // profiles.is_active and cannot clear this error — so the user was told to ask for
    // the one thing that provably wouldn't help.
    return 'Your email address has not been confirmed. Ask your administrator to set a password for you directly (Team → Password) — that confirms your email at the same time.'
  }
  if (code === 'user_banned' || raw.includes('banned')) {
    return 'This account has been suspended. Please contact your administrator.'
  }
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || status === 429) {
    return 'Too many attempts. Please wait a few minutes and try again — your password may well be correct.'
  }
  if (status >= 500) {
    return 'The sign-in service is temporarily unavailable. Please try again in a moment.'
  }
  if (isNetworkAuthError(err)) {
    return NETWORK_SIGNIN_MESSAGE
  }
  return 'Invalid email or password. Please try again.'
}

// The headline for a transport failure. The login page REPLACES this with a probed,
// specific diagnosis (see lib/auth/connectivity.ts) — it stands alone only for the
// moment before the probe returns.
export const NETWORK_SIGNIN_MESSAGE =
  'Could not reach the server. Checking your connection…'

// True when sign-in failed at the transport layer rather than on credentials.
//
// Match on the message/name, NOT on `status === 0`: an AuthError with no status set
// is simply an error we don't recognise, and reporting that as "check your
// connection" would be its own wrong-diagnosis bug.
//
// Exported so the login page can decide whether to run a connectivity probe without
// string-matching the user-facing copy — the two drifted apart the moment the copy
// was reworded.
export function isNetworkAuthError(err: AuthError): boolean {
  const raw = (err.message ?? '').toLowerCase()
  return err.name === 'AuthRetryableFetchError' || raw.includes('fetch') || raw.includes('network')
}

// Failures that come back on the email-link round trip. Supabase appends these to
// the redirect as a URL *fragment* (#error=…&error_code=…), which never reaches the
// server — so they have to be read client-side.
export function emailLinkErrorMessage(errorCode: string): string | null {
  switch (errorCode) {
    case 'otp_expired':
      // "Request a new one" was a dead end: nothing in the app can resend a
      // *confirmation* link, and these links are routinely spent before the user taps
      // them (mail scanners follow the URL). Point at the path that needs no email.
      return 'That link has expired or has already been used. Ask your administrator to set a password for you directly — they can do it without email.'
    case 'access_denied':
      return 'That link is no longer valid. Please request a new one.'
    case 'pending':
      return 'Your account is pending administrator approval. Please wait for an admin to activate your account.'
    case 'verifier_missing':
      return 'Please open the reset link in the same browser you requested it from. If you tapped it from your email app, copy the link and paste it into your normal browser instead.'
    case 'exchange_failed':
      return 'That link could not be verified — it may have expired, already been used, or been opened in a different browser. Please request a new one.'
    case 'auth_callback_failed':
      return 'Authentication failed. Please try again or contact your administrator.'
    case 'no_profile':
      return 'Your sign-in worked but your account profile could not be loaded. Please contact your administrator.'
    default:
      return null
  }
}

// Reads both ?error=… (server redirect) and #error_code=… / #error=… (Supabase's
// fragment) from the current URL, newest-wins, and returns a human message.
export function readAuthErrorFromUrl(search: string, hash: string): string | null {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const h = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)

  // The fragment carries the more specific reason when both are present.
  const code = h.get('error_code') || h.get('error') || q.get('error')
  if (!code) return null

  const mapped = emailLinkErrorMessage(code)
  if (mapped) return mapped

  const described = h.get('error_description') || q.get('error_description')
  return described ? decodeURIComponent(described.replace(/\+/g, ' ')) : null
}

// Did the DATABASE actually answer?
//
// The dashboard used to treat "no profile row came back" as proof the account was
// gone, and responded by calling signOut() — which destroys a perfectly good
// session. But `data` is null for two completely different reasons: a real RLS
// denial / deleted row, and a fetch that never reached PostgREST at all. Surveyors
// reconnect constantly, and this codebase already documents that navigator.onLine
// lies for the first seconds after a PWA wakes (JobChecklistEditor), so the
// "am I offline?" guard in front of that signOut could not be trusted.
//
// This is the conservative test in the safe direction: only a structured PostgREST
// / Postgres error counts as a definite answer. Anything else — a TypeError from a
// rejected fetch, an aborted request, an empty error, a gateway's HTML error page —
// is treated as "we don't know", and the caller must NOT sign the user out on a
// "don't know". A genuinely deleted profile then costs one retry and a plain shell;
// a transient blip no longer costs the user their session.
export function isDefiniteDbError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  if (typeof code !== 'string' || code === '') return false
  // PostgREST codes (PGRST116 = zero rows from .single()) and 5-character Postgres
  // SQLSTATEs (e.g. 42501 insufficient_privilege) both mean the request was served.
  return /^PGRST/.test(code) || /^[0-9A-Z]{5}$/.test(code)
}
