import { describe, it, expect } from 'vitest'
import { readSticky, type StickyStore } from './useStickyState'

const KEYS = ['open', 'invoice_ready', 'closed', 'all'] as const
type Key = typeof KEYS[number]

function store(seed: Record<string, string> = {}): StickyStore {
  const map = new Map(Object.entries(seed))
  return {
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v) },
  }
}

describe('readSticky', () => {
  it('falls back on a first ever visit', () => {
    expect(readSticky(store(), 'te_jobs_filter', 'open' as Key, KEYS)).toBe('open')
  })

  it('restores the last choice — the whole point', () => {
    expect(readSticky(store({ te_jobs_filter: 'all' }), 'te_jobs_filter', 'open' as Key, KEYS)).toBe('all')
    expect(readSticky(store({ te_jobs_filter: 'closed' }), 'te_jobs_filter', 'open' as Key, KEYS)).toBe('closed')
  })

  it('ignores a stored value that is no longer offered', () => {
    // A filter retired in a later release would otherwise come back from a
    // browser that still remembers it, rendering an empty list with no control
    // highlighted and no obvious way back.
    expect(readSticky(store({ k: 'payment_pending' }), 'k', 'open' as Key, KEYS)).toBe('open')
    expect(readSticky(store({ k: '' }), 'k', 'open' as Key, KEYS)).toBe('open')
  })

  it('keeps screens separate by key', () => {
    const s = store({ te_jobs_filter: 'closed' })
    expect(readSticky(s, 'te_invoices_filter', 'open' as Key, KEYS)).toBe('open')
  })

  it('falls back rather than throwing when storage is unavailable', () => {
    // Server render (no window) and private-mode browsers both land here.
    expect(readSticky(null, 'k', 'open' as Key, KEYS)).toBe('open')
    const hostile: StickyStore = {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => {},
    }
    expect(readSticky(hostile, 'k', 'open' as Key, KEYS)).toBe('open')
  })

  it('supports "" as a legitimate remembered value when it is allowed', () => {
    // The office jobs screen uses '' to mean every status.
    const allowed = ['', 'in_progress', 'closed'] as const
    expect(readSticky(store({ k: 'closed' }), 'k', '' as typeof allowed[number], allowed)).toBe('closed')
    expect(readSticky(store({ k: 'in_progress' }), 'k', '' as typeof allowed[number], allowed)).toBe('in_progress')
  })
})
