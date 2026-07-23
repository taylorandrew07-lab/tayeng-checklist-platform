'use client'

// One "you have unsaved changes" prompt, on ui/Modal (portal, Esc, scroll-lock,
// focus handling) — replaces the raw fixed-inset overlays that were copy-pasted in
// the checklist editor and both template editors. Stay is the safe default; leaving
// is the destructive action.
//
//   {showLeave && (
//     <UnsavedChangesDialog
//       onStay={() => setShowLeave(false)}
//       onLeave={() => router.push(target)}
//     />
//   )}

import { Modal } from './Modal'
import { AlertTriangle } from 'lucide-react'

interface Props {
  open?: boolean
  onStay: () => void
  onLeave: () => void
  title?: string
  message?: string
  stayLabel?: string
  leaveLabel?: string
}

export function UnsavedChangesDialog({
  open = true,
  onStay,
  onLeave,
  title = 'Unsaved changes',
  message = 'You have changes that haven’t been saved. If you leave now they’ll be lost.',
  stayLabel = 'Keep editing',
  leaveLabel = 'Leave without saving',
}: Props) {
  return (
    <Modal
      open={open}
      onClose={onStay}
      title={title}
      size="sm"
      footer={
        <>
          <button onClick={onStay} className="btn-secondary">{stayLabel}</button>
          <button onClick={onLeave} className="btn-danger">{leaveLabel}</button>
        </>
      }
    >
      <div className="flex gap-4">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-100">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
        </div>
        <p className="text-sm leading-relaxed text-gray-600">{message}</p>
      </div>
    </Modal>
  )
}
