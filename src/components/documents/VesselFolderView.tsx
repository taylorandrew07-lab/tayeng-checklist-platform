'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Upload, Download, Trash2, FileText, Pencil, Search } from 'lucide-react'
import {
  getVessel, listDocuments, uploadDocument, deleteDocument, renameVessel, deleteVessel,
  signedUrl, formatBytes, DOC_CATEGORIES, type Vessel, type VesselDocument,
} from '@/lib/documents/api'

export default function VesselFolderView({ id, basePath }: { id: string; basePath: string }) {
  const [vessel, setVessel] = useState<Vessel | null>(null)
  const [docs, setDocs] = useState<VesselDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [category, setCategory] = useState('')
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState('')
  const uploadRef = useRef<HTMLInputElement>(null)

  async function reload() {
    const [v, d] = await Promise.all([getVessel(id), listDocuments(id)])
    setVessel(v); setName(v?.name ?? ''); setDocs(d); setLoading(false)
  }
  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? docs.filter(d => d.name.toLowerCase().includes(q) || (d.category ?? '').toLowerCase().includes(q)) : docs
  }, [docs, query])

  async function handleUpload(files: FileList | null) {
    if (!files || !files.length) return
    setBusy(true); setError(null)
    try {
      for (const f of Array.from(files)) {
        const { error } = await uploadDocument(id, f, category)
        if (error) { setError(`${f.name}: ${error}`); break }
      }
      await reload()
    } finally {
      setBusy(false)
      if (uploadRef.current) uploadRef.current.value = ''
    }
  }

  async function download(doc: VesselDocument) {
    const url = await signedUrl(doc.storage_path)
    if (url) window.open(url, '_blank')
  }

  async function removeDoc(doc: VesselDocument) {
    if (!window.confirm(`Delete "${doc.name}"? This cannot be undone.`)) return
    await deleteDocument(doc)
    await reload()
  }

  async function saveRename() {
    if (!name.trim()) return
    await renameVessel(id, name)
    setRenaming(false)
    await reload()
  }

  async function removeFolder() {
    if (!window.confirm(`Delete the vessel folder "${vessel?.name}" and ALL its documents? This cannot be undone.`)) return
    await deleteVessel(id)
    window.location.href = basePath
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
  if (!vessel) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <h1 className="page-title mb-2">Folder not found</h1>
        <Link href={basePath} className="btn-secondary">Back to Vessel Documents</Link>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Link href={basePath} className="btn-ghost py-2 px-3"><ArrowLeft className="h-4 w-4" /></Link>
        {renaming ? (
          <div className="flex items-center gap-2 flex-1">
            <input className="input-base" value={name} autoFocus onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveRename() }} />
            <button onClick={saveRename} className="btn-primary">Save</button>
            <button onClick={() => { setRenaming(false); setName(vessel.name) }} className="btn-secondary">Cancel</button>
          </div>
        ) : (
          <>
            <h1 className="page-title flex-1 truncate">{vessel.name}</h1>
            <button onClick={() => setRenaming(true)} className="btn-ghost py-2 px-3" title="Rename"><Pencil className="h-4 w-4" /></button>
            <button onClick={removeFolder} className="btn-ghost py-2 px-3 text-red-600 hover:bg-red-50" title="Delete folder"><Trash2 className="h-4 w-4" /></button>
          </>
        )}
      </div>

      {/* Upload */}
      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[180px]">
          <label className="label-base">Category (optional)</label>
          <input className="input-base" list="doc-categories" value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Sounding Tables" />
          <datalist id="doc-categories">{DOC_CATEGORIES.map(c => <option key={c} value={c} />)}</datalist>
        </div>
        <input ref={uploadRef} type="file" multiple className="hidden" onChange={e => handleUpload(e.target.files)} />
        <button onClick={() => uploadRef.current?.click()} disabled={busy} className="btn-primary">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{busy ? 'Uploading…' : 'Upload Documents'}
        </button>
      </div>
      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      {docs.length > 3 && (
        <div className="relative">
          <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input className="input-base pl-9" placeholder="Search documents in this vessel…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
      )}

      {/* Documents */}
      {docs.length === 0 ? (
        <div className="card p-12 text-center text-gray-400">
          <FileText className="h-10 w-10 text-gray-300 mx-auto mb-3" />No documents yet. Upload sounding tables, hydrostatic tables, spreadsheets…
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(d => (
            <div key={d.id} className="card p-3 flex items-center gap-3">
              <FileText className="h-5 w-5 text-gray-400 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900 truncate">{d.name}</p>
                <p className="text-xs text-gray-500">{d.category ? `${d.category} · ` : ''}{formatBytes(d.size_bytes)} · {d.created_at?.slice(0, 10)}</p>
              </div>
              <button onClick={() => download(d)} className="btn-secondary py-1.5 px-3 text-xs"><Download className="h-3.5 w-3.5" />Open</button>
              <button onClick={() => removeDoc(d)} className="btn-ghost py-1.5 px-2 text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          {filtered.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No documents match your search.</p>}
        </div>
      )}
    </div>
  )
}
