'use client'

// "My activity" — the movements this user recorded, and nobody else's. RLS does
// the filtering (migration 190's actor_id arm), not this component.
//
// It exists for one reason: someone types 24 instead of 2 and needs to fix it
// without phoning an admin. Undo writes a MIRRORED correction rather than
// deleting anything, so the admin history shows the mistake AND the correction —
// which is more honest than a single netted-out adjustment, and is the whole
// point of keeping a ledger.

import { useEffect, useState } from 'react'
import { History, Loader2, Undo2 } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import { confirmDialog } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toast'
import { listMyMovements } from '@/lib/inventory/api'
import { reverseMovement } from '@/lib/inventory/movements'
import { formatDateTime } from '@/lib/utils'
import { MovementLine, movementSentence } from './movementText'
import type { MovementDetail } from '@/lib/inventory/types'

/** Matches the 24-hour window enforced by inventory_reverse_movement. */
const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000

export default function MyActivity({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<MovementDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  // Stamped at load time, not read during render: Date.now() in the render body
  // is impure and makes the list re-decide what is undoable on every repaint.
  // Only ever cosmetic anyway — inventory_reverse_movement enforces the real
  // 24-hour window server-side, where it cannot be bypassed.
  const [undoCutoff, setUndoCutoff] = useState(0)

  async function load() {
    setRows(await listMyMovements(20))
    setUndoCutoff(Date.now() - UNDO_WINDOW_MS)
    setLoading(false)
  }
  useEffect(() => { void load() }, [])

  async function undo(m: MovementDetail) {
    const ok = await confirmDialog({
      title: 'Undo this entry?',
      message: `${movementSentence(m)}.\n\nThis records a correction — it does not erase the original, so the history stays honest.`,
      confirmLabel: 'Undo it',
    })
    if (!ok) return

    setBusy(m.id)
    const res = await reverseMovement(m.id)
    setBusy(null)

    if (res.outcome !== 'ok') { toast.error(res.error ?? 'Could not undo that.'); return }
    toast.success('Undone.')
    await load()
    onChanged?.()
  }

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="Nothing yet"
        description="Anything you take, add or move shows up here so you can check it or undo it."
      />
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        Your last {rows.length} {rows.length === 1 ? 'entry' : 'entries'}. You can undo your own for a day.
      </p>

      <div className="card divide-y divide-gray-100">
        {rows.map(m => {
          const undoable =
            !m.reversed &&
            m.kind !== 'correction' &&
            new Date(m.created_at).getTime() > undoCutoff

          return (
            <div key={m.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-gray-900">
                  <span className="font-medium">{m.item_name}</span>
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  <MovementLine m={m} />
                  {m.note && <span className="text-gray-400"> · {m.note}</span>}
                </p>
                <p className="mt-0.5 text-xs text-gray-400 tnum">{formatDateTime(m.created_at)}</p>
              </div>

              {m.reversed ? (
                <span className="shrink-0 text-xs text-gray-400">Undone</span>
              ) : undoable ? (
                <button
                  className="btn-ghost min-h-11 shrink-0 gap-1.5 text-sm sm:min-h-0"
                  onClick={() => undo(m)}
                  disabled={busy === m.id}
                >
                  {busy === m.id
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Undo2 className="h-4 w-4" />}
                  Undo
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
