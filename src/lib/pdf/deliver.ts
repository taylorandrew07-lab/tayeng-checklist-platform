// PDF delivery that behaves correctly on mobile. Phones ignore the server's
// Content-Disposition: attachment (and iOS Safari ignores <a download> on blob
// URLs), so a plain link just renders the PDF inline with no save/share option.
//
// Instead we route the Blob through the Web Share API when the platform can share
// files (gives the native share sheet: Save to Files, AirDrop, WhatsApp, Mail…)
// and fall back to a real file download on desktop / unsupported browsers.
//
// Must be called from a direct user gesture (click handler) — the share/download
// both require it — and only works over HTTPS (production is).

// Common MIME types for the files this app generates.
export const PDF_MIME = 'application/pdf'
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const CSV_MIME = 'text/csv'

/** Share a file if the platform supports sharing files (mobile); else download.
 *  Works for any file type — PDF, .docx, CSV, images — by passing its MIME type. */
export async function deliverFile(blob: Blob, filename: string, mimeType: string, opts?: { title?: string }): Promise<void> {
  const file = new File([blob], filename, { type: mimeType })
  if (typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: opts?.title ?? filename })
      return
    } catch (err) {
      // User dismissed the share sheet — treat as success, do nothing.
      if (err instanceof Error && err.name === 'AbortError') return
      // Any other share error: fall through to download.
    }
  }
  // Desktop / unsupported: force a real download.
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
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
