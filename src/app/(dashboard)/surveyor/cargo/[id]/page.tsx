'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Settings, Table, Images, FileDown } from 'lucide-react'
import { type Voyage } from '@/lib/cargo/types'
import { getVoyage, putVoyage } from '@/lib/cargo/db'
import { currentUserId } from '@/lib/cargo/user'
import VoyageSetupForm from '@/components/cargo/VoyageSetupForm'
import ReadingTypeManager from '@/components/cargo/ReadingTypeManager'
import ReadingsGrid from '@/components/cargo/ReadingsGrid'
import PhotoManager from '@/components/cargo/PhotoManager'
import ReportBuilder from '@/components/cargo/ReportBuilder'

type Tab = 'setup' | 'readings' | 'photos' | 'report'
const TABS: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
  { id: 'setup', label: 'Setup', icon: Settings },
  { id: 'readings', label: 'Readings', icon: Table },
  { id: 'photos', label: 'Photos', icon: Images },
  { id: 'report', label: 'Report', icon: FileDown },
]

export default function CargoWorkspacePage() {
  const params = useParams<{ id: string }>()
  const id = params.id

  const [voyage, setVoyage] = useState<Voyage | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [tab, setTab] = useState<Tab>('setup')
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const latest = useRef<Voyage | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let active = true
    async function load() {
      const uid = await currentUserId()
      if (!active) return
      if (!uid) { setNotFound(true); setLoading(false); return }
      const v = await getVoyage(uid, id)
      if (!active) return
      if (!v) { setNotFound(true); setLoading(false); return }
      setVoyage(v)
      latest.current = v
      setLoading(false)
    }
    load()
    return () => {
      active = false
      // Flush any pending change on unmount so nothing is lost.
      if (timer.current) clearTimeout(timer.current)
      if (latest.current) void putVoyage(latest.current)
    }
  }, [id])

  // Persist a change (debounced). State updates immediately; IndexedDB write follows.
  function update(next: Voyage) {
    setVoyage(next)
    latest.current = next
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      await putVoyage(next)
      setSavedAt(Date.now())
    }, 400)
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
  }
  if (notFound || !voyage) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <h1 className="page-title mb-2">Voyage not found</h1>
        <p className="text-gray-500 mb-6">This voyage isn&apos;t stored on this device.</p>
        <Link href="/surveyor/cargo" className="btn-secondary">Back to Cargo Monitoring</Link>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-center gap-4">
        <Link href="/surveyor/cargo" className="btn-ghost py-2 px-3"><ArrowLeft className="h-4 w-4" /></Link>
        <div className="min-w-0">
          <h1 className="page-title truncate">M.V. {voyage.vesselName} — {voyage.voyageNumber}</h1>
          <p className="text-gray-500 mt-0.5 text-sm">
            {voyage.cargoType || 'Cargo'} · {voyage.holdCount} holds
            {savedAt && <span className="text-green-600"> · saved</span>}
          </p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap -mb-px ${
              tab === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon className="h-4 w-4" />{t.label}
          </button>
        ))}
      </div>

      {tab === 'setup' && (
        <div className="space-y-8">
          <VoyageSetupForm voyage={voyage} onSaved={update} submitLabel="Save Setup" />
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Reading Types</h2>
            {voyage.templateName && (
              <p className="text-sm text-gray-500 mb-2">From template: <span className="font-medium text-gray-700">{voyage.templateName}</span>. Edits here apply only to this voyage.</p>
            )}
            <ReadingTypeManager
              readingTypes={voyage.readingTypes}
              holdCount={voyage.holdCount}
              onChange={types => update({ ...voyage, readingTypes: types })}
            />
          </div>
        </div>
      )}
      {tab === 'readings' && <ReadingsGrid voyage={voyage} onChange={update} />}
      {tab === 'photos' && <PhotoManager voyage={voyage} onChange={update} />}
      {tab === 'report' && <ReportBuilder voyage={voyage} onChange={update} />}
    </div>
  )
}
