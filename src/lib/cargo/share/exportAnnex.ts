// The daily snapshot a surveyor emails off a vessel.
//
// Surveyors work offline for the whole voyage — the laptop never sees the
// internet, but the SHIP does. Once a day the surveyor exports this file, hands
// it to the captain, and the captain emails it from the vessel's system to the
// client, the office and the vessel's managers. It is the direct replacement for
// the Excel workbook they used to send, and it is why the file must be a single
// self-contained document that opens in any browser with no app and no login.
//
// Everything happens on the device. The same renderer that serves the share link
// runs here — it is a pure function of the voyage — so the emailed snapshot and
// the link can never drift apart.
//
// ⚠️ STRICTLY READ-ONLY. This must never write to the voyage, not even a
// "last exported" stamp: any write bumps updatedAt, which marks the voyage dirty
// (voyageDirty) and would put a spurious change in front of the surveyor's next
// sync. Exporting a report is not editing it.

import type { Voyage } from '../types'
// STATICALLY imported, deliberately. A dynamic import() would make webpack emit
// the renderer as its own lazy chunk — and the only other importer is the server
// route, so nothing else would ever pull it. A surveyor who has been offline
// since before this shipped would then press the button and get a rejected
// import, because the chunk was never fetched while there was a network to fetch
// it from. Bundling it into the workspace costs a few KB on a page that is
// already cached for offline use, and makes the export work the first time it is
// ever pressed at sea. Do not "optimise" this back to import().
import { renderVoyageAnnex } from './annex'
import { deliverFile } from '@/lib/pdf/deliver'
import { withVesselPrefix } from '@/lib/utils'

/** The letterhead, from the service worker's cache when there is no signal.
 *  Deliberately a local copy of the same few lines in lib/cargo/pdf/render.ts
 *  rather than a shared import: that module is on the surveyor's working PDF
 *  path, and this feature is not worth touching it. Failure is fine — the annex
 *  falls back to the company name as text. */
async function letterheadDataUrl(): Promise<string | null> {
  try {
    // Timed out, because "offline" on a vessel is often not a clean failure: ship
    // wifi answers, the uplink is dead, and a bare fetch can hang indefinitely.
    // Without this the button sits on "Preparing…" forever and the surveyor has
    // no report and no error.
    const res = await fetch('/logo-invoice.png', { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

// Hyphens survive — voyage numbers look like "V-047" and turning that into
// "V_047" makes the filename read as something the app mangled.
const safe = (s: string) => (s || '').replace(/[^a-z0-9-]+/gi, '_').replace(/^[_-]+|[_-]+$/g, '')

/**
 * `Channel_Pearl_V-047_2026-08-11.html`.
 *
 * Dated, because these arrive daily: the captain's sent folder and three
 * recipients' inboxes all stay sortable, and nobody opens the wrong day. The
 * date is the day the snapshot covers, not the day it is opened.
 */
export function annexFilename(voyage: Voyage, on: Date = new Date()): string {
  const vessel = safe(withVesselPrefix(voyage.vesselName, voyage.vesselType)) || 'Voyage'
  const number = voyage.voyageNumber ? `_${safe(voyage.voyageNumber)}` : ''
  const day = `${on.getFullYear()}-${String(on.getMonth() + 1).padStart(2, '0')}-${String(on.getDate()).padStart(2, '0')}`
  return `${vessel}${number}_${day}.html`
}

/** Render the snapshot for a voyage. Pure apart from fetching the logo. */
export async function buildVoyageSnapshot(voyage: Voyage, now: Date = new Date()): Promise<Blob> {
  const html = renderVoyageAnnex(voyage, {
    logoDataUrl: await letterheadDataUrl(),
    generatedAt: now,
    // NOT voyage.updatedAt. That field is stamped onto the copy written to
    // IndexedDB, never back onto the object the workspace holds in React state,
    // so it still reads as the previous session — it would date this morning's
    // rounds to yesterday evening on a report about cargo that may be heating.
    // This copy is rendered from the device that recorded the readings, so the
    // moment of export IS the moment the readings are current to.
    dataAsAt: now.getTime(),
    // Rendered on the recording device: nothing is being withheld, so the page
    // must not warn that later readings haven't reached us.
    selfContained: true,
    // No hover readout — it embeds every value a second time and roughly doubles
    // the file, on a document that goes out daily over a satellite link.
    interactive: false,
  })
  return new Blob([html], { type: 'text/html;charset=utf-8' })
}

/** Build the snapshot and hand it to the OS — shares on mobile, downloads on
 *  desktop, via the same seam every other generated file uses. */
export async function downloadVoyageSnapshot(voyage: Voyage, now: Date = new Date()): Promise<void> {
  const blob = await buildVoyageSnapshot(voyage, now)
  const name = annexFilename(voyage, now)
  await deliverFile(blob, name, 'text/html', { title: name })
}
