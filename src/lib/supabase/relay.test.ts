import { describe, it, expect } from 'vitest'
import { relayUrlFor } from './client'

const SB = 'https://nbszzdnllwprkqfiyboq.supabase.co'
const APP = 'https://tayeng-checklist-platform.vercel.app'

describe('relayUrlFor', () => {
  it('maps a sign-in POST onto our own origin', () => {
    expect(relayUrlFor(`${SB}/auth/v1/token?grant_type=password`, SB, APP))
      .toBe(`${APP}/api/sb/auth/v1/token?grant_type=password`)
  })

  it('keeps the whole PostgREST query string — it IS the query', () => {
    expect(relayUrlFor(`${SB}/rest/v1/profiles?select=role&id=eq.abc`, SB, APP))
      .toBe(`${APP}/api/sb/rest/v1/profiles?select=role&id=eq.abc`)
  })

  it('handles a base with a trailing slash without doubling it', () => {
    expect(relayUrlFor(`${SB}/auth/v1/user`, `${SB}/`, APP))
      .toBe(`${APP}/api/sb/auth/v1/user`)
  })

  it('leaves non-Supabase URLs alone so nothing else is ever relayed', () => {
    expect(relayUrlFor(`${APP}/api/health`, SB, APP)).toBeNull()
    expect(relayUrlFor('https://example.com/auth/v1/token', SB, APP)).toBeNull()
    // A lookalike host must not match on prefix alone.
    expect(relayUrlFor(`${SB}.evil.test/rest/v1/x`, SB, APP)).toBeNull()
    expect(relayUrlFor(`${SB}-other.example/rest/v1/x`, SB, APP)).toBeNull()
  })

  it('returns null when no Supabase URL is configured, rather than relaying everything', () => {
    expect(relayUrlFor(`${SB}/auth/v1/token`, '', APP)).toBeNull()
  })
})
