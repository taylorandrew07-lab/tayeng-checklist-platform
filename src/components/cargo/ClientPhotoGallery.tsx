'use client'

import { useMemo, useState } from 'react'
import { X, ImageOff } from 'lucide-react'
import { type Voyage, type Period, PERIODS, PERIOD_LABELS, CAMERA_LABELS } from '@/lib/cargo/types'
import { monitoringDates, formatVoyageDate } from '@/lib/cargo/periods'
import type { RemotePhoto } from '@/lib/cargo/remote'

/** Read-only photo gallery for clients. Shows only photos that exist. */
export default function ClientPhotoGallery({ voyage, photos }: { voyage: Voyage; photos: RemotePhoto[] }) {
  const dates = useMemo(() => monitoringDates(voyage.startDate, voyage.endDate), [voyage.startDate, voyage.endDate])
  const [date, setDate] = useState(dates[0] ?? '')
  const [period, setPeriod] = useState<Period>('0600')
  const [preview, setPreview] = useState<RemotePhoto | null>(null)

  const here = photos
    .filter(p => p.dateISO === date && p.period === period)
    .sort((a, b) => a.holdNumber - b.holdNumber || (a.camera === b.camera ? 0 : a.camera === 'fwd' ? -1 : 1))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label-base">Date</label>
          <select className="input-base" value={date} onChange={e => setDate(e.target.value)}>
            {dates.map(d => <option key={d} value={d}>{formatVoyageDate(d)}</option>)}
          </select>
        </div>
        <div>
          <label className="label-base">Monitoring Period</label>
          <select className="input-base" value={period} onChange={e => setPeriod(e.target.value as Period)}>
            {PERIODS.map(p => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}
          </select>
        </div>
      </div>

      {here.length === 0 ? (
        <div className="card p-12 text-center text-gray-400">
          <ImageOff className="h-8 w-8 mx-auto mb-2 text-gray-300" />
          No photos for {PERIOD_LABELS[period]} on {formatVoyageDate(date)}.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {here.map(p => (
            <div key={p.id} className="card p-2">
              <img src={p.url} alt={p.filename} className="w-full h-64 object-contain bg-gray-50 rounded cursor-pointer" onClick={() => setPreview(p)} />
              <p className="text-xs text-gray-600 text-center mt-1">
                Hold {p.holdNumber} – {CAMERA_LABELS[p.camera]}{p.actualTime ? ` – ${p.actualTime} hrs` : ''}
              </p>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <button className="absolute top-4 right-4 text-white"><X className="h-7 w-7" /></button>
          <div className="max-w-5xl max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <img src={preview.url} alt={preview.filename} className="max-w-full max-h-[85vh] object-contain" />
            <p className="text-white text-center text-sm mt-2">Hold {preview.holdNumber} – {CAMERA_LABELS[preview.camera]}{preview.actualTime ? ` · ${preview.actualTime} hrs` : ''}</p>
          </div>
        </div>
      )}
    </div>
  )
}
