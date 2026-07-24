'use client'

import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// One upload affordance for the competition: a big tappable drop area that also
// (a) opens the native picker on click — camera roll / camera / files on a phone
// via accept="image/*", and (b) accepts drag-and-drop and clipboard PASTE on
// desktop (so an admin can paste an image straight out of WhatsApp Web). The
// whole box is a 44px+ touch target, so it doubles as the mobile "Add photos"
// button — no separate button needed.

function isImageish(f: File): boolean {
  return f.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i.test(f.name)
}
function imagesFrom(list: FileList | null | undefined, items?: DataTransferItemList): File[] {
  const out: File[] = []
  if (list?.length) { for (const f of Array.from(list)) if (isImageish(f)) out.push(f) }
  else if (items) { for (const it of Array.from(items)) if (it.kind === 'file') { const f = it.getAsFile(); if (f && isImageish(f)) out.push(f) } }
  return out
}

export default function MediaDropZone({ onFiles, disabled, pasteActive = true, busy, hint }: {
  onFiles: (files: File[]) => void
  disabled?: boolean
  /** Listen for window paste while true (e.g. only when the panel is open). */
  pasteActive?: boolean
  /** Non-null shows an inline uploading state instead of the prompt. */
  busy?: string | null
  /** Extra line under the prompt (e.g. "Files into July 2026"). */
  hint?: React.ReactNode
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  // Clipboard paste (WhatsApp Web copy → paste). Only acts when the paste
  // actually carries an image, so pasting text elsewhere is unaffected.
  useEffect(() => {
    if (!pasteActive || disabled) return
    function onPaste(e: ClipboardEvent) {
      const imgs = imagesFrom(e.clipboardData?.files, e.clipboardData?.items)
      if (imgs.length) { e.preventDefault(); onFiles(imgs) }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [pasteActive, disabled, onFiles])

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={e => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); input.current?.click() } }}
      onDragOver={e => { if (!disabled) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        e.preventDefault(); setOver(false)
        if (disabled) return
        const imgs = imagesFrom(e.dataTransfer?.files, e.dataTransfer?.items)
        if (imgs.length) onFiles(imgs)
      }}
      className={cn(
        'flex min-h-[7rem] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2',
        over ? 'border-brand-500 bg-brand-50/70' : 'border-gray-300 bg-gray-50 hover:border-brand-400 hover:bg-brand-50/40',
        disabled && 'cursor-not-allowed opacity-60',
        'dark:border-gray-700 dark:bg-gray-800/40',
      )}
    >
      {busy ? (
        <span className="inline-flex items-center gap-2 text-sm font-medium text-gray-600"><Loader2 className="h-4 w-4 animate-spin" /> {busy}</span>
      ) : (
        <>
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-100 text-brand-600"><ImagePlus className="h-5 w-5" /></span>
          <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
            Tap to add photos <span className="hidden text-gray-400 sm:inline">· or drag them here · or paste (Ctrl/⌘ V)</span>
          </span>
          {hint && <span className="text-xs text-gray-500">{hint}</span>}
        </>
      )}
      <input
        ref={input} type="file" accept="image/*" multiple className="hidden"
        onChange={e => { onFiles(Array.from(e.target.files ?? [])); e.target.value = '' }}
      />
    </div>
  )
}
