import { describe, it, expect } from 'vitest'
import { voyageIdFromPath } from './voyageIdFromPath'

describe('voyageIdFromPath', () => {
  it('reads the voyage id from either surveyor or admin paths', () => {
    expect(voyageIdFromPath('/surveyor/cargo/voyage_c00eb38b')).toBe('voyage_c00eb38b')
    expect(voyageIdFromPath('/admin/cargo/voyage_c00eb38b')).toBe('voyage_c00eb38b')
    expect(voyageIdFromPath('/surveyor/cargo/voyage_abc/')).toBe('voyage_abc')
  })

  it('never mistakes a sibling static route for a voyage', () => {
    // Serving the voyage workspace for these would be a bug, not a fallback.
    for (const p of ['/surveyor/cargo/new', '/admin/cargo/register', '/admin/cargo/cloud']) {
      expect(voyageIdFromPath(p)).toBeNull()
    }
    // __shell__ is the placeholder the service worker fetches to prime the
    // offline app shell — it is never a real voyage.
    expect(voyageIdFromPath('/surveyor/cargo/__shell__')).toBeNull()
  })

  it('returns null off the cargo routes entirely', () => {
    expect(voyageIdFromPath('/surveyor/cargo')).toBeNull()
    expect(voyageIdFromPath('/surveyor/jobs/abc')).toBeNull()
    expect(voyageIdFromPath('/')).toBeNull()
  })

  it('ignores a query string or hash', () => {
    expect(voyageIdFromPath('/surveyor/cargo/voyage_x?tab=readings')).toBe('voyage_x')
    expect(voyageIdFromPath('/surveyor/cargo/voyage_x#photos')).toBe('voyage_x')
  })

  it('decodes an encoded id', () => {
    expect(voyageIdFromPath('/surveyor/cargo/voyage%20a')).toBe('voyage a')
  })
})
