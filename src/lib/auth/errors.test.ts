import { describe, it, expect } from 'vitest'
import type { AuthError } from '@supabase/supabase-js'
import { signInErrorMessage, readAuthErrorFromUrl } from './errors'

function authError(partial: Partial<AuthError>): AuthError {
  return { name: 'AuthApiError', message: '', ...partial } as AuthError
}

describe('signInErrorMessage', () => {
  it('reports a genuinely wrong password as such', () => {
    const msg = signInErrorMessage(authError({ code: 'invalid_credentials' }))
    expect(msg).toMatch(/invalid email or password/i)
  })

  // The core complaint: a correct password reported as wrong. Rate limiting,
  // unconfirmed email and outages must each read differently, or the user retypes a
  // password that was already right.
  it('does NOT blame the password for a rate limit', () => {
    const msg = signInErrorMessage(authError({ status: 429 }))
    expect(msg).not.toMatch(/invalid email or password/i)
    expect(msg).toMatch(/too many attempts/i)
  })

  it('does NOT blame the password for an unconfirmed email', () => {
    const msg = signInErrorMessage(authError({ code: 'email_not_confirmed' }))
    expect(msg).not.toMatch(/invalid email or password/i)
    expect(msg).toMatch(/not been confirmed/i)
  })

  it('does NOT blame the password for a server outage', () => {
    const msg = signInErrorMessage(authError({ status: 503 }))
    expect(msg).not.toMatch(/invalid email or password/i)
    expect(msg).toMatch(/temporarily unavailable/i)
  })

  it('does NOT blame the password for a banned user', () => {
    const msg = signInErrorMessage(authError({ code: 'user_banned' }))
    expect(msg).toMatch(/suspended/i)
  })

  it('falls back to the credential message for anything unrecognised', () => {
    expect(signInErrorMessage(authError({ message: 'something odd' }))).toMatch(/invalid email or password/i)
  })
})

describe('readAuthErrorFromUrl', () => {
  // Supabase returns link failures as a URL fragment, which never reaches the
  // server — this is the only place they can be surfaced.
  it('reads an expired link from the hash fragment', () => {
    const msg = readAuthErrorFromUrl('', '#error=access_denied&error_code=otp_expired')
    expect(msg).toMatch(/expired or has already been used/i)
  })

  it('reads our own ?error= redirect', () => {
    expect(readAuthErrorFromUrl('?error=pending', '')).toMatch(/pending administrator approval/i)
    expect(readAuthErrorFromUrl('?error=no_profile', '')).toMatch(/profile could not be loaded/i)
  })

  it('explains the wrong-browser PKCE failure specifically', () => {
    expect(readAuthErrorFromUrl('?error=verifier_missing', '')).toMatch(/same browser/i)
  })

  it('prefers the fragment code over the query code', () => {
    const msg = readAuthErrorFromUrl('?error=auth_callback_failed', '#error_code=otp_expired')
    expect(msg).toMatch(/expired/i)
  })

  it('returns null when there is no error at all', () => {
    expect(readAuthErrorFromUrl('', '')).toBeNull()
    expect(readAuthErrorFromUrl('?next=/reset-password', '')).toBeNull()
  })

  it('falls back to the human description for an unmapped code', () => {
    const msg = readAuthErrorFromUrl('', '#error_code=weird_thing&error_description=Something+specific+broke')
    expect(msg).toBe('Something specific broke')
  })
})
