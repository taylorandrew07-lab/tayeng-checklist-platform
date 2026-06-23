import { useEffect, useRef } from 'react'

/**
 * Debounced auto-save. Calls `save` once, `delay` ms after `deps` last changed,
 * while `enabled` is true. The latest `save` closure always runs (kept in a ref),
 * so callers can read fresh state inside it. Errors are the caller's concern —
 * swallow them or surface them inside `save`; this hook ignores the result.
 *
 * Typical use: gate the save inside the callback (`if (!isDirty || saving) return`)
 * and pass the edited state as `deps` so each change resets the debounce. A save
 * that clears the dirty flag prevents re-firing.
 */
export function useAutoSave(
  save: () => void | Promise<void>,
  deps: unknown[],
  opts: { enabled?: boolean; delay?: number } = {},
) {
  const { enabled = true, delay = 2000 } = opts
  const saveRef = useRef(save)
  saveRef.current = save

  useEffect(() => {
    if (!enabled) return
    const t = setTimeout(() => { void Promise.resolve(saveRef.current()).catch(() => {}) }, delay)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, delay, ...deps])
}
