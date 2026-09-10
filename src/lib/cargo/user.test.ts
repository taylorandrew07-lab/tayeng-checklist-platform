import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The surveyor field on New Voyage is seeded from this. It runs dockside, so
// what matters is the ORDER: anything already on the device beats a round trip.
const state = {
  sessionUserId: 'u-1' as string | null,
  fullName: 'A. Taylor' as string | null,
  profileCalls: 0,
  throwOnClient: false,
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    if (state.throwOnClient) throw new Error('offline')
    return {
      auth: { getSession: async () => ({ data: { session: state.sessionUserId ? { user: { id: state.sessionUserId } } : null } }) },
      from: (table: string) => {
        if (table !== 'profiles') throw new Error(`unexpected table ${table}`)
        state.profileCalls++
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { full_name: state.fullName }, error: null }) }) }) }
      },
    }
  },
}))

import { currentUserName } from './user'

let store: Record<string, string> = {}
let storageThrows = false

beforeEach(() => {
  store = {}
  storageThrows = false
  Object.assign(state, { sessionUserId: 'u-1', fullName: 'A. Taylor', profileCalls: 0, throwOnClient: false })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => { if (storageThrows) throw new Error('storage unavailable'); return store[k] ?? null },
    setItem: (k: string, v: string) => { store[k] = v },
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('currentUserName', () => {
  it('uses the cached profile without touching the database', async () => {
    store.te_profile = JSON.stringify({ id: 'u-1', full_name: 'N. Ramkissoon', role: 'surveyor' })
    expect(await currentUserName()).toBe('N. Ramkissoon')
    // The whole point: no round trip on a form that opens with no signal.
    expect(state.profileCalls).toBe(0)
  })

  it('falls back to the database when there is no cache', async () => {
    expect(await currentUserName()).toBe('A. Taylor')
    expect(state.profileCalls).toBe(1)
  })

  it('treats a cached profile with a blank name as no answer', async () => {
    store.te_profile = JSON.stringify({ id: 'u-1', full_name: '   ' })
    expect(await currentUserName()).toBe('A. Taylor')
    expect(state.profileCalls).toBe(1)
  })

  it('survives unreadable storage, unparseable JSON and a dead client', async () => {
    storageThrows = true
    expect(await currentUserName()).toBe('A. Taylor')

    storageThrows = false
    store.te_profile = 'not json'
    expect(await currentUserName()).toBe('A. Taylor')

    state.throwOnClient = true
    expect(await currentUserName()).toBe('')
  })

  it('returns empty rather than throwing when nobody is signed in', async () => {
    state.sessionUserId = null
    expect(await currentUserName()).toBe('')
    expect(state.profileCalls).toBe(0)
  })

  it('returns empty when the profile has no name — never the string "null"', async () => {
    state.fullName = null
    expect(await currentUserName()).toBe('')
  })
})
