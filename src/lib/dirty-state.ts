// Global dirty-state singleton so the Sidebar can prompt before navigating.
// Template and checklist editors register a handler; Sidebar calls requestNavigate.

let _isDirty = false
let _handler: ((dest: string) => void) | null = null

export const dirtyState = {
  get isDirty() { return _isDirty },
  set(dirty: boolean) { _isDirty = dirty },
  setHandler(fn: ((dest: string) => void) | null) { _handler = fn },
  /** Returns true if navigation should proceed immediately, false if a dialog was shown. */
  requestNavigate(dest: string): boolean {
    if (!_isDirty || !_handler) return true
    _handler(dest)
    return false
  },
}
