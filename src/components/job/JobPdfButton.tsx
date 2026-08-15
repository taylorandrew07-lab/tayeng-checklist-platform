'use client'

// THE control for getting a checklist report out of the app — surveyor, admin and
// client pages all use this one component, so "get the report" means the same thing
// and behaves the same way for every role. (It used to mean three different things.)
//
// Desktop: one tap, saves the file.
// Phone/tablet: two taps, and the split is not cosmetic. The file has to exist before
// the gesture that shares it, so tap 1 fetches and tap 2 opens the native sheet with a
// live user gesture. On an installed iPhone app that sheet is the ONLY way a file can
// leave — and it does both jobs, since its first row is "Save to Files" and the rest is
// WhatsApp/Mail. That's why one button says "Save or send" instead of offering a
// Download choice that cannot work there. See lib/pdf/deliver.ts.

import { useEffect, useState } from 'react'
import { Download, Loader2, Share2, ExternalLink } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import {
  assertOnline,
  canShareFile,
  fetchJobPdfFile,
  isMobileDevice,
  openJobPdfInBrowser,
  shareFile,
  deliverJobPdf,
} from '@/lib/pdf/deliver'

export default function JobPdfButton({
  jobId,
  className = 'btn-primary',
  label = 'Download report',
  labelClassName = '',
  iconClassName = 'h-4 w-4',
}: {
  jobId: string
  className?: string
  /** Desktop label. Mobile always narrates its own two steps. */
  label?: string
  /** e.g. "hidden sm:inline" where a phone should show only the icon. */
  labelClassName?: string
  iconClassName?: string
}) {
  const [busy, setBusy] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  // Resolved after mount: the server has no idea what device this is, and guessing
  // would mismatch the first render.
  const [mobile, setMobile] = useState(false)
  useEffect(() => { setMobile(isMobileDevice()) }, [])

  function fail(err: unknown) {
    toast.error(err instanceof Error ? err.message : 'Could not get the report.')
  }

  // Desktop: fetch and save in one go.
  async function saveNow() {
    setBusy(true)
    try {
      await deliverJobPdf(jobId, { mode: 'download' })
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  // Mobile tap 1 — do the slow part only.
  async function getFile() {
    setBusy(true)
    try {
      assertOnline()
      setFile(await fetchJobPdfFile(jobId))
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  // Mobile tap 2 — must stay synchronous up to navigator.share, or iOS rejects the
  // gesture. Nothing is awaited before shareFile().
  function sendFile() {
    if (!file) return
    shareFile(file, file.name)
      .then(res => { if (res === 'shared') setFile(null) })
      .catch(fail)
  }

  if (!mobile) {
    return (
      <button onClick={saveNow} disabled={busy} className={className} title={label} aria-label={label}>
        {busy ? <Loader2 className={`${iconClassName} animate-spin`} /> : <Download className={iconClassName} />}
        <span className={labelClassName}>{label}</span>
      </button>
    )
  }

  // Fetched, but this device will not share this file type — the honest fallback.
  if (file && !canShareFile(file)) {
    return (
      <button
        onClick={() => openJobPdfInBrowser(jobId)}
        className={className}
        title="Open the report in your browser"
      >
        <ExternalLink className={iconClassName} />
        <span className={labelClassName}>Open report in browser</span>
      </button>
    )
  }

  if (file) {
    return (
      <button onClick={sendFile} className={className} title="Save or send the report">
        <Share2 className={iconClassName} />
        <span className={labelClassName}>Save or send report</span>
      </button>
    )
  }

  return (
    <button onClick={getFile} disabled={busy} className={className} title="Get the report">
      {busy ? <Loader2 className={`${iconClassName} animate-spin`} /> : <Download className={iconClassName} />}
      <span className={labelClassName}>{busy ? 'Getting report…' : 'Get report'}</span>
    </button>
  )
}
