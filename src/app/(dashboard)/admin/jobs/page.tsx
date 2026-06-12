'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { getJobStatusColor, getJobStatusLabel, formatDate } from '@/lib/utils'
import { useRealtimeRefresh } from '@/lib/realtime'

type SortKey = 'vessel' | 'date' | 'client' | 'surveyor' | 'status'
type SortDir = 'asc' | 'desc'

/** Sortable column header. Module-level so it isn't re-created each render. */
function SortHeader({ label, col, sort, onSort }: {
  label: string; col: SortKey; sort: { key: SortKey; dir: SortDir }; onSort: (k: SortKey) => void
}) {
  const active = sort.key === col
  return (
    <th
      onClick={() => onSort(col)}
      className="text-left px-4 py-3 font-medium text-gray-700 cursor-pointer select-none hover:text-gray-900"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`text-brand-600 ${active ? '' : 'opacity-0'}`}>{sort.dir === 'asc' ? '▲' : '▼'}</span>
      </span>
    </th>
  )
}

export default function AdminChecklistsPage() {
  const router = useRouter()
  const [jobs, setJobs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'date', dir: 'desc' })
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

  function handleSort(key: SortKey) {
    setSort(s => s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'date' ? 'desc' : 'asc' })
  }

  const sorted = useMemo(() => {
    const val = (j: any): string => {
      switch (sort.key) {
        case 'vessel': return (j.vessel_name ?? '').toLowerCase()
        case 'client': return (j.client?.name ?? '').toLowerCase()
        case 'surveyor': return (j.surveyor_name ?? '').toLowerCase()
        case 'status': return getJobStatusLabel(j.status).toLowerCase()
        case 'date': default: return j.created_at ?? ''
      }
    }
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...jobs].sort((a, b) => {
      const va = val(a), vb = val(b)
      if (va < vb) return -1 * dir
      if (va > vb) return 1 * dir
      return 0
    })
  }, [jobs, sort])

  const open = (id: string) => router.push(`/admin/jobs/${id}`)

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Jobs</h1>
          <p className="text-gray-500 mt-1">{loading ? '…' : `${jobs.length} job${jobs.length !== 1 ? 's' : ''}`}</p>
        </div>
        <Link href="/admin/jobs/new" className="btn-primary"><Plus className="h-4 w-4" />New Job</Link>
      </div>

      {/* Table — shown on wider screens and whenever the device is landscape. */}
      <div className="card overflow-hidden hidden sm:block landscape:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <SortHeader label="Vessel" col="vessel" sort={sort} onSort={handleSort} />
                <SortHeader label="Date" col="date" sort={sort} onSort={handleSort} />
                <SortHeader label="Client" col="client" sort={sort} onSort={handleSort} />
                <SortHeader label="Surveyor" col="surveyor" sort={sort} onSort={handleSort} />
                <SortHeader label="Status" col="status" sort={sort} onSort={handleSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">Loading…</td></tr>
              ) : sorted.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">No jobs yet. <Link href="/admin/jobs/new" className="text-brand-600 hover:underline">Create one →</Link></td></tr>
              ) : sorted.map((job) => (
                <tr key={job.id} onClick={() => open(job.id)} className="hover:bg-gray-50 cursor-pointer">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{job.vessel_name ?? <span className="text-gray-400">—</span>}</p>
                    <p className="text-xs text-gray-400">{job.job_number}{job.title ? ` · ${job.title}` : ''}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(job.created_at)}</td>
                  <td className="px-4 py-3 text-gray-600">{job.client?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{job.surveyor_name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getJobStatusColor(job.status)}`}>
                      {getJobStatusLabel(job.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stacked cards — portrait / narrow screens, so nothing gets cut off. */}
      <div className="space-y-3 sm:hidden landscape:hidden">
        {!loading && jobs.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Sort</label>
            <select
              value={sort.key}
              onChange={e => handleSort(e.target.value as SortKey)}
              className="input-base py-1.5 text-sm flex-1"
            >
              <option value="date">Date</option>
              <option value="vessel">Vessel</option>
              <option value="client">Client</option>
              <option value="surveyor">Surveyor</option>
              <option value="status">Status</option>
            </select>
            <button
              onClick={() => setSort(s => ({ ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' }))}
              className="btn-secondary py-1.5 px-3 text-sm"
              aria-label="Toggle sort direction"
            >
              {sort.dir === 'asc' ? '▲' : '▼'}
            </button>
          </div>
        )}
        {loading ? (
          <div className="card p-8 text-center text-gray-400">Loading…</div>
        ) : sorted.length === 0 ? (
          <div className="card p-8 text-center text-gray-400">No jobs yet. <Link href="/admin/jobs/new" className="text-brand-600 hover:underline">Create one →</Link></div>
        ) : sorted.map((job) => (
          <div key={job.id} onClick={() => open(job.id)} className="card p-4 cursor-pointer hover:shadow-md transition-shadow space-y-2">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium text-gray-900">{job.vessel_name ?? job.title ?? 'Untitled'}</p>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${getJobStatusColor(job.status)}`}>
                {getJobStatusLabel(job.status)}
              </span>
            </div>
            <p className="text-xs text-gray-400">{job.job_number}{job.title ? ` · ${job.title}` : ''}</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm pt-1">
              <div><p className="text-[11px] text-gray-400">Date</p><p className="text-gray-700">{formatDate(job.created_at)}</p></div>
              <div><p className="text-[11px] text-gray-400">Client</p><p className="text-gray-700">{job.client?.name ?? '—'}</p></div>
              <div><p className="text-[11px] text-gray-400">Surveyor</p><p className="text-gray-700">{job.surveyor_name ?? '—'}</p></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
