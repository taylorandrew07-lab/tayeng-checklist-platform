'use client'

// Archive and Delete for one item, on the row itself.
//
// These used to live only in the Manage tab. That was wrong: when you are
// looking at a gauge on the Equipment list and want it gone, Manage is two tabs
// away and does not obviously contain the answer. Both actions route through
// lib/inventory/removeItem.ts, so the question asked here is identical to the
// one Manage asks.

import { useState } from 'react'
import { Archive, ArchiveRestore, Loader2, Trash2 } from 'lucide-react'
import { archiveItemWithPrompt, removeItemWithPrompt } from '@/lib/inventory/removeItem'
import type { ItemWithStock } from '@/lib/inventory/types'

export default function ItemRowActions({ item, onDone }: { item: ItemWithStock; onDone: () => void }) {
  const [busy, setBusy] = useState<'archive' | 'delete' | null>(null)

  async function run(which: 'archive' | 'delete') {
    setBusy(which)
    const result = which === 'archive'
      ? await archiveItemWithPrompt(item)
      : await removeItemWithPrompt(item, { isAdmin: true })
    setBusy(null)
    if (result === 'archived' || result === 'deleted') onDone()
  }

  return (
    <>
      <button
        className="btn-ghost px-2"
        onClick={() => run('archive')}
        disabled={busy !== null}
        aria-label={item.is_active ? `Archive ${item.name}` : `Restore ${item.name}`}
        title={item.is_active ? 'Archive — hides it but keeps the record' : 'Restore'}
      >
        {busy === 'archive'
          ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
          : item.is_active
            ? <Archive className="h-4 w-4 text-gray-400" />
            : <ArchiveRestore className="h-4 w-4 text-gray-400" />}
      </button>

      <button
        className="btn-ghost px-2"
        onClick={() => run('delete')}
        disabled={busy !== null}
        aria-label={`Delete ${item.name}`}
        title="Delete"
      >
        {busy === 'delete'
          ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
          : <Trash2 className="h-4 w-4 text-gray-400 transition-colors hover:text-red-600" />}
      </button>
    </>
  )
}
