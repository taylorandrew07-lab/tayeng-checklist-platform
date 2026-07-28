'use client'

import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  footer?: React.ReactNode
}

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function Modal({ open, onClose, title, children, size = 'md', footer }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  // Callers almost always pass onClose as an inline arrow (`onClose={() => setX(null)}`),
  // so its identity changes on EVERY render of the parent. Keep it in a ref: an effect
  // that lists it as a dependency would tear down and re-run on every keystroke typed
  // into the dialog.
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  // Focus management: move focus into the dialog on open and restore it to the element
  // that had it when the dialog closes, so keyboard focus is never left stranded behind
  // the scrim.
  //
  // Depends on `open` ONLY. It previously also depended on `onClose`, which meant every
  // re-render of the parent re-ran this effect: the cleanup pulled focus back to
  // `previouslyFocused`, then the effect re-focused the first focusable element (the
  // header ✕). Typing a single character into any field in any modal therefore kicked
  // focus out of that field after one keystroke.
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    // Prefer the first form field — a dialog that exists to be filled in should not
    // open with the close button focused. Fall back to any focusable, else the panel.
    const field = panel?.querySelector<HTMLElement>('input:not([disabled]),textarea:not([disabled]),select:not([disabled])')
    const first = field ?? panel?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel)?.focus()
    return () => { previouslyFocused?.focus?.() }
  }, [open])

  // Escape to close, and trap Tab within the dialog. Separate from the focus effect so
  // that re-registering the listener can never move focus.
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      const panel = panelRef.current
      if (e.key === 'Escape') { onCloseRef.current(); return }
      if (e.key !== 'Tab' || !panel) return
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null)
      if (items.length === 0) { e.preventDefault(); return }
      const firstEl = items[0], lastEl = items[items.length - 1]
      const active = document.activeElement as HTMLElement
      if (e.shiftKey && (active === firstEl || !panel.contains(active))) { e.preventDefault(); lastEl.focus() }
      else if (!e.shiftKey && active === lastEl) { e.preventDefault(); firstEl.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open])

  if (!open || typeof document === 'undefined') return null

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  }

  // Portal to <body> so the overlay is never trapped inside a transformed/filtered
  // ancestor — those make `position: fixed` resolve to the ancestor instead of the
  // viewport, which pushed the dialog into a corner on mobile. From <body> it always
  // centres in the viewport.
  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn('bg-white rounded-2xl shadow-2xl w-full flex flex-col max-h-[90dvh] focus:outline-none', sizeClasses[size])}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <h2 id={titleId} className="text-lg font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
