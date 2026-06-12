'use client'

// Imperative, promise-based confirmation. Replaces window.confirm:
//   if (!(await confirmDialog({ message: 'Delete this?', danger: true }))) return
// A single <ConfirmHost/> (mounted in the root layout) renders the dialog.

import { useEffect, useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'

interface ConfirmOpts { title?: string; message: string; confirmLabel?: string; danger?: boolean }
interface Req extends ConfirmOpts { resolve: (v: boolean) => void }

let current: Req | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())

export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise(resolve => {
    current = { title: 'Are you sure?', confirmLabel: 'Confirm', danger: false, ...opts, resolve }
    emit()
  })
}

function settle(v: boolean) {
  const c = current
  current = null
  emit()
  c?.resolve(v)
}

export function ConfirmHost() {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force(x => x + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  const c = current
  return (
    <ConfirmDialog
      open={!!c}
      onClose={() => settle(false)}
      onConfirm={() => settle(true)}
      title={c?.title ?? ''}
      message={c?.message ?? ''}
      confirmLabel={c?.confirmLabel}
      danger={c?.danger}
    />
  )
}
