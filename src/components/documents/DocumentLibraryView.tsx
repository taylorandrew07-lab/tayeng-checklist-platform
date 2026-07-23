'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Folder, FolderPlus, Search, ChevronRight, FileText } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import { listVesselFolders, createVessel, searchDocuments, signedUrl, formatBytes, type VesselFolder, type DocumentHit } from '@/lib/documents/api'

export default function DocumentLibraryView() {
  const pathname = usePathname()
  const isAdmin = pathname.startsWith('/admin')
  const base = isAdmin ? '/admin/documents' : '/surveyor/documents'
  // Surveyors read this library in the field; vessel lifecycle (create/rename/
  // delete) belongs to admins on /admin/vessels, so surveyors get a search-and-
  // open view only.

  const [vessels, setVessels] = useState<VesselFolder[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [docHits, setDocHits] = useState<DocumentHit[]>([])
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    setVessels(await listVesselFolders())
    setLoading(false)
  }
  useEffect(() => { reload() }, [])

  // Document name search (kicks in at 2+ chars).
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setDocHits([]); return }
    let active = true
    searchDocuments(q).then(hits => { if (active) setDocHits(hits) }).catch(() => {})
    return () => { active = false }
  }, [query])

  const filteredVessels = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? vessels.filter(v => v.name.toLowerCase().includes(q)) : vessels
  }, [vessels, query])

  async function handleCreate() {
    if (!newName.trim()) return
    setError(null)
    const { error } = await createVessel(newName)
    if (error) { setError(error); return }
    setNewName(''); setCreating(false)
    await reload()
  }

  async function openDoc(path: string) {
    const url = await signedUrl(path)
    if (url) window.open(url, '_blank')
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Vessel Documents</h1>
          <p className="text-gray-500 mt-0.5">Reference documents organised by vessel — sounding/hydrostatic tables, spreadsheets and more.</p>
        </div>
        {isAdmin && (
          <button onClick={() => setCreating(c => !c)} className="btn-primary whitespace-nowrap"><FolderPlus className="h-4 w-4" />New Vessel</button>
        )}
      </div>

      {isAdmin && creating && (
        <div className="card p-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="label-base">Vessel name</label>
            <input className="input-base" value={newName} autoFocus onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate() }} placeholder="e.g. Atlantic Pearl" />
          </div>
          <button onClick={handleCreate} className="btn-primary">Create</button>
          <button onClick={() => { setCreating(false); setNewName(''); setError(null) }} className="btn-secondary">Cancel</button>
        </div>
      )}
      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      <div className="relative">
        <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input className="input-base pl-9" placeholder="Search vessels or documents…" value={query} onChange={e => setQuery(e.target.value)} />
      </div>

      {loading ? (
        <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="skeleton h-16 w-full" />)}</div>
      ) : (
        <>
          {/* Document name matches */}
          {query.trim().length >= 2 && docHits.length > 0 && (
            <div className="space-y-2">
              <h2 className="section-title">Matching documents</h2>
              {docHits.map(d => (
                <button key={d.id} onClick={() => openDoc(d.storage_path)} className="card p-3 w-full flex items-center gap-3 text-left hover:bg-gray-50">
                  <FileText className="h-5 w-5 text-gray-400 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900 truncate">{d.name}</p>
                    <p className="text-xs text-gray-500">{d.vessel_name}{d.category ? ` · ${d.category}` : ''} · {formatBytes(d.size_bytes)}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Vessel folders */}
          <div className="space-y-2">
            {query.trim().length >= 2 && <h2 className="section-title">Vessels</h2>}
            {filteredVessels.length === 0 ? (
              <EmptyState
                icon={Folder}
                title={vessels.length === 0 ? 'No vessel documents yet' : 'No vessels match'}
                description={vessels.length === 0 ? (isAdmin ? 'A folder is created per vessel as jobs link to them.' : undefined) : 'Try a different search.'}
              />
            ) : filteredVessels.map(v => (
              <Link key={v.id} href={`${base}/${v.id}`} className="card p-4 flex items-center gap-4 hover:bg-gray-50">
                <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
                  <Folder className="h-5 w-5 text-brand-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900 truncate">{v.name}</p>
                  <p className="text-sm text-gray-500">{v.docCount} document{v.docCount !== 1 ? 's' : ''}</p>
                </div>
                <ChevronRight className="h-5 w-5 text-gray-300 flex-shrink-0" />
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
