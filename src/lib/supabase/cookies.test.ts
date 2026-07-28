import { describe, it, expect } from 'vitest'
import { isAuthSessionCookie } from './cookies'

const REF = 'nbszzdnllwprkqfiyboq'

describe('isAuthSessionCookie', () => {
  it('accepts the session cookie', () => {
    expect(isAuthSessionCookie(`sb-${REF}-auth-token`)).toBe(true)
  })

  it('accepts chunked session cookies', () => {
    expect(isAuthSessionCookie(`sb-${REF}-auth-token.0`)).toBe(true)
    expect(isAuthSessionCookie(`sb-${REF}-auth-token.1`)).toBe(true)
  })

  // The regression this module exists for. Requesting a password reset writes the
  // PKCE verifier cookie; treating it as a session let a signed-out user past the
  // route guard onto a page with no session behind it — a blank screen after simply
  // clicking "Forgot password?".
  it('rejects the PKCE code-verifier cookie', () => {
    expect(isAuthSessionCookie(`sb-${REF}-auth-token-code-verifier`)).toBe(false)
  })

  it('rejects unrelated cookies', () => {
    expect(isAuthSessionCookie('te_remember')).toBe(false)
    expect(isAuthSessionCookie('te_last_email')).toBe(false)
    expect(isAuthSessionCookie('sb-something-else')).toBe(false)
    expect(isAuthSessionCookie('')).toBe(false)
  })
})
