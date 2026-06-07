'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Ship, Trash2, Loader2, ChevronRight } from 'lucide-react'
import { type Voyage } from '@/lib/cargo/types'
import { listVoyages, deleteVoyage, requestPersistentStorage, cargoAvailable } from '@/lib/cargo/db'
import { currentUserId } from '@/lib/cargo/user'
import { formatVoyageDate } from '@/lib/cargo/periods'

export default function CargoListPage() {
  const [voyages, setVoyages] = useState<Voyage[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function load() {
      if (!cargoAvailable()) { setLoading(false); return }
      void requestPersistentStorage()
      const uid = await currentUserId()
      if (!active) return
      setUserId(uid)
      if (uid) setVoyages(await listVoyages(uid))
      setLoading(false)
    }
    load()
    return () => { active = false }
  }, [])

  async function handleDelete(v: Voyage) {
    if (!userId) return
    if (!window.confirm(`Delete the voyage "${v.vesselName} — ${v.voyageNumber}" and all its photos from this device? This cannot be undone.`)) return
    setDeleting(v.id)
    try {
      await deleteVoyage(userId, v.id)
      setVoyages(await listVoyages(userId))
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Cargo Monitoring</h1>
          <p className="text-gray-500 mt-0.5">Offline cargo hold monitoring voyages stored on this device.</p>
        </div>
        <Link href="/surveyor/cargo/new" className="btn-primary"><Plus className="h-4 w-4" />New Voyage</Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
      ) : voyages.length === 0 ? (
        <div className="card p-12 text-center">
          <Ship className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 mb-4">No voyages yet.</p>
          <Link href="/surveyor/cargo/new" className="btn-primary inline-flex"><Plus className="h-4 w-4" />Create your first voyage</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {voyages.map(v => (
            <div key={v.id} className="card p-0 flex items-center">
              <Link href={`/surveyor/cargo/${v.id}`} className="flex-1 flex items-center gap-4 p-4 min-w-0 hover:bg-gray-50 rounded-l-xl">
                <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
                  <Ship className="h-5 w-5 text-brand-600" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">M.V. {v.vesselName} — {v.voyageNumber}</p>
                  <p className="text-sm text-gray-500 truncate">
                    {v.cargoType || 'Cargo'} · {v.holdCount} holds · {formatVoyageDate(v.startDate)} – {formatVoyageDate(v.endDate)}
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 text-gray-300 ml-auto flex-shrink-0" />
              </Link>
              <button onClick={() => handleDelete(v)} disabled={deleting === v.id} className="p-4 text-gray-300 hover:text-red-500">
                {deleting === v.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
