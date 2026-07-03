'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Anchor, Loader2, Search, Plus, ChevronRight, FolderOpen, Trash2 } from 'lucide-react'
import { listVessels, findOrCreateVessel, deleteVessel, type VesselRow } from '@/lib/vessels/api'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/components/ui/confirm'
import PageHeader from '@/components/ui/PageHeader'

export default function VesselsPage() {
  const [rows, setRows] = useState<VesselRow[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)

  async function load() {
    setRows(await listVessels())
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function addVessel() {
    const n = newName.trim()
    if (!n) return
    setAdding(true)
    const id = await findOrCreateVessel(n)
    setAdding(false)
    if (!id) { toast.error('Could not add vessel'); return }
    setNewName('')
    toast.success('Vessel added')
    load()
  }

  async function removeVessel(v: VesselRow) {
    const linked = v.jobs > 0 ? ` and unlink it from ${v.jobs} job${v.jobs !== 1 ? 's' : ''} (their records and vessel names are kept)` : ''
    const ok = await confirmDialog({
      title: `Delete M.V. ${v.name}?`,
      message: `This permanently deletes the vessel record${linked}. Any linked cargo voyages are also unlinked, and this vessel's document library is removed. This cannot be undone.`,
      danger: true,
      confirmLabel: 'Delete vessel',
    })
    if (!ok) return
    const { error } = await deleteVessel(v.id)
    if (error) { toast.error(error); return }
    toast.success('Vessel deleted')
    load()
  }

  const term = q.trim().toLowerCase()
  const visible = term
    ? rows.filter(v => [v.name, v.imo, v.official_number].some(x => (x ?? '').toLowerCase().includes(term)))
    : rows

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <PageHeader
        title="Vessels"
        subtitle={<>{loading ? '…' : `${rows.length} vessel${rows.length !== 1 ? 's' : ''}`} · the directory jobs and cargo voyages link to.</>}
        actions={<Link href="/admin/documents" className="btn-secondary"><FolderOpen className="h-4 w-4" /><span className="hidden sm:inline">Document library</span></Link>}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, IMO, official #…" className="input-base pl-9" />
        </div>
        <div className="flex items-center gap-2">
          <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addVessel() }} placeholder="New vessel name" className="input-base w-44" />
          <button onClick={addVessel} disabled={adding || !newName.trim()} className="btn-primary"><Plus className="h-4 w-4" />Add</button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
      ) : visible.length === 0 ? (
        <div className="card p-12 text-center">
          <Anchor className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">{rows.length === 0 ? 'No vessels yet. Add one above, or they appear as jobs link to them.' : 'No vessels match.'}</p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-2.5 font-medium">Vessel</th>
                <th className="px-4 py-2.5 font-medium">IMO</th>
                <th className="px-4 py-2.5 font-medium">Official #</th>
                <th className="px-4 py-2.5 font-medium">Jobs</th>
                <th className="px-4 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(v => (
                <tr key={v.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    <Link href={`/admin/vessels/${v.id}`} className="group inline-flex items-center gap-2.5 min-w-0">
                      <span className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0"><Anchor className="h-4 w-4 text-brand-600" /></span>
                      <span className="font-medium text-gray-900 group-hover:text-brand-700 truncate">M.V. {v.name}</span>
                      {!v.is_active && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400">Inactive</span>}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 tnum">{v.imo || <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-2.5 text-gray-600 tnum">{v.official_number || <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-2.5 text-gray-700 tnum">{v.jobs}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button onClick={() => removeVessel(v)} title="Delete vessel" className="text-gray-300 hover:text-red-600 p-1"><Trash2 className="h-4 w-4" /></button>
                      <Link href={`/admin/vessels/${v.id}`} title="Open" className="text-gray-300 hover:text-brand-600 p-1"><ChevronRight className="h-4 w-4 inline" /></Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  )
}
