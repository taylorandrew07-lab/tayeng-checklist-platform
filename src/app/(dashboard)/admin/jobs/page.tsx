'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/utils'
import { useRealtimeRefresh } from '@/lib/realtime'
import { WORKFLOW } from '@/lib/jobs/tracker'
import type { WorkflowStatus } from '@/lib/types/database'

type SortKey = 'report' | 'vessel' | 'type' | 'client' | 'date'
type SortDir = 'asc' | 'desc'
type Filter = 'open' | 'paid' | 'closed' | 'all'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'paid', label: 'Paid' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
]

function StatusPill({ status }: { status: WorkflowStatus }) {
  const w = WORKFLOW[status] ?? WORKFLOW.new
  return <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium ${w.pill}`}><span className={`h-1.5 w-1.5 rounded-full ${w.dot}`} />{w.label}</span>
}

function SortHeader({ label, col, sort, onSort }: {
  label: string; col: SortKey; sort: { key: SortKey; dir: SortDir }; onSort: (k: SortKey) => void
}) {
  const active = sort.key === col
  return (
    <th onClick={() => onSort(col)} className="text-left px-4 py-3 font-medium text-gray-700 cursor-pointer select-none hover:text-gray-900">
      <span className="inline-flex items-center gap-1">{label}<span className={`text-brand-600 ${active ? '' : 'opacity-0'}`}>{sort.dir === 'asc' ? '▲' : '▼'}</span></span>
    </th>
  )
}

export default function JobsTrackerPage() {
  const router = useRouter()
  const [jobs, setJobs] = useState<any[]>([])
  const [surveyorsByJob, setSurveyorsByJob] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('open')
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'date', dir: 'desc' })
  const tick = useRealtimeRefresh('jobs')

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const [{ data: j }, { data: js }] = await Promise.all([
        supabase.from('jobs').select(`
          id, title, job_number, report_number, job_type, status, workflow_status,
          created_at, vessel_name, surveyor_name, client:clients(name)
        `).order('created_at', { ascending: false }),
        supabase.from('job_surveyors').select('job_id, surveyor:profiles!job_surveyors_surveyor_id_fkey(full_name, display_title)'),
      ])
      setJobs(j ?? [])
      const map: Record<string, string[]> = {}
      for (const r of (js ?? []) as any[]) {
        const name = r.surveyor?.display_title ?? r.surveyor?.full_name
        if (name) (map[r.job_id] ??= []).push(name)
      }
      setSurveyorsByJob(map)
      setLoading(false)
    }
    load()
  }, [tick])

  function handleSort(key: SortKey) {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'date' ? 'desc' : 'asc' })
  }

  function surveyorLabel(job: any): string {
    const names = surveyorsByJob[job.id] ?? (job.surveyor_name ? [job.surveyor_name] : [])
    if (names.length === 0) return '—'
    return names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`
  }

  const visible = useMemo(() => {
    const byFilter = jobs.filter(j => {
      const ws = j.workflow_status as WorkflowStatus
      if (filter === 'all') return true
      if (filter === 'paid') return ws === 'paid'
      if (filter === 'closed') return ws === 'closed'
      return ws !== 'paid' && ws !== 'closed' // open
    })
    const val = (j: any): string => {
      switch (sort.key) {
        case 'report': return j.report_number ?? ''
        case 'vessel': return (j.vessel_name ?? '').toLowerCase()
        case 'type': return (j.job_type ?? '').toLowerCase()
        case 'client': return (j.client?.name ?? '').toLowerCase()
        case 'date': default: return j.created_at ?? ''
      }
    }
    const dir = sort.dir === 'asc' ? 1 : -1
    return byFilter.sort((a, b) => { const va = val(a), vb = val(b); return va < vb ? -dir : va > vb ? dir : 0 })
  }, [jobs, filter, sort, surveyorsByJob]) // eslint-disable-line react-hooks/exhaustive-deps

  const open = (id: string) => router.push(`/admin/jobs/${id}`)

  return (
    <div className="space-y-5 max-w-6xl mx-auto animate-rise">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Jobs Tracker</h1>
          <p className="text-gray-500 mt-1">{loading ? '…' : `${visible.length} ${filter === 'all' ? '' : filter} job${visible.length !== 1 ? 's' : ''}`.replace('  ', ' ')}</p>
        </div>
        <Link href="/admin/jobs/new" className="btn-primary"><Plus className="h-4 w-4" />New Job</Link>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`text-sm px-3 py-1 rounded-full border transition-colors ${filter === f.key ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Table — wider screens / landscape */}
      <div className="card overflow-hidden hidden sm:block landscape:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <SortHeader label="Report #" col="report" sort={sort} onSort={handleSort} />
                <SortHeader label="Vessel" col="vessel" sort={sort} onSort={handleSort} />
                <SortHeader label="Type" col="type" sort={sort} onSort={handleSort} />
                <SortHeader label="Client" col="client" sort={sort} onSort={handleSort} />
                <th className="text-left px-4 py-3 font-medium text-gray-700">Surveyor</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Status</th>
                <SortHeader label="Date" col="date" sort={sort} onSort={handleSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                [0, 1, 2, 3, 4].map(i => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, k) => <td key={k} className="px-4 py-3"><div className="skeleton h-3.5 w-20" /></td>)}
                  </tr>
                ))
              ) : visible.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">No {filter === 'all' ? '' : filter} jobs. <Link href="/admin/jobs/new" className="text-brand-600 hover:underline">Create one →</Link></td></tr>
              ) : visible.map(job => (
                <tr key={job.id} onClick={() => open(job.id)} className="hover:bg-gray-50 cursor-pointer">
                  <td className="px-4 py-3 font-medium text-gray-900 tnum whitespace-nowrap">{job.report_number ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3 text-gray-900">{job.vessel_name ?? <span className="text-gray-400">—</span>}</td>
                  <td className="px-4 py-3 text-gray-600">{job.job_type ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{job.client?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{surveyorLabel(job)}</td>
                  <td className="px-4 py-3"><StatusPill status={job.workflow_status} /></td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(job.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stacked cards — portrait / narrow */}
      <div className="space-y-3 sm:hidden landscape:hidden">
        {loading ? (
          [0, 1, 2].map(i => <div key={i} className="card p-4 space-y-2"><div className="skeleton h-4 w-28" /><div className="skeleton h-3 w-40" /></div>)
        ) : visible.length === 0 ? (
          <div className="card p-8 text-center text-gray-400">No {filter === 'all' ? '' : filter} jobs. <Link href="/admin/jobs/new" className="text-brand-600 hover:underline">Create one →</Link></div>
        ) : visible.map(job => (
          <div key={job.id} onClick={() => open(job.id)} className="card p-4 cursor-pointer hover:shadow-md transition-shadow space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-gray-900">{job.vessel_name ?? job.title ?? 'Untitled'}</p>
                <p className="text-xs text-gray-400 tnum">{job.report_number ?? '—'}{job.job_type ? ` · ${job.job_type}` : ''}</p>
              </div>
              <StatusPill status={job.workflow_status} />
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm pt-1">
              <div><p className="text-[11px] text-gray-400">Client</p><p className="text-gray-700">{job.client?.name ?? '—'}</p></div>
              <div><p className="text-[11px] text-gray-400">Surveyor</p><p className="text-gray-700">{surveyorLabel(job)}</p></div>
              <div><p className="text-[11px] text-gray-400">Date</p><p className="text-gray-700">{formatDate(job.created_at)}</p></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
