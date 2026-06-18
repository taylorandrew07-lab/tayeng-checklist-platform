// File delivery that behaves correctly on BOTH mobile and desktop.
//  - Mobile (phones/tablets): phones ignore Content-Disposition + iOS Safari ignores
//    <a download> on blob URLs, so we route the Blob through the Web Share API → the
//    native share sheet (Save to Files, AirDrop, WhatsApp, Mail…).
//  - Desktop (incl. Windows Chrome/Edge, which ALSO support navigator.share with
//    files): a share sheet is the wrong UX there — the user wants to save the file.
//    We use the File System Access "Save As" dialog where available (Chromium) so
//    they can pick a folder, and fall back to a normal browser download otherwise.
//
// Must be called from a direct user gesture (click handler) and only works over HTTPS.

// Common MIME types for the files this app generates.
export const PDF_MIME = 'application/pdf'
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const CSV_MIME = 'text/csv'

/** True only for mobile-like devices, where the native share sheet is the right UX.
 *  Desktop (even touchscreen laptops, even though they CAN share) returns false so
 *  the file is downloaded/saved instead of opening a phone-style share sheet. */
function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  // Chromium (Android/Windows/macOS/ChromeOS) exposes an explicit, reliable flag.
  const uaMobile = (navigator as unknown as { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile
  if (typeof uaMobile === 'boolean') return uaMobile
  // Fallback for browsers without userAgentData (notably iOS/iPadOS Safari):
  const ua = navigator.userAgent || ''
  // iPhone/iPod, plus iPadOS which now reports as "Macintosh" but has touch points.
  if (/iPhone|iPod|iPad/.test(ua)) return true
  if (ua.includes('Macintosh') && (navigator.maxTouchPoints ?? 0) > 1) return true
  return /Android|Mobile/i.test(ua)
}

/** Save a Blob to disk: a real "Save As" dialog (Chromium File System Access API,
 *  lets the user choose the location) where available, else a normal download. */
async function saveToDisk(blob: Blob, filename: string, mimeType: string): Promise<void> {
  const picker = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<any> }).showSaveFilePicker
  if (typeof picker === 'function') {
    try {
      const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : ''
      const handle = await picker({
        suggestedName: filename,
        ...(ext ? { types: [{ accept: { [mimeType]: [ext] } }] } : {}),
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    } catch (err) {
      // User cancelled the Save dialog — done, nothing to do.
      if (err instanceof Error && err.name === 'AbortError') return
      // Any other error (permissions, unsupported) → fall through to a plain download.
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/** Share on mobile (native sheet); save/download on desktop. Works for any file
 *  type — PDF, .docx, CSV — by passing its MIME type. */
export async function deliverFile(blob: Blob, filename: string, mimeType: string, opts?: { title?: string }): Promise<void> {
  const file = new File([blob], filename, { type: mimeType })
  if (isMobileDevice() && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: opts?.title ?? filename })
      return
    } catch (err) {
      // User dismissed the share sheet — treat as success, do nothing.
      if (err instanceof Error && err.name === 'AbortError') return
      // Any other share error: fall through to a download.
    }
  }
  await saveToDisk(blob, filename, mimeType)
}

/** Share if the platform supports sharing files (mobile); else download a PDF. */
export async function deliverPdf(blob: Blob, filename: string, opts?: { title?: string }): Promise<void> {
  return deliverFile(blob, filename, PDF_MIME, opts)
}

/** Fetch the server-rendered checklist PDF, then share/download it. */
export async function deliverJobPdf(jobId: string): Promise<void> {
  const res = await fetch(`/api/pdf/${jobId}`, { credentials: 'include' })
  if (!res.ok) {
    const msg = res.status === 403 ? 'You are not allowed to download this report.'
      : res.status === 401 ? 'Your session has expired — please sign in again.'
      : 'Could not generate the report. Please try again.'
    throw new Error(msg)
  }
  // Reuse the server's filename (Content-Disposition) so naming stays consistent.
  const cd = res.headers.get('Content-Disposition')
  const m = cd?.match(/filename="?([^"]+)"?/i)
  const filename = m?.[1] ?? `report-${jobId}.pdf`
  const blob = await res.blob()
  await deliverPdf(blob, filename, { title: filename })
}
