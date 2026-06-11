'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { getJobStatusColor, getJobStatusLabel, formatDate } from '@/lib/utils'
import { useRealtimeRefresh } from '@/lib/realtime'

export default function AdminChecklistsPage() {
  const [jobs, setJobs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const tick = useRealtimeRefresh('jobs')

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data } = await supabase
        .from('jobs')
        .select(`
          id, title, job_number, status, created_at, vessel_name, surveyor_name,
          template:checklist_templates(name),
          client:clients(name)
        `)
        .order('created_at', { ascending: false })
      setJobs(data ?? [])
      setLoading(false)
    }
    load()
  }, [tick])

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Jobs</h1>
          <p className="text-gray-500 mt-1">{loading ? '…' : `${jobs.length} job${jobs.length !== 1 ? 's' : ''}`}</p>
        </div>
        <Link href="/admin/jobs/new" className="btn-primary"><Plus className="h-4 w-4" />New Job</Link>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-700">Document</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Template</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Client</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Surveyor</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Loading…</td></tr>
              ) : jobs.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">No checklists yet. <Link href="/admin/jobs/new" className="text-brand-600 hover:underline">Create one →</Link></td></tr>
              ) : jobs.map((job) => (
                <tr key={job.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{job.title}</p>
                    <p className="text-xs text-gray-400">{job.job_number}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{job.template?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{job.client?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{job.surveyor_name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getJobStatusColor(job.status)}`}>
                      {getJobStatusLabel(job.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(job.created_at)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/jobs/${job.id}`} className="text-xs text-brand-600 hover:text-brand-800 font-medium">View →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
