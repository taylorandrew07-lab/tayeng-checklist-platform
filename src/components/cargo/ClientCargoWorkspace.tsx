'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Table, LineChart, Images, FileDown, CheckCircle2, AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { type Voyage } from '@/lib/cargo/types'
import { getRemoteVoyage, remotePhotosToCargoPhotos, type RemotePhoto } from '@/lib/cargo/remote'
import { downloadCargoReport } from '@/lib/cargo/pdf/render'
import ClientReadingsView from '@/components/cargo/ClientReadingsView'
import ClientPhotoGallery from '@/components/cargo/ClientPhotoGallery'
import ChartsPanel from '@/components/cargo/ChartsPanel'

type Tab = 'readings' | 'charts' | 'photos'
const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'readings', label: 'Readings', icon: Table },
  { id: 'charts', label: 'Charts', icon: LineChart },
  { id: 'photos', label: 'Photos', icon: Images },
]

export default function ClientCargoWorkspace({ id }: { id: string }) {
  const [voyage, setVoyage] = useState<Voyage | null>(null)
  const [photos, setPhotos] = useState<RemotePhoto[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('readings')
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    let active = true
    getRemoteVoyage(createClient(), id).then(res => {
      if (!active) return
      if (res) { setVoyage(res.voyage); setPhotos(res.photos) }
      setLoading(false)
    }).catch(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id])

  async function handleDownload() {
    if (!voyage) return
    setGenerating(true)
    try {
      const cargoPhotos = await remotePhotosToCargoPhotos(photos, voyage.id)
      await downloadCargoReport(voyage, cargoPhotos, { quality: 'standard' })
    } finally {
      setGenerating(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
  if (!voyage) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <h1 className="page-title mb-2">Report not available</h1>
        <p className="text-gray-500 mb-6">This voyage report isn&apos;t available to your account.</p>
        <Link href="/client/cargo" className="btn-secondary">Back</Link>
      </div>
    )
  }

  const finalized = voyage.status === 'finalized'

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-center gap-4">
        <Link href="/client/cargo" className="btn-ghost py-2 px-3"><ArrowLeft className="h-4 w-4" /></Link>
        <div className="min-w-0 flex-1">
          <h1 className="page-title truncate">M.V. {voyage.vesselName} — {voyage.voyageNumber}</h1>
          <p className="text-gray-500 mt-0.5 text-sm">{voyage.cargoType || 'Cargo'} · {voyage.holdCount} holds</p>
        </div>
        <button onClick={handleDownload} disabled={generating} className="btn-primary">
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
          {generating ? 'Preparing…' : 'Download PDF'}
        </button>
      </div>

      {finalized ? (
        <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />This report has been finalised.
        </div>
      ) : (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />Preliminary — monitoring is ongoing. Figures are current as of the last sync and may change. Downloads are marked NOT FINALISED.
        </div>
      )}

      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap -mb-px ${tab === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            <t.icon className="h-4 w-4" />{t.label}
          </button>
        ))}
      </div>

      {tab === 'readings' && <ClientReadingsView voyage={voyage} />}
      {tab === 'charts' && <ChartsPanel voyage={voyage} onChange={() => {}} />}
      {tab === 'photos' && <ClientPhotoGallery voyage={voyage} photos={photos} />}
    </div>
  )
}
