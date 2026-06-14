'use client'

import { useEffect, useState } from 'react'
import { Loader2, Plus, Trash2, Check, X, Pencil, Eye, EyeOff } from 'lucide-react'
import { listAllJobTypes, addJobType, renameJobType, setJobTypeActive, deleteJobType, type JobTypeRow } from '@/lib/jobs/tracker'
import { confirmDialog } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toast'

export default function JobTypesManager() {
  const [rows, setRows] = useState<JobTypeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  async function load() { setRows(await listAllJobTypes()); setLoading(false) }
  useEffect(() => { load() }, [])

  async function add() {
    const n = newName.trim()
    if (!n) return
    setBusy(true)
    const { error } = await addJobType(n)
    setBusy(false)
    if (error) { toast.error(/duplicate|unique/i.test(error) ? 'That job type already exists.' : error); return }
    setNewName(''); toast.success('Job type added'); load()
  }

  async function saveRename(id: string) {
    const n = editName.trim()
    if (!n) { setEditId(null); return }
    const { error } = await renameJobType(id, n)
    if (error) { toast.error(error); return }
    setEditId(null); load()
  }

  async function toggle(r: JobTypeRow) {
    const { error } = await setJobTypeActive(r.id, !r.is_active)
    if (error) { toast.error(error); return }
    load()
  }

  async function remove(r: JobTypeRow) {
    if (!(await confirmDialog({ title: 'Delete job type', message: `Delete "${r.name}"? It disappears from the New Job dropdown. Existing jobs keep their recorded type.`, danger: true, confirmLabel: 'Delete' }))) return
    const { error } = await deleteJobType(r.id)
    if (error) { toast.error(error); return }
    toast.success('Job type deleted'); load()
  }

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h2 className="section-title">Job Types</h2>
        <p className="text-xs text-gray-400 mt-0.5">The list of types shown when creating a job. Hidden (inactive) types stay on old jobs but drop off the dropdown.</p>
      </div>

      <div className="flex items-center gap-2">
        <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} placeholder="New job type (e.g. Fuel Loadout)" className="input-base flex-1" />
        <button onClick={add} disabled={busy || !newName.trim()} className="btn-primary"><Plus className="h-4 w-4" />Add</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400">No job types yet.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {rows.map(r => (
            <div key={r.id} className="flex items-center gap-2 py-2">
              {editId === r.id ? (
                <>
                  <input value={editName} onChange={e => setEditName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveRename(r.id); if (e.key === 'Escape') setEditId(null) }} autoFocus className="input-base py-1 flex-1" />
                  <button onClick={() => saveRename(r.id)} className="btn-ghost py-1 px-1.5 text-green-600"><Check className="h-4 w-4" /></button>
                  <button onClick={() => setEditId(null)} className="btn-ghost py-1 px-1.5 text-gray-400"><X className="h-4 w-4" /></button>
                </>
              ) : (
                <>
                  <span className={`flex-1 text-sm ${r.is_active ? 'text-gray-900' : 'text-gray-400 line-through'}`}>{r.name}</span>
                  <button onClick={() => { setEditId(r.id); setEditName(r.name) }} title="Rename" className="btn-ghost py-1 px-1.5 text-gray-400 hover:text-brand-600"><Pencil className="h-3.5 w-3.5" /></button>
                  <button onClick={() => toggle(r)} title={r.is_active ? 'Hide from dropdown' : 'Show in dropdown'} className="btn-ghost py-1 px-1.5 text-gray-400 hover:text-gray-700">{r.is_active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button>
                  <button onClick={() => remove(r)} title="Delete" className="btn-ghost py-1 px-1.5 text-gray-300 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
