'use client'

// Lightweight, dependency-free toast system. Call toast.success('Saved') from
// anywhere; a single <Toaster/> (mounted in the root layout) renders the stack.

import { useEffect, useState } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'

type ToastType = 'success' | 'error' | 'info'
interface ToastItem { id: number; type: ToastType; message: string }

let seq = 0
let items: ToastItem[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())

function dismiss(id: number) { items = items.filter(t => t.id !== id); emit() }
function push(type: ToastType, message: string) {
  const id = ++seq
  items = [...items, { id, type, message }]
  emit()
  setTimeout(() => dismiss(id), 4200)
  return id
}

export const toast = Object.assign((message: string) => push('info', message), {
  success: (m: string) => push('success', m),
  error: (m: string) => push('error', m),
  info: (m: string) => push('info', m),
})

const CFG = {
  success: { Icon: CheckCircle2, color: 'text-green-600' },
  error: { Icon: AlertCircle, color: 'text-red-600' },
  info: { Icon: Info, color: 'text-brand-600' },
} as const

function ToastCard({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const [shown, setShown] = useState(false)
  useEffect(() => { const r = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(r) }, [])
  const { Icon, color } = CFG[item.type]
  return (
    <div
      role="status"
      className={`card p-3 pr-2 flex items-start gap-2.5 shadow-lg transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] ${shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
    >
      <Icon className={`h-5 w-5 flex-shrink-0 mt-0.5 ${color}`} />
      <p className="text-sm text-gray-700 flex-1 leading-snug">{item.message}</p>
      <button onClick={onClose} aria-label="Dismiss" className="text-gray-400 hover:text-gray-600 p-0.5 rounded transition-colors"><X className="h-4 w-4" /></button>
    </div>
  )
}

export function Toaster() {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force(x => x + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  if (items.length === 0) return null
  return (
    <div className="fixed z-[60] bottom-4 right-4 flex flex-col gap-2 w-[min(92vw,22rem)]">
      {items.map(t => <ToastCard key={t.id} item={t} onClose={() => dismiss(t.id)} />)}
    </div>
  )
}
