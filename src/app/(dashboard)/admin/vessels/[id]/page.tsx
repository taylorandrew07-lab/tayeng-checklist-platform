'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Anchor, Pencil, Save, Ship, FolderOpen, Briefcase } from 'lucide-react'
import { getVesselDetail, updateVessel, type VesselDetail } from '@/lib/vessels/api'
import { WorkflowPill } from '@/components/job/StatusPill'
import { formatDate } from '@/lib/utils'
import type { WorkflowStatus } from '@/lib/types/database'
import { toast } from '@/components/ui/toast'

export default function VesselDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [data, setData] = useState<VesselDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', imo: '', official_number: '', is_active: true })

  async function load() {
    const d = await getVesselDetail(params.id)
    setData(d)
    if (d) setForm({ name: d.vessel.name, imo: d.vessel.imo ?? '', official_number: d.vessel.official_number ?? '', is_active: d.vessel.is_active })
    setLoading(false)
  }
  useEffect(() => { load() }, [params.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!form.name.trim()) { toast.error('Name is required'); return }
    setSaving(true)
    const { error } = await updateVessel(params.id, {
      name: form.name.trim(), imo: form.imo.trim() || null, official_number: form.official_number.trim() || null, is_active: form.is_active,
    })
    setSaving(false)
    if (error) { toast.error(error); return }
    setEdit(false); toast.success('Vessel saved'); load()
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
  if (!data) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <h1 className="page-title mb-2">Vessel not found</h1>
        <Link href="/admin/vessels" className="btn-secondary">Back to vessels</Link>
      </div>
    )
  }

  const { vessel, jobs, voyages } = data

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-start gap-4">
        <button onClick={() => router.push('/admin/vessels')} className="btn-ghost py-2 px-3 mt-1" aria-label="Back to vessels"><ArrowLeft className="h-4 w-4" /></button>
        <div className="h-14 w-14 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0"><Anchor className="h-7 w-7 text-brand-600" /></div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="page-title truncate">M.V. {vessel.name}</h1>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${vessel.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{vessel.is_active ? 'Active' : 'Inactive'}</span>
          </div>
          <p className="text-gray-500 mt-1 text-sm">
            {vessel.imo ? `IMO ${vessel.imo}` : 'No IMO'}{vessel.official_number ? ` · Official # ${vessel.official_number}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link href={`/admin/documents/${vessel.id}`} className="btn-secondary"><FolderOpen className="h-4 w-4" /><span className="hidden sm:inline">Documents</span></Link>
          {!edit && <button onClick={() => setEdit(true)} className="btn-secondary"><Pencil className="h-4 w-4" /><span className="hidden sm:inline">Edit</span></button>}
          {edit && <button onClick={save} disabled={saving} className="btn-primary">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save</button>}
        </div>
      </div>

      {edit && (
        <div className="card p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label className="label-base">Name</label><input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="input-base" /></div>
          <div className="flex items-end"><label className="inline-flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} />Active</label></div>
          <div><label className="label-base">IMO</label><input value={form.imo} onChange={e => setForm(p => ({ ...p, imo: e.target.value }))} className="input-base" /></div>
          <div><label className="label-base">Official #</label><input value={form.official_number} onChange={e => setForm(p => ({ ...p, official_number: e.target.value }))} className="input-base" /></div>
        </div>
      )}

      {/* Jobs */}
      <div className="card p-0 overflow-hidden">
        <h2 className="section-title px-4 pt-4 pb-3 flex items-center gap-2"><Briefcase className="h-4 w-4 text-gray-400" />Jobs ({jobs.length})</h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-gray-400 px-4 pb-4">No jobs linked to this vessel yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-500 border-y border-gray-100 bg-gray-50/50"><th className="px-4 py-2 font-medium">Report</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 font-medium">Date</th></tr></thead>
              <tbody>
                {jobs.map(j => (
                  <tr key={j.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-2.5"><Link href={`/admin/jobs/${j.id}`} className="text-brand-700 hover:underline font-medium tnum">{j.report_number || '—'}</Link><span className="block text-xs text-gray-400 truncate max-w-[16rem]">{j.title}</span></td>
                    <td className="px-4 py-2.5"><WorkflowPill status={j.workflow_status as WorkflowStatus} /></td>
                    <td className="px-4 py-2.5 text-gray-500 tnum">{formatDate(j.scheduled_date ?? j.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cargo voyages */}
      <div className="card p-0 overflow-hidden">
        <h2 className="section-title px-4 pt-4 pb-3 flex items-center gap-2"><Ship className="h-4 w-4 text-gray-400" />Cargo voyages ({voyages.length})</h2>
        {voyages.length === 0 ? (
          <p className="text-sm text-gray-400 px-4 pb-4">No cargo voyages linked to this vessel yet.</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {voyages.map(v => (
              <Link key={v.id} href={`/admin/cargo/cloud/${v.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
                <Ship className="h-4 w-4 text-gray-300 flex-shrink-0" />
                <span className="flex-1 text-sm text-gray-800">{v.voyage_number || 'Voyage'}</span>
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${v.status === 'finalized' ? 'bg-green-100 text-green-700' : 'bg-sky-100 text-sky-700'}`}>{v.status === 'finalized' ? 'Finalized' : 'In progress'}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
