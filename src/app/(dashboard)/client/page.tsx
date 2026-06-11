'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2, ClipboardList } from 'lucide-react'
import { getJobStatusLabel, getJobStatusColor } from '@/lib/utils'
import { useRealtimeRefresh } from '@/lib/realtime'

const LOGO_BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/client-logos`

type PermittedJob = {
  can_view_status: boolean
  can_view_pdf: boolean
  can_view_checklist_details: boolean
  job: {
    id: string
    job_number: string
    title: string
    status: string
    scheduled_date: string | null
    template: { name: string } | null
  } | null
}

export default function ClientPortal() {
  const router = useRouter()
  const [clientName, setClientName] = useState<string | null>(null)
  const [clientLogo, setClientLogo] = useState<string | null>(null)
  const [jobs, setJobs] = useState<PermittedJob[]>([])
  const [loading, setLoading] = useState(true)
  const [noClient, setNoClient] = useState(false)
  const tick = useRealtimeRefresh('jobs')

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // Find the client company this user belongs to
      const { data: link } = await supabase
        .from('client_users')
        .select('client_id, client:clients(name, logo_path)')
        .eq('profile_id', user.id)
        .single()

      if (!link) { setNoClient(true); setLoading(false); return }

      const clientObj = (link as any).client
      setClientName(clientObj?.name ?? null)
      setClientLogo(clientObj?.logo_path ? `${LOGO_BASE}/${clientObj.logo_path}` : null)

      // Load all jobs this client has permission to see
      const { data: perms } = await supabase
        .from('client_job_permissions')
        .select(`
          can_view_status, can_view_pdf, can_view_checklist_details,
          job:jobs(
            id, job_number, title, status, scheduled_date,
            template:checklist_templates(name)
          )
        `)
        .eq('client_id', link.client_id)
        .order('created_at', { ascending: false })

      // Supabase returns nested relations as arrays; normalize to single objects.
      // When "View status" is off, RLS hides the job row (job is null) so the
      // permission alone never reveals a job — drop those entries entirely.
      const normalized: PermittedJob[] = ((perms ?? []) as any[])
        .map((p: any) => ({
          can_view_status: p.can_view_status,
          can_view_pdf: p.can_view_pdf,
          can_view_checklist_details: p.can_view_checklist_details,
          job: Array.isArray(p.job) ? (p.job[0] ?? null) : (p.job ?? null),
        }))
        .filter(p => p.job !== null)
      setJobs(normalized)
      setLoading(false)
    }
    load()
  }, [router, tick])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
      </div>
    )
  }

  if (noClient) {
    return (
      <div className="max-w-lg mx-auto text-center py-20">
        <ClipboardList className="h-12 w-12 mx-auto text-gray-300 mb-4" />
        <h2 className="text-lg font-semibold text-gray-700 mb-2">No client account linked</h2>
        <p className="text-gray-500 text-sm">
          Your account has not been linked to a client company yet. Please contact your administrator.
        </p>
      </div>
    )
  }

  const visibleJobs = jobs.filter(p => p.job !== null)

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        {clientLogo && (
          <img src={clientLogo} alt="" className="h-12 w-12 rounded-lg object-contain bg-white border border-gray-200 flex-shrink-0" />
        )}
        <div>
          <h1 className="page-title">Jobs{clientName ? ` — ${clientName}` : ''}</h1>
          <p className="text-gray-500 mt-1">{visibleJobs.length} job{visibleJobs.length !== 1 ? 's' : ''} visible to you</p>
        </div>
      </div>

      {/* "Needs your attention" placeholder — clients have no attention items yet.
          When they do (e.g. new reports to acknowledge), build the AttentionItem[]
          here and render <AttentionCard items={...} /> as on the staff dashboards. */}

      {visibleJobs.length === 0 ? (
        <div className="card p-12 text-center">
          <ClipboardList className="h-10 w-10 mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">No checklists available yet.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-700">Document</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Template</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Scheduled</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Access</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleJobs.map((perm) => {
                const job = perm.job!
                return (
                  <tr key={job.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-gray-900">{job.title}</p>
                        <p className="text-xs text-gray-400">{job.job_number}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{job.template?.name ?? '—'}</td>
                    <td className="px-4 py-3">
                      {perm.can_view_status ? (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getJobStatusColor(job.status as any)}`}>
                          {getJobStatusLabel(job.status as any)}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{job.scheduled_date ?? '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {perm.can_view_pdf && (
                          <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">PDF</span>
                        )}
                        {perm.can_view_checklist_details && (
                          <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">Details</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {(perm.can_view_pdf || perm.can_view_checklist_details) && (
                        <Link href={`/client/jobs/${job.id}`} className="text-xs text-brand-600 hover:text-brand-800 font-medium">
                          View →
                        </Link>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  )
}
