'use client'

// Client button for downloading/sharing a checklist PDF — usable inside server
// components (e.g. the client job page). On mobile it opens a small menu so the user
// explicitly chooses "Download to device" or "Share…" (the native sheet was
// inconsistent — sometimes only offering share). On desktop it downloads directly.

import { useState } from 'react'
import { Download, Loader2, Share2 } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { deliverJobPdf, isMobileDevice, openJobPdfInBrowser, type DeliverMode } from '@/lib/pdf/deliver'

export default function JobPdfButton({ jobId, className = 'btn-primary', label = 'Download / Share PDF' }: {
  jobId: string
  className?: string
  label?: string
}) {
  const [busy, setBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  async function go(mode: DeliverMode) {
    setMenuOpen(false)
    setBusy(true)
    try {
      await deliverJobPdf(jobId, { mode })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not download the report.')
    } finally {
      setBusy(false)
    }
  }

  function onClick() {
    if (isMobileDevice()) setMenuOpen(o => !o)
    else void go('download')
  }

  return (
    <div className="relative inline-block">
      <button onClick={onClick} disabled={busy} className={className}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {label}
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 mt-1 z-20 w-52 rounded-lg border border-gray-200 bg-white shadow-lg py-1">
            <button onClick={() => { setMenuOpen(false); openJobPdfInBrowser(jobId) }} className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
              <Download className="h-4 w-4 text-gray-400" />Download to device
            </button>
            <button onClick={() => go('share')} className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
              <Share2 className="h-4 w-4 text-gray-400" />Share…
            </button>
          </div>
        </>
      )}
    </div>
  )
}
