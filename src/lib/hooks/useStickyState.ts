'use client'

// A piece of view state that survives a reload — a list filter, a chosen tab.
//
// The jobs tracker reset to "Open" on every reload, so anyone working through
// closed or invoice-ready jobs had to re-pick their filter after each edit. A
// filter is a statement about what you are working on right now; forgetting it
// on refresh is the app overruling that, several times an hour.
//
// Read in an EFFECT, never in a useState initializer: these pages render on the
// server too, where localStorage does not exist, and seeding initial state from
// it is the classic hydration mismatch. The same rule the dashboard layout
// follows for its cached profile.

import { useCallback, useEffect, useRef, useState } from 'react'

/** Minimal shape of what we need from localStorage — lets this be tested. */
export interface StickyStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * The stored value if it is still one of `allowed`, otherwise the fallback.
 *
 * Pulled out of the hook because this is the part with a decision in it: a
 * filter retired in a later release must NOT be restored from a browser that
 * still remembers it, or the page renders an empty list with no control
 * highlighted and no obvious way back.
 */
export function readSticky<T extends string>(
  store: StickyStore | null | undefined,
  key: string,
  fallback: T,
  allowed: readonly T[]
): T {
  if (!store) return fallback
  try {
    const saved = store.getItem(key)
    return saved && (allowed as readonly string[]).includes(saved) ? (saved as T) : fallback
  } catch {
    return fallback
  }
}

/**
 * @param key      storage key — namespace it per screen, e.g. 'te_jobs_filter'
 * @param fallback used on the first ever visit, and whenever the stored value
 *                 is no longer one of `allowed`
 * @param allowed  the permitted values. A filter removed in a later release
 *                 would otherwise come back from storage and render an empty
 *                 list with no matching control highlighted.
 */
export function useStickyState<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[]
): [T, (value: T) => void, { restored: boolean }] {
  const [value, setValue] = useState<T>(fallback)
  const [restored, setRestored] = useState(false)

  // Restore once per key. Guarding on the key inside the effect (rather than
  // holding `allowed`/`fallback` in refs written during render, which the React
  // Compiler forbids) means an inline array literal for `allowed` cannot cause a
  // re-run that would clobber a choice the user has just made.
  const restoredFor = useRef<string | null>(null)

  useEffect(() => {
    if (restoredFor.current === key) return
    restoredFor.current = key
    const store = typeof window === 'undefined' ? null : window.localStorage
    setValue(readSticky(store, key, fallback, allowed))
    setRestored(true)
  }, [key, fallback, allowed])

  const set = useCallback((next: T) => {
    setValue(next)
    try {
      window.localStorage.setItem(key, next)
    } catch {
      /* not being able to remember it must never break changing it */
    }
  }, [key])

  return [value, set, { restored }]
}
