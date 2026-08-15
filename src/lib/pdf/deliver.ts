// File delivery that behaves correctly on desktop, Android AND iPhone.
//
// The rule that drives the whole design: a file must EXIST before the gesture that
// shares it, and `navigator.share` / `showSaveFilePicker` both require an unspent
// user gesture. Anything that awaits a render or a network round-trip and *then*
// asks to share has already lost that gesture. That is why the job PDF is a two-step
// API — `fetchJobPdfFile()` on the first tap, `shareFile()` on the second.
//
//  - iPhone in an INSTALLED PWA (`display: standalone`) is the hard case, and it is
//    what our surveyors run. There is no download manager there, so
//    `Content-Disposition: attachment` has no consumer, `<a download>` on a blob is
//    inert, and navigating to the file just renders it in a chrome-less window with
//    no share button. `navigator.share({files})` is the ONLY way a file can leave the
//    app — and it doubles as "save", because the iOS sheet's first row is Save to Files.
//  - Android (tab or installed) has both: a real download and a share sheet.
//  - Desktop wants to save, not to open a phone-style share sheet, so it uses the
//    File System Access "Save As" dialog where available and a plain download otherwise.
//
// NEVER let a delivery path fail silently. Every function here either delivers or
// throws — callers show the message. A `void` return that resolved whether or not a
// file was written is how the iPhone bug hid for so long.
//
// Must be called from a direct user gesture (click handler) and only works over HTTPS.

// Common MIME types for the files this app generates.
export const PDF_MIME = 'application/pdf'
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const CSV_MIME = 'text/csv'

/** What actually happened. Callers can stay quiet on 'cancelled' — that's a user choice. */
export type DeliveryResult = 'shared' | 'cancelled' | 'saved' | 'opened'

/** How to deliver: 'auto' = share on mobile / save on desktop; 'download' = always save
 *  to the device; 'share' = always open the native share sheet. */
export type DeliverMode = 'auto' | 'download' | 'share'

/** The one message a user in the iOS-standalone trap needs, in their words. */
const IOS_STANDALONE_BLOCKED =
  'Your phone can only save this from the share sheet. Tap "Save or send", then choose "Save to Files".'

type UAData = { mobile?: boolean; platform?: string }
function uaData(): UAData | undefined {
  if (typeof navigator === 'undefined') return undefined
  return (navigator as unknown as { userAgentData?: UAData }).userAgentData
}

function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  // iPhone/iPod/iPad, plus iPadOS which now reports as "Macintosh" but has touch points.
  if (/iPhone|iPod|iPad/.test(ua)) return true
  return ua.includes('Macintosh') && (navigator.maxTouchPoints ?? 0) > 1
}

/** iOS running as an installed Home-Screen app. The ONE case where a download cannot
 *  work at all and only the share sheet can get a file out. Deliberately AND-ed with
 *  the iOS test: `display-mode: standalone` also matches installed Android and desktop
 *  PWAs, both of which download perfectly well. */
export function isIosStandalone(): boolean {
  if (typeof window === 'undefined' || !isIosDevice()) return false
  const legacy = (navigator as unknown as { standalone?: boolean }).standalone === true
  const displayMode = typeof window.matchMedia === 'function'
    && window.matchMedia('(display-mode: standalone)').matches
  return legacy || displayMode
}

/** True only for mobile-like devices, where the native share sheet is the right UX.
 *  Desktop (even touchscreen laptops, even though they CAN share) returns false so
 *  the file is downloaded/saved instead of opening a phone-style share sheet. */
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const uad = uaData()
  // Android tablets report `mobile: false`, and so does any phone in "Request desktop
  // site" — both still want the share sheet, so trust the platform over the flag.
  if (uad?.platform === 'Android') return true
  if (isIosDevice()) return true
  // Chromium (Android/Windows/macOS/ChromeOS) exposes an explicit, reliable flag.
  if (typeof uad?.mobile === 'boolean') return uad.mobile
  return /Android|Mobile/i.test(navigator.userAgent || '')
}

/** Whether this exact file can go through the native share sheet. The check is
 *  per-file: WebKit and Chromium both keep a MIME allow-list, so a PDF may share
 *  where a .csv or .html will not. */
export function canShareFile(file: File): boolean {
  return typeof navigator !== 'undefined'
    && typeof navigator.share === 'function'
    && typeof navigator.canShare === 'function'
    && navigator.canShare({ files: [file] })
}

/** Throw before doing anything slow if there is demonstrably no connection. Without
 *  this, a tap offline navigates an installed PWA to the browser's own network-error
 *  page — inside a window with no back button, where the only way out is force-quitting
 *  the app. `navigator.onLine` false-positives when online, so this only ever suppresses
 *  a call that was going to fail anyway. */
export function assertOnline(): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('You are offline — the report is generated on the server. Try again once you have signal.')
  }
}

/** Open the native share sheet for one file. MUST be called directly from the tap —
 *  do not await anything first, or the browser will reject it as a lost gesture.
 *  Returns 'cancelled' when the user dismisses the sheet; throws on real failure. */
export async function shareFile(file: File, title?: string): Promise<'shared' | 'cancelled'> {
  if (!canShareFile(file)) {
    throw new Error(isIosStandalone()
      ? `This phone will not share a ${file.type || 'file'} from an installed app. Open this page in Safari instead.`
      : 'This device cannot share files from the browser.')
  }
  try {
    await navigator.share({ files: [file], title: title ?? file.name })
    return 'shared'
  } catch (err) {
    // The user dismissed the sheet — a choice, not a failure.
    if (err instanceof Error && err.name === 'AbortError') return 'cancelled'
    // NotAllowedError means the user gesture was spent before we got here. Surface it;
    // silently downloading instead is exactly the no-op that hid the original bug.
    if (err instanceof Error && err.name === 'NotAllowedError') {
      throw new Error('The share sheet could not open. Please tap the button again.')
    }
    throw err
  }
}

/** Save a Blob to disk: a real "Save As" dialog (Chromium File System Access API,
 *  lets the user choose the location) where available, else a normal download. */
async function saveToDisk(blob: Blob, filename: string, mimeType: string): Promise<'saved'> {
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
      return 'saved'
    } catch (err) {
      // User cancelled the Save dialog — done, nothing to do.
      if (err instanceof Error && err.name === 'AbortError') return 'saved'
      // Any other error (lost activation, permissions, unsupported) → plain download.
    }
  }
  // An installed iOS app has no download manager: the anchor below does NOTHING here,
  // and returning 'saved' would be a lie the user can't see through.
  if (isIosStandalone()) throw new Error(IOS_STANDALONE_BLOCKED)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return 'saved'
}

/** Share on mobile (native sheet); save/download on desktop. Works for any file type —
 *  PDF, .docx, CSV — by passing its MIME type. `mode` forces the channel.
 *
 *  For anything that takes time to produce, prefer building the File first and calling
 *  `shareFile` from the tap: by the time this function is reached after an await, the
 *  user gesture may already be spent. */
export async function deliverFile(
  blob: Blob,
  filename: string,
  mimeType: string,
  opts?: { title?: string; mode?: DeliverMode },
): Promise<DeliveryResult> {
  const mode = opts?.mode ?? 'auto'
  const file = blob instanceof File && blob.name === filename ? blob : new File([blob], filename, { type: mimeType })
  const shareable = canShareFile(file)
  const wantShare = mode === 'share' || (mode === 'auto' && isMobileDevice() && shareable)

  if (wantShare) {
    if (shareable) {
      try {
        return await shareFile(file, opts?.title)
      } catch (err) {
        // On iOS-standalone there is no second chance — a download cannot work, so the
        // honest thing is to surface the error rather than pretend.
        if (isIosStandalone()) throw err
        // Desktop and Android can still download.
      }
    } else if (isIosStandalone()) {
      throw new Error(`This phone will not share a ${mimeType} from an installed app. Open this page in Safari to save it.`)
    }
  }
  return saveToDisk(blob, filename, mimeType)
}

/** Share if the platform supports sharing files (mobile); else download a PDF. */
export async function deliverPdf(blob: Blob, filename: string, opts?: { title?: string; mode?: DeliverMode }): Promise<DeliveryResult> {
  return deliverFile(blob, filename, PDF_MIME, opts)
}

/** Open the server PDF endpoint directly in a new browser tab. This is a LAST RESORT
 *  for devices that cannot share and cannot download — it renders the report, it does
 *  not deliver a file. Never label a control that calls this "Download": inside an
 *  installed iOS app it produces a chrome-less viewer with no save button, which is
 *  precisely the dead end this module exists to avoid.
 *  Must be called synchronously from a click handler so the browser allows the tab. */
export function openJobPdfInBrowser(jobId: string): 'opened' {
  window.open(`/api/pdf/${jobId}`, '_blank', 'noopener')
  return 'opened'
}

/** Fetch the server-rendered checklist PDF as a File, ready to share or save. Does the
 *  slow part ONLY — call `shareFile()` with the result from the next tap so the share
 *  sheet still has a live user gesture. */
export async function fetchJobPdfFile(jobId: string): Promise<File> {
  assertOnline()
  const controller = new AbortController()
  // The route's own maxDuration is 60s, so a longer client timeout just leaves the user
  // watching a spinner after the server has already given up.
  const timer = setTimeout(() => controller.abort(), 70_000)
  try {
    let res: Response
    try {
      res = await fetch(`/api/pdf/${jobId}`, { credentials: 'include', signal: controller.signal })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw new Error('The report took too long to generate — please try again.')
      throw new Error('Could not reach the server. Check your connection and try again.')
    }
    if (!res.ok) {
      throw new Error(
        res.status === 403 ? 'You are not allowed to download this report.'
          : res.status === 401 ? 'Your session has expired — please sign in again.'
          : res.status === 504 || res.status === 502 ? 'The report took too long to generate — please try again.'
          : 'Could not generate the report. Please try again.',
      )
    }
    // Reuse the server's filename (Content-Disposition) so naming stays consistent.
    const cd = res.headers.get('Content-Disposition')
    const m = cd?.match(/filename="?([^"]+)"?/i)
    const filename = m?.[1] ?? `report-${jobId}.pdf`
    // The body is read INSIDE the timeout. A stall after the headers arrive used to
    // leave the spinner running until the OS socket timeout — forever, in practice.
    let blob: Blob
    try {
      blob = await res.blob()
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw new Error('The download stalled — please try again.')
      throw new Error('The report did not download completely. Please try again.')
    }
    return new File([blob], filename, { type: PDF_MIME })
  } finally {
    clearTimeout(timer)
  }
}

/** One-shot fetch-then-deliver. Correct on desktop, where saving does not need a live
 *  gesture in the same way. On mobile prefer `fetchJobPdfFile` + `shareFile` across two
 *  taps — see `JobPdfButton`. */
export async function deliverJobPdf(jobId: string, opts?: { mode?: DeliverMode }): Promise<DeliveryResult> {
  const file = await fetchJobPdfFile(jobId)
  return deliverFile(file, file.name, PDF_MIME, { title: file.name, mode: opts?.mode })
}
