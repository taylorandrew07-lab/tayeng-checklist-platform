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
  // Match on the message/name, NOT on `status === 0`: an AuthError with no status set
  // is simply an error we don't recognise, and reporting that as "check your
  // connection" would be its own wrong-diagnosis bug.
  if (err.name === 'AuthRetryableFetchError' || raw.includes('fetch') || raw.includes('network')) {
    return 'Could not reach the server. Check your connection and try again.'
  }
  return 'Invalid email or password. Please try again.'
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
