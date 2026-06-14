'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Mail, Phone, Briefcase, Clock, Settings, IdCard, Car } from 'lucide-react'
import { getPersonDetail, type PersonDetail } from '@/lib/team/api'
import { money } from '@/lib/jobs/tracker'
import { WorkflowPill } from '@/components/job/StatusPill'
import CredentialsManager from '@/components/personal-docs/CredentialsManager'
import { formatDate } from '@/lib/utils'
import type { WorkflowStatus } from '@/lib/types/database'

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', surveyor: 'Surveyor', office: 'Office', client: 'Client' }

export default function PersonRecordPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [data, setData] = useState<PersonDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    getPersonDetail(params.id).then(d => { if (active) { setData(d); setLoading(false) } }).catch(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [params.id])

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
  if (!data) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <h1 className="page-title mb-2">Person not found</h1>
        <Link href="/admin/users" className="btn-secondary">Back to team</Link>
      </div>
    )
  }

  const { profile: p, totalRegular, totalOvertime, pay, jobs } = data
  const isStaff = p.role === 'surveyor' || p.role === 'admin'

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button onClick={() => router.push('/admin/users')} className="btn-ghost py-2 px-3 mt-1" aria-label="Back to team"><ArrowLeft className="h-4 w-4" /></button>
        <div className="w-14 h-14 rounded-full bg-brand-700 flex items-center justify-center text-white font-semibold text-lg flex-shrink-0">{p.full_name.charAt(0).toUpperCase()}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="page-title truncate">{p.full_name}</h1>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-brand-50 text-brand-700">{p.display_title || ROLE_LABEL[p.role] || p.role}{p.is_super_admin ? ' · super' : ''}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{p.is_active ? 'Active' : 'Inactive'}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-500">
            {p.email && <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1 hover:text-brand-700"><Mail className="h-3.5 w-3.5" />{p.email}</a>}
            {p.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{p.phone}</span>}
            {p.employee_number && <span className="inline-flex items-center gap-1"><IdCard className="h-3.5 w-3.5" />#{p.employee_number}</span>}
            {p.vehicle_number && <span className="inline-flex items-center gap-1"><Car className="h-3.5 w-3.5" />{p.vehicle_number}</span>}
          </div>
        </div>
        <Link href="/admin/users" className="btn-secondary flex-shrink-0"><Settings className="h-4 w-4" /><span className="hidden sm:inline">Manage</span></Link>
      </div>

      {/* Work summary (staff) */}
      {isStaff && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Stat label="Jobs" value={String(jobs.length)} icon={<Briefcase className="h-4 w-4" />} />
          <Stat label="Regular hours" value={String(totalRegular)} icon={<Clock className="h-4 w-4" />} />
          <Stat label="Overtime hours" value={String(totalOvertime)} icon={<Clock className="h-4 w-4 text-amber-500" />} />
          <div className="card p-4">
            <p className="text-xs font-medium text-gray-400 mb-1">Pay</p>
            {pay.length === 0 ? <p className="text-sm text-gray-400">—</p> : (
              <div className="space-y-0.5">{pay.map(x => <p key={x.currency} className="text-sm text-gray-800 tnum">{money(x.total, x.currency)}</p>)}</div>
            )}
          </div>
        </div>
      )}

      {/* Credentials (staff) */}
      {isStaff && (
        <div className="card p-5">
          <h2 className="section-title mb-4">Credentials &amp; documents</h2>
          <CredentialsManager profileId={p.id} canManage ownerName={p.full_name} showCopy />
        </div>
      )}

      {/* Assigned jobs (staff) */}
      {isStaff && (
        <div className="card p-0 overflow-hidden">
          <h2 className="section-title px-4 pt-4 pb-3">Jobs ({jobs.length})</h2>
          {jobs.length === 0 ? (
            <p className="text-sm text-gray-400 px-4 pb-4">No jobs assigned yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500 border-y border-gray-100 bg-gray-50/50"><th className="px-4 py-2 font-medium">Report</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 font-medium">Hours</th><th className="px-4 py-2 font-medium">Date</th></tr></thead>
                <tbody>
                  {jobs.map(j => (
                    <tr key={j.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-2.5"><Link href={`/admin/jobs/${j.id}`} className="text-brand-700 hover:underline font-medium tnum">{j.report_number || '—'}</Link><span className="block text-xs text-gray-400 truncate max-w-[16rem]">{j.title}</span></td>
                      <td className="px-4 py-2.5"><WorkflowPill status={j.workflow_status as WorkflowStatus} /></td>
                      <td className="px-4 py-2.5 text-gray-600 tnum">{j.regular_hours || 0}h{j.overtime_hours ? ` +${j.overtime_hours} OT` : ''}</td>
                      <td className="px-4 py-2.5 text-gray-500 tnum">{formatDate(j.scheduled_date ?? j.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!isStaff && (
        <div className="card p-6 text-sm text-gray-500">This is a {ROLE_LABEL[p.role] ?? p.role} account. Manage role, access and status from <Link href="/admin/users" className="text-brand-600 hover:underline">Team</Link>.</div>
      )}
    </div>
  )
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-400 mb-1">{icon}{label}</div>
      <p className="text-2xl font-semibold text-gray-900 tnum">{value}</p>
    </div>
  )
}
