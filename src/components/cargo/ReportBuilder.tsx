'use client'

import { useEffect, useState } from 'react'
import { FileDown, Loader2 } from 'lucide-react'
import { type Voyage, type CargoPhoto } from '@/lib/cargo/types'
import { getPhotosForVoyage } from '@/lib/cargo/db'
import { currentUserId } from '@/lib/cargo/user'
import { downloadCargoReport } from '@/lib/cargo/pdf/render'
import type { Quality } from '@/lib/cargo/photo'

interface Props {
  voyage: Voyage
  onChange: (next: Voyage) => void
}

export default function ReportBuilder({ voyage, onChange }: Props) {
  const [photos, setPhotos] = useState<CargoPhoto[]>([])
  const [quality, setQuality] = useState<Quality>('standard')
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    currentUserId().then(async uid => {
      if (!active || !uid) return
      setPhotos(await getPhotosForVoyage(uid, voyage.id))
    })
    return () => { active = false }
  }, [voyage.id])

  const assignedCount = photos.filter(p => p.assigned).length
  const pdfTypeCount = voyage.readingTypes.filter(rt => rt.includeInPdf).length

  async function handleGenerate() {
    setGenerating(true)
    setError(null)
    setProgress({ done: 0, total: assignedCount })
    try {
      await downloadCargoReport(voyage, photos, {
        quality,
        onProgress: (done, total) => setProgress({ done, total }),
      })
    } catch (err: any) {
      setError(err?.message ?? 'Could not generate the report.')
    } finally {
      setGenerating(false)
      setProgress(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="card p-6 space-y-4">
        <div>
          <label className="label-base">Voyage Observations</label>
          <textarea
            className="input-base min-h-[120px]"
            value={voyage.observations ?? ''}
            onChange={e => onChange({ ...voyage, observations: e.target.value })}
            placeholder="Overall observations for the voyage — included in the Full report."
          />
        </div>
      </div>

      <div className="card p-6 space-y-5">
        <div>
          <h3 className="font-semibold text-gray-900">Full Cargo Monitoring Report</h3>
          <p className="text-sm text-gray-500 mt-0.5">Cover page · reading tables · photo pages · observations &amp; remarks. Generated entirely on this device — no internet required.</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div className="rounded-lg bg-gray-50 p-3"><p className="text-2xl font-semibold text-gray-900">{voyage.holdCount}</p><p className="text-xs text-gray-500">Holds</p></div>
          <div className="rounded-lg bg-gray-50 p-3"><p className="text-2xl font-semibold text-gray-900">{pdfTypeCount}</p><p className="text-xs text-gray-500">Reading types</p></div>
          <div className="rounded-lg bg-gray-50 p-3"><p className="text-2xl font-semibold text-gray-900">{assignedCount}</p><p className="text-xs text-gray-500">Assigned photos</p></div>
          <div className="rounded-lg bg-gray-50 p-3"><p className="text-2xl font-semibold text-gray-900">{photos.length - assignedCount}</p><p className="text-xs text-gray-500">Unassigned</p></div>
        </div>

        <div>
          <label className="label-base">PDF Quality</label>
          <div className="flex gap-2">
            <button
              onClick={() => setQuality('standard')}
              className={`flex-1 rounded-lg border p-3 text-left ${quality === 'standard' ? 'border-brand-500 bg-brand-50' : 'border-gray-200'}`}
            >
              <p className="font-medium text-gray-900 text-sm">Standard</p>
              <p className="text-xs text-gray-500">Compressed, email-friendly (default)</p>
            </button>
            <button
              onClick={() => setQuality('high')}
              className={`flex-1 rounded-lg border p-3 text-left ${quality === 'high' ? 'border-brand-500 bg-brand-50' : 'border-gray-200'}`}
            >
              <p className="font-medium text-gray-900 text-sm">High Quality</p>
              <p className="text-xs text-gray-500">Larger file, higher image detail</p>
            </button>
          </div>
        </div>

        {assignedCount > 200 && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
            This report has {assignedCount} photos. Generating it compresses each one in the browser and may take a while or use a lot of memory — close other heavy tabs, and prefer Standard quality for very large voyages.
          </div>
        )}

        {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

        <button onClick={handleGenerate} disabled={generating} className="btn-primary w-full justify-center">
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
          {generating
            ? (progress && progress.total > 0 ? `Preparing photos ${progress.done}/${progress.total}…` : 'Generating…')
            : 'Generate PDF Report'}
        </button>
      </div>
    </div>
  )
}
