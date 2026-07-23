'use client'

import { useEffect, useRef, useState } from 'react'
import { FileText, Plus, Pencil, Trash2, Download, Loader2, Upload, X } from 'lucide-react'
import { type PersonalDocument } from '@/lib/types/database'
import {
  listDocuments, addDocument, updateDocument, deleteDocument, signedUrl,
  formatBytes, expiryStatus, DOC_TYPES, type DocInput,
} from '@/lib/personal-docs/api'
import { confirmDialog } from '@/components/ui/confirm'
import EmptyState from '@/components/ui/EmptyState'

function StatusChip({ expiry, lead }: { expiry: string | null; lead: number }) {
  const { status, days } = expiryStatus(expiry, lead)
  if (status === 'none') return <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">No expiry</span>
  if (status === 'expired') return <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">Expired {Math.abs(days!)}d ago</span>
  if (status === 'expiring') return <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Expires in {days}d</span>
  return <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-100 text-green-700">Valid</span>
}

const EMPTY: DocInput = { doc_name: '', doc_type: '', issue_date: '', expiry_date: '', reminder_lead_days: 60, notes: '' }

export default function PersonalDocsManager({ profileId, canManage }: { profileId: string; canManage: boolean }) {
  const [docs, setDocs] = useState<PersonalDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<PersonalDocument | 'new' | null>(null)
  const [form, setForm] = useState<DocInput>(EMPTY)
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function reload() { setDocs(await listDocuments(profileId)); setLoading(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload() }, [profileId])

  function openNew() { setForm(EMPTY); setFile(null); setError(null); setEditing('new') }
  function openEdit(d: PersonalDocument) {
    setForm({ doc_name: d.doc_name, doc_type: d.doc_type ?? '', issue_date: d.issue_date ?? '', expiry_date: d.expiry_date ?? '', reminder_lead_days: d.reminder_lead_days, notes: d.notes ?? '' })
    setFile(null); setError(null); setEditing(d)
  }

  async function save() {
    if (!form.doc_name.trim()) { setError('Document name is required.'); return }
    setSaving(true); setError(null)
    const res = editing === 'new'
      ? await addDocument(profileId, form, file)
      : await updateDocument(editing as PersonalDocument, form, file)
    setSaving(false)
    if (res.error) { setError(res.error); return }
    setEditing(null)
    await reload()
  }

  async function remove(d: PersonalDocument) {
    if (!(await confirmDialog({ message: `Delete "${d.doc_name}"? This cannot be undone.`, danger: true, confirmLabel: 'Delete' }))) return
    await deleteDocument(d)
    await reload()
  }

  async function download(d: PersonalDocument) {
    if (!d.storage_path) return
    const url = await signedUrl(d.storage_path)
    if (url) window.open(url, '_blank')
  }

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>

  return (
    <div className="space-y-3">
      {canManage && !editing && (
        <div className="flex justify-end">
          <button onClick={openNew} className="btn-secondary text-sm"><Plus className="h-4 w-4" />Add document</button>
        </div>
      )}

      {editing && (
        <div className="card p-4 space-y-3 border-brand-200">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-gray-900">{editing === 'new' ? 'Add document' : 'Edit document'}</h3>
            <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="label-base">Document name *</label>
              <input className="input-base" value={form.doc_name} onChange={e => setForm(f => ({ ...f, doc_name: e.target.value }))} placeholder="e.g. Port Pass - Point Lisas" />
            </div>
            <div>
              <label className="label-base">Type</label>
              <input className="input-base" list="pd-types" value={form.doc_type ?? ''} onChange={e => setForm(f => ({ ...f, doc_type: e.target.value }))} placeholder="Optional" />
              <datalist id="pd-types">{DOC_TYPES.map(t => <option key={t} value={t} />)}</datalist>
            </div>
            <div>
              <label className="label-base">Remind me (days before expiry)</label>
              <input type="number" min={1} max={365} className="input-base" value={form.reminder_lead_days ?? 60} onChange={e => setForm(f => ({ ...f, reminder_lead_days: Number(e.target.value) }))} />
            </div>
            <div>
              <label className="label-base">Issue / initial date</label>
              <input type="date" className="input-base" value={form.issue_date ?? ''} onChange={e => setForm(f => ({ ...f, issue_date: e.target.value }))} />
            </div>
            <div>
              <label className="label-base">Expiry date</label>
              <input type="date" className="input-base" value={form.expiry_date ?? ''} onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))} />
            </div>
            <div className="sm:col-span-2">
              <label className="label-base">Notes</label>
              <input className="input-base" value={form.notes ?? ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
            </div>
            <div className="sm:col-span-2">
              <label className="label-base">File {editing !== 'new' && (editing as PersonalDocument).storage_path ? '(uploading replaces the current file)' : '(optional)'}</label>
              <input ref={fileRef} type="file" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
              <button onClick={() => fileRef.current?.click()} className="btn-secondary text-sm"><Upload className="h-4 w-4" />{file ? file.name : 'Choose file'}</button>
            </div>
          </div>
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(null)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={save} disabled={saving} className="btn-primary text-sm">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save</button>
          </div>
        </div>
      )}

      {docs.length === 0 && !editing ? (
        <EmptyState icon={FileText} title="No documents yet" description="Add certificates and other personal documents to keep them on file." />
      ) : (
        <div className="space-y-2">
          {docs.map(d => (
            <div key={d.id} className="card p-3 flex items-center gap-3">
              <FileText className="h-5 w-5 text-gray-400 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-gray-900 truncate">{d.doc_name}</p>
                  <StatusChip expiry={d.expiry_date} lead={d.reminder_lead_days} />
                </div>
                <p className="text-xs text-gray-500">
                  {d.doc_type ? `${d.doc_type} · ` : ''}{d.issue_date ? `issued ${d.issue_date} · ` : ''}{d.expiry_date ? `expires ${d.expiry_date}` : 'no expiry'}
                  {d.storage_path ? ` · ${formatBytes(d.size_bytes)}` : ''}
                </p>
              </div>
              {d.storage_path && <button onClick={() => download(d)} className="btn-secondary py-1.5 px-3 text-xs"><Download className="h-3.5 w-3.5" />Open</button>}
              {canManage && <button onClick={() => openEdit(d)} className="btn-ghost py-1.5 px-2 text-xs"><Pencil className="h-3.5 w-3.5" /></button>}
              {canManage && <button onClick={() => remove(d)} className="btn-ghost py-1.5 px-2 text-xs text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></button>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
