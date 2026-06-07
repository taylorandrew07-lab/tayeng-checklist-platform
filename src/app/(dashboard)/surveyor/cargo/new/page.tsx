'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import VoyageSetupForm from '@/components/cargo/VoyageSetupForm'
import { type CargoTemplate } from '@/lib/cargo/types'
import { loadActiveTemplates, blankTemplate } from '@/lib/cargo/templates'

export default function NewCargoVoyagePage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<CargoTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string>('') // '' = blank

  useEffect(() => {
    let active = true
    loadActiveTemplates().then(t => {
      if (!active) return
      setTemplates(t)
      // Default to the first real template if any exist, else blank.
      if (t.length > 0) setSelectedId(t[0].id)
      setLoading(false)
    })
    return () => { active = false }
  }, [])

  const blank = blankTemplate()
  const selected = selectedId ? (templates.find(t => t.id === selectedId) ?? blank) : blank

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/surveyor/cargo" className="btn-ghost py-2 px-3"><ArrowLeft className="h-4 w-4" /></Link>
        <div>
          <h1 className="page-title">New Voyage</h1>
          <p className="text-gray-500 mt-0.5">Set up a cargo hold monitoring voyage.</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
      ) : (
        <>
          <div className="card p-6">
            <label className="label-base">Template</label>
            <select className="input-base" value={selectedId} onChange={e => setSelectedId(e.target.value)}>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              <option value="">Blank (no template)</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              {selected.reading_types.length} reading type{selected.reading_types.length !== 1 ? 's' : ''} · default {selected.default_hold_count} holds.
              {templates.length === 0 && ' No templates available — an admin can create them under Templates → Cargo Monitoring.'}
            </p>
          </div>

          {/* Re-key on template so the form re-seeds reading types + hold count when the selection changes. */}
          <VoyageSetupForm
            key={selectedId || 'blank'}
            seedTemplate={selected}
            submitLabel="Create Voyage"
            onSaved={voyage => router.push(`/surveyor/cargo/${voyage.id}`)}
          />
        </>
      )}
    </div>
  )
}
