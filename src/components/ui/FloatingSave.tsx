'use client'

// One floating Save control for the whole app. Forms auto-save on their own, but
// some people want a button to press — so this pill floats at the bottom of the
// page (sticky, follows the scroll) on every save-bearing surface. It shows the
// live auto-save state (Saving… / Unsaved… / Saved) AND lets you flush a save on
// demand. On CREATE forms (no record yet) it IS the create button — pass label
// e.g. "Create Job".
//
//   <FloatingSave onSave={handleSave} saving={saving} dirty={isDirty} savedAt={lastSaved} />
//   <FloatingSave onSave={handleCreate} saving={saving} dirty label="Create Job" />
//
// Render it as the LAST element inside the form's content column so `sticky` sticks
// it to the viewport bottom while scrolling.

import { Save, Loader2 } from 'lucide-react'
import { SaveStatus } from '@/components/ui/SaveStatus'
import { cn } from '@/lib/utils'

export function FloatingSave({ onSave, saving, dirty, savedAt, label = 'Save', disabled, className }: {
  onSave: () => void | Promise<void>
  saving: boolean
  dirty: boolean
  savedAt?: Date | null
  label?: string
  disabled?: boolean
  className?: string
}) {
  return (
    // pointer-events-none on the row so it never blocks clicks on the content it
    // floats over; the pill itself re-enables them.
    <div className={cn('sticky bottom-4 z-30 flex justify-end pointer-events-none', className)}>
      <div className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-gray-200 bg-white/95 backdrop-blur pl-3.5 pr-2 py-1.5 shadow-lg">
        <SaveStatus saving={saving} dirty={dirty} savedAt={savedAt} />
        <button
          type="button"
          onClick={onSave}
          disabled={saving || disabled}
          aria-label={label}
          className="btn-primary rounded-full min-h-11 sm:min-h-0 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : label}
        </button>
      </div>
    </div>
  )
}
