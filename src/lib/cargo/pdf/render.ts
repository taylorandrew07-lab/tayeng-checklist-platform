// Client-side PDF generation — runs fully offline. Compresses each assigned photo,
// loads the logo as a data URL (served from the SW cache when offline), renders the
// react-pdf document to a Blob in the browser, and triggers a download. No server
// round-trip (unlike the checklist PDF at /api/pdf/[jobId]).

import React from 'react'
import type { Voyage, CargoPhoto, Camera, Period } from '../types'
import { compressForPdf, type Quality } from '../photo'
import { CargoReportDocument, type PreparedPhoto } from './CargoReportDocument'

async function loadLogoDataUrl(): Promise<string | null> {
  try {
    const res = await fetch('/logo-full.png')
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

export interface GenerateOptions {
  quality: Quality
  /** Optional progress callback: (done, total) compressed photos. */
  onProgress?: (done: number, total: number) => void
}

/** Build the report PDF Blob for a voyage. */
export async function generateCargoReport(
  voyage: Voyage,
  photos: CargoPhoto[],
  opts: GenerateOptions
): Promise<Blob> {
  const assigned = photos.filter(p => p.assigned && p.holdNumber != null && p.camera != null)

  const prepared: PreparedPhoto[] = []
  for (let i = 0; i < assigned.length; i++) {
    const p = assigned[i]
    const { dataUrl } = await compressForPdf(p.blob, opts.quality)
    prepared.push({
      dataUrl,
      dateISO: p.dateISO,
      period: p.period as Period,
      holdNumber: p.holdNumber as number,
      camera: p.camera as Camera,
      actualTime: p.actualTime,
    })
    opts.onProgress?.(i + 1, assigned.length)
  }

  const logoDataUrl = await loadLogoDataUrl()

  // Dynamic import keeps @react-pdf/renderer out of the SSR bundle.
  const { pdf } = await import('@react-pdf/renderer')
  const element = React.createElement(CargoReportDocument, { voyage, logoDataUrl, photos: prepared })
  return await pdf(element as unknown as Parameters<typeof pdf>[0]).toBlob()
}

/** Generate and download the report. Filename derives from vessel + voyage. */
export async function downloadCargoReport(voyage: Voyage, photos: CargoPhoto[], opts: GenerateOptions): Promise<void> {
  const blob = await generateCargoReport(voyage, photos, opts)
  const safe = (s: string) => (s || '').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase()
  const filename = `cargo_monitoring_${safe(voyage.vesselName) || 'report'}${voyage.voyageNumber ? `_${safe(voyage.voyageNumber)}` : ''}.pdf`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
