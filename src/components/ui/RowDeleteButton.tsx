'use client'

// One delete trigger for the whole app. Trash2 (never X — X means dismiss), a
// single neutral→red idiom, a built-in confirm and a busy spinner, and it is
// keyboard-reachable (a real <button> with a focus ring). Reserve the red circle-X
// overlay for image thumbnails only; use this everywhere else a record is deleted.
//
//   <RowDeleteButton onDelete={() => remove(id)} itemLabel="this client" />
//
// Pass `confirm={false}` only when the caller already ran its own confirm.

import { useState } from 'react'
import { Trash2, Loader2 } from 'lucide-react'
import { confirmDialog } from '@/components/ui/confirm'

interface Props {
  /** The delete action. May be async; the spinner shows until it resolves. */
  onDelete: () => void | Promise<void>
  /** Show a text label beside the icon (default icon-only). */
  label?: string
  /** Accessible name when icon-only (default "Delete"). */
  ariaLabel?: string
  /** Built-in confirmation copy. Set `confirm={false}` to skip (caller confirms). */
  confirm?: boolean
  confirmTitle?: string
  confirmMessage?: string
  confirmLabel?: string
  /** Used to build the default confirm message: "Delete {itemLabel}? …". */
  itemLabel?: string
  disabled?: boolean
  className?: string
}

export function RowDeleteButton({
  onDelete,
  label,
  ariaLabel = 'Delete',
  confirm = true,
  confirmTitle,
  confirmMessage,
  confirmLabel = 'Delete',
  itemLabel,
  disabled,
  className,
}: Props) {
  const [busy, setBusy] = useState(false)

  async function handle() {
    if (busy || disabled) return
    if (confirm) {
      const ok = await confirmDialog({
        title: confirmTitle,
        message: confirmMessage ?? `Delete ${itemLabel ?? 'this item'}? This cannot be undone.`,
        confirmLabel,
        danger: true,
      })
      if (!ok) return
    }
    try {
      setBusy(true)
      await onDelete()
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={disabled || busy}
      aria-label={label ? undefined : ariaLabel}
      title={label ? undefined : ariaLabel}
      className={[
        'inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm font-medium text-gray-400',
        'transition-colors duration-150 ease-out hover:bg-red-50 hover:text-red-600',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1',
        'active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',
        className ?? '',
      ].join(' ')}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      {label}
    </button>
  )
}
