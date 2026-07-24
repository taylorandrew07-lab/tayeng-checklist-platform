// One save-status indicator for every auto-saving surface (checklist, template
// editor, invoice editor) so the state reads the same everywhere: a spinner while
// writing, an amber note while there are un-pushed changes, a green tick once saved.
// Auto-save means nobody presses Save — this is how they KNOW it saved.

import { Loader2, Check, CircleDot } from 'lucide-react'

export function SaveStatus({ saving, dirty, savedAt, className }: {
  saving: boolean
  dirty: boolean
  savedAt?: Date | null
  className?: string
}) {
  const base = `inline-flex items-center gap-1.5 text-xs ${className ?? ''}`
  if (saving) return <span className={`${base} text-gray-400`}><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</span>
  if (dirty) return <span className={`${base} text-amber-600 font-medium`}><CircleDot className="h-3.5 w-3.5" />Unsaved…</span>
  if (savedAt) return <span className={`${base} text-gray-400`}><Check className="h-3.5 w-3.5 text-green-600" />Saved</span>
  return null
}
