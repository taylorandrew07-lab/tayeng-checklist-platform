'use client'

// DRI Report Builder — tick the sections to include; the report assembles in the
// canonical order and exports to PDF (@react-pdf/renderer) and .docx (docx). The
// selection is saved to Voyage.dri.reportConfig so a report is reproducible.

import { useMemo, useState } from 'react'
import { FileDown, FileText, Loader2, Printer } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import type { Voyage } from '@/lib/cargo/types'
import { ensureDri, CANONICAL_ORDER, SECTION_LABELS, DEFAULT_INCLUDED, type SectionKey } from '@/lib/cargo/dri'
import { buildReportBlocks } from '@/lib/cargo/dri-report'
import { DriReportDocument } from '@/lib/cargo/pdf/DriReportDocument'
import { buildDriDocxBlob } from '@/lib/cargo/dri-docx'

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

export default function DriReportBuilder({ voyage, onChange }: { voyage: Voyage; onChange: (v: Voyage) => void }) {
  const dri = ensureDri(voyage.dri, voyage.holdCount)
  const [included, setIncluded] = useState<SectionKey[]>(dri.reportConfig?.includedSections ?? DEFAULT_INCLUDED)
  const [busy, setBusy] = useState<null | 'pdf' | 'docx'>(null)

  const blocks = useMemo(() => buildReportBlocks(voyage, included), [voyage, included])
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
      const { pdf } = await import('@react-pdf/renderer')
      const blob = await pdf(<DriReportDocument blocks={blocks} title={title} />).toBlob()
      download(blob, `${fileBase}.pdf`)
    } catch (e: any) {
      toast.error(e?.message ?? 'PDF generation failed')
    } finally { setBusy(null) }
  }

  async function downloadDocx() {
    setBusy('docx')
    try {
      persistConfig()
      const blob = await buildDriDocxBlob(blocks, title)
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
        <div className="card p-4 space-y-2">
          <button onClick={downloadPdf} disabled={!!busy} className="btn-primary w-full justify-center text-sm">{busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}Download PDF</button>
          <button onClick={downloadDocx} disabled={!!busy} className="btn-secondary w-full justify-center text-sm">{busy === 'docx' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}Download .docx</button>
          <button onClick={() => window.print()} className="btn-ghost w-full justify-center text-sm"><Printer className="h-4 w-4" />Print preview</button>
        </div>
      </div>

      {/* Live preview (also the print view) */}
      <div className="card p-6 print:shadow-none print:border-0" id="dri-report-preview">
        {blocks.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">No sections selected.</p>
        ) : (
          <div className="prose-sm max-w-none">
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
      </div>
    </div>
  )
}
