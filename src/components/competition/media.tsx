'use client'

import { useEffect } from 'react'
import { X, Play, ImageOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { EntryWithUrl } from '@/lib/competition/types'

/** A square-ish tile for one entry. Photos render as a cover image; videos show
 *  the first frame with a play badge. Missing/expired URLs fall back gracefully. */
export function EntryThumb({ entry, onClick, className, overlay }: {
  entry: EntryWithUrl
  onClick?: () => void
  className?: string
  overlay?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'group relative aspect-square overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800',
        onClick && 'cursor-pointer',
        className,
      )}
      onClick={onClick}
    >
      {entry.url ? (
        entry.media_type === 'video' ? (
          <>
            <video src={entry.url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white">
                <Play className="h-5 w-5 translate-x-0.5" />
              </span>
            </div>
          </>
        ) : (
          <img
            src={entry.url}
            alt={entry.caption ?? entry.filename ?? 'Entry'}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
          />
        )
      ) : (
        <div className="flex h-full w-full items-center justify-center text-gray-400">
          <ImageOff className="h-6 w-6" />
        </div>
      )}
      {overlay}
    </div>
  )
}

/** Fullscreen lightbox for a single entry. Reuses the app's hand-rolled overlay
 *  pattern (fixed inset-0 z-50 bg-black/80). Esc closes; onPrev/onNext enable
 *  arrow-key navigation when provided. */
export function EntryLightbox({ entry, onClose, onPrev, onNext, footer }: {
  entry: EntryWithUrl | null
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
  footer?: React.ReactNode
}) {
  useEffect(() => {
    if (!entry) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') onPrev?.()
      else if (e.key === 'ArrowRight') onNext?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [entry, onClose, onPrev, onNext])

  if (!entry) return null
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-4" onClick={onClose}>
      <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 text-white/80 hover:text-white">
        <X className="h-7 w-7" />
      </button>
      <div className="flex max-h-[85vh] max-w-5xl flex-col items-center" onClick={e => e.stopPropagation()}>
        {entry.media_type === 'video'
          ? <video src={entry.url ?? undefined} controls autoPlay className="max-h-[80vh] max-w-full rounded" />
          : <img src={entry.url ?? undefined} alt={entry.caption ?? ''} className="max-h-[80vh] max-w-full rounded object-contain" />}
        {footer && <div className="mt-3 text-center text-sm text-white/90">{footer}</div>}
      </div>
    </div>
  )
}
