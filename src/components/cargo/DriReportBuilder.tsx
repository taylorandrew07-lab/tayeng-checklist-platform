'use client'

// DRI Report Builder — tick the sections to include; the report assembles in the
// canonical order and exports to PDF (@react-pdf/renderer) and .docx (docx). The
// selection is saved to Voyage.dri.reportConfig so a report is reproducible.

import { useEffect, useMemo, useState } from 'react'
import { FileDown, FileText, Loader2, Printer, AlertTriangle } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { COMPANY } from '@/lib/company'
import type { Voyage, CargoPhoto, Camera, Period } from '@/lib/cargo/types'
import { CAMERA_LABELS } from '@/lib/cargo/types'
import { ensureDri, CANONICAL_ORDER, SECTION_LABELS, DEFAULT_INCLUDED, completenessWarnings, type SectionKey } from '@/lib/cargo/dri'
import { buildReportBlocks } from '@/lib/cargo/dri-report'
import { compressForPdf } from '@/lib/cargo/photo'
// @react-pdf (~600 KB) and docx are imported on demand inside the handlers so
// they don't ship in the voyage workspace's initial load.

const LOGO_URL = '/logo-invoice.png'

interface PreparedPhotoRow {
  dataUrl: string; width: number; height: number
  holdNumber: number; camera: Camera; dateISO: string; period: Period
  actualTime: string | null; caption: string
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

// Load the letterhead logo once: a data URL (PDF/preview) + raw bytes (.docx).
async function loadLogo(): Promise<{ dataUrl: string; bytes: Uint8Array } | null> {
  try {
    const res = await fetch(LOGO_URL)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return { dataUrl: `data:image/png;base64,${btoa(bin)}`, bytes }
  } catch { return null }
}

/**
 * @param loadPhotos lazily fetches the voyage's photo blobs (IndexedDB on-device,
 *   signed-URL fetch in the cloud) — only called when the photo appendix is ticked.
 * @param photoCount cheap count for the UI; pass undefined when unknown.
 */
export default function DriReportBuilder({ voyage, onChange, photoCount, loadPhotos }: {
  voyage: Voyage
  onChange: (v: Voyage) => void
  photoCount?: number
  loadPhotos?: () => Promise<CargoPhoto[]>
}) {
  const dri = ensureDri(voyage.dri, voyage.holdCount)
  const [included, setIncluded] = useState<SectionKey[]>(dri.reportConfig?.includedSections ?? DEFAULT_INCLUDED)
  const [busy, setBusy] = useState<null | 'pdf' | 'docx'>(null)
  const [logo, setLogo] = useState<{ dataUrl: string; bytes: Uint8Array } | null>(null)
  useEffect(() => { loadLogo().then(setLogo) }, [])

  const blocks = useMemo(() => buildReportBlocks(voyage, included), [voyage, included])
  const warnings = useMemo(() => completenessWarnings(voyage, included, photoCount), [voyage, included, photoCount])
  const wantsPhotos = included.includes('photos')

  /** Load + compress the assigned photos once; shapes for both PDF and .docx. */
  async function preparePhotos(): Promise<PreparedPhotoRow[]> {
    if (!wantsPhotos || !loadPhotos) return []
    const all = await loadPhotos()
    const assigned = all.filter(p => p.assigned && p.holdNumber != null && p.camera != null)
    const out: PreparedPhotoRow[] = []
    for (const p of assigned) {
      try {
        const { dataUrl, width, height } = await compressForPdf(p.blob, 'standard')
        const holdNumber = p.holdNumber as number
        const camera = p.camera as Camera
        const caption = `Hold ${holdNumber} – ${CAMERA_LABELS[camera]}${p.actualTime ? ` – ${p.actualTime} hrs` : ''}`
        out.push({ dataUrl, width, height, holdNumber, camera, dateISO: p.dateISO, period: p.period, actualTime: p.actualTime, caption })
      } catch { /* skip unreadable */ }
    }
    return out
  }
  const title = `DRI ${voyage.vesselName} VOY ${voyage.voyageNumber}`.trim()
  const fileBase = `DRI_${(voyage.vesselName || 'report').replace(/[^a-z0-9]/gi, '_')}_VOY${(voyage.voyageNumber || '').replace(/[^a-z0-9]/gi, '_')}`

  function toggle(k: SectionKey) {
    setIncluded(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k])
  }

  /** Persist the current tick selection so the report is reproducible. */
  function persistConfig() {
    onChange({ ...voyage, dri: { ...dri, reportConfig: { name: title, includedSections: included, createdAt: Date.now() } } })
  }

  async function downloadPdf() {
    setBusy('pdf')
    try {
      persistConfig()
      const [{ pdf }, { DriReportDocument }, prepared] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/lib/cargo/pdf/DriReportDocument'),
        preparePhotos(),
      ])
      const photos = prepared.map(p => ({ dataUrl: p.dataUrl, holdNumber: p.holdNumber, camera: p.camera, dateISO: p.dateISO, period: p.period, actualTime: p.actualTime }))
      const blob = await pdf(<DriReportDocument blocks={blocks} title={title} logoDataUrl={logo?.dataUrl} photos={photos} />).toBlob()
      download(blob, `${fileBase}.pdf`)
    } catch (e: any) {
      toast.error(e?.message ?? 'PDF generation failed')
    } finally { setBusy(null) }
  }

  async function downloadDocx() {
    setBusy('docx')
    try {
      persistConfig()
      const { buildDriDocxBlob } = await import('@/lib/cargo/dri-docx')
      const prepared = await preparePhotos()
      const photos = prepared.map(p => ({ dataUrl: p.dataUrl, width: p.width, height: p.height, caption: p.caption }))
      const blob = await buildDriDocxBlob(blocks, title, logo ? { data: logo.bytes, width: 240, height: 60 } : undefined, photos)
      download(blob, `${fileBase}.docx`)
    } catch (e: any) {
      toast.error(e?.message ?? '.docx generation failed')
    } finally { setBusy(null) }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
      {/* Checklist */}
      <div className="space-y-3">
        <div className="card p-4">
          <h3 className="font-medium text-gray-900 mb-1">Sections</h3>
          <p className="text-[11px] text-gray-400 mb-3">Ticked sections render in the fixed report order.</p>
          <div className="space-y-1.5">
            {CANONICAL_ORDER.map(k => (
              <label key={k} className="flex items-start gap-2 text-sm cursor-pointer py-0.5">
                <input type="checkbox" checked={included.includes(k)} onChange={() => toggle(k)} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600" />
                <span className={included.includes(k) ? 'text-gray-800' : 'text-gray-400'}>{SECTION_LABELS[k]}</span>
              </label>
            ))}
          </div>
          <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
            <button onClick={() => setIncluded([...CANONICAL_ORDER])} className="text-xs text-brand-600 hover:underline">All</button>
            <button onClick={() => setIncluded(DEFAULT_INCLUDED)} className="text-xs text-gray-500 hover:underline">Default</button>
            <button onClick={() => setIncluded([])} className="text-xs text-gray-500 hover:underline">None</button>
          </div>
        </div>
        {warnings.length > 0 && (
          <div className="card p-3 bg-amber-50 border-amber-200">
            <div className="flex items-center gap-1.5 text-amber-800 text-xs font-semibold mb-1">
              <AlertTriangle className="h-3.5 w-3.5" />Empty ticked sections
            </div>
            <ul className="text-[11px] text-amber-700 list-disc pl-4 space-y-0.5">
              {warnings.map(w => <li key={w.key}>{w.label}</li>)}
            </ul>
            <p className="text-[10px] text-amber-600 mt-1.5">These will print as a heading with no data. Untick them or add data.</p>
          </div>
        )}
        <div className="card p-4 space-y-2">
          <button onClick={downloadPdf} disabled={!!busy} className="btn-primary w-full justify-center text-sm">{busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}Download PDF</button>
          <button onClick={downloadDocx} disabled={!!busy} className="btn-secondary w-full justify-center text-sm">{busy === 'docx' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}Download .docx</button>
          <button onClick={() => window.print()} className="btn-ghost w-full justify-center text-sm"><Printer className="h-4 w-4" />Print preview</button>
        </div>
      </div>

      {/* Live preview — styled like the printed report page (letterhead + body) */}
      <div className="overflow-auto">
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm mx-auto max-w-[8.5in] p-8 sm:p-10 print:shadow-none print:border-0 print:p-0" id="dri-report-preview">
          <div className="text-center border-b-2 border-brand-600 pb-3 mb-6">
            {logo ? <img src={logo.dataUrl} alt={COMPANY.name} className="h-12 mx-auto mb-1.5 object-contain" /> : <p className="text-lg font-bold text-brand-700">{COMPANY.name}</p>}
            <p className="text-[11px] text-gray-500">{COMPANY.address} · T {COMPANY.phone} · {COMPANY.email}</p>
          </div>
          {blocks.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-12">No sections selected.</p>
          ) : (
            <div className="max-w-none">
              {blocks.map((b, i) => {
              if (b.kind === 'h1') return <h1 key={i} className="text-center text-xl font-bold text-gray-900 mb-1">{b.text}</h1>
              if (b.kind === 'h2') return <h2 key={i} className="text-sm font-bold text-brand-700 uppercase tracking-wide mt-5 mb-1.5 border-b border-gray-200 pb-1">{b.text}</h2>
              if (b.kind === 'p') return <p key={i} className={`text-sm mb-1.5 ${b.bold ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{b.text}</p>
              return (
                <table key={i} className="w-full text-xs border border-gray-200 my-2">
                  <thead><tr className="bg-gray-50">{b.headers.map((h, hi) => <th key={hi} className="border border-gray-200 px-2 py-1 text-left font-semibold text-gray-600">{h}</th>)}</tr></thead>
                  <tbody>{b.rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} className="border border-gray-200 px-2 py-1 text-gray-700">{c}</td>)}</tr>)}</tbody>
                </table>
              )
              })}
            </div>
          )}
          {wantsPhotos && (
            <div className="mt-5 border-t border-gray-200 pt-3">
              <h2 className="text-sm font-bold text-brand-700 uppercase tracking-wide mb-1">Photographs</h2>
              <p className="text-xs text-gray-400">
                {photoCount == null
                  ? 'Assigned cargo photos will be appended as a photo plate on export (PDF & .docx).'
                  : photoCount > 0
                    ? `${photoCount} photo${photoCount === 1 ? '' : 's'} will be appended as a photo plate on export (PDF & .docx).`
                    : 'No photos are attached to this voyage yet — nothing will be appended.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
