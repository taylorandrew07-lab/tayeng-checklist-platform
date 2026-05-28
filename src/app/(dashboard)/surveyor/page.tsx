import Link from 'next/link'
import { Plus, ClipboardCheck } from 'lucide-react'

const DEMO_JOBS = [
  { id: '1', title: 'Draft Survey – MV Endeavour', job_number: 'TE-01001', status: 'in_progress', template: { name: 'Marine Draft Survey' }, client: { name: 'Pacific Shipping Co.' }, scheduled_date: '2026-05-28' },
  { id: '7', title: 'Bunker Survey – MV Neptune', job_number: 'TE-01007', status: 'in_progress', template: { name: 'Bunker Survey Checklist' }, client: { name: 'Acme Logistics' }, scheduled_date: '2026-05-27' },
  { id: '3', title: 'Cargo Inspection – Bulk Carrier', job_number: 'TE-01003', status: 'assigned', template: { name: 'Cargo Inspection' }, client: { name: 'Acme Logistics' }, scheduled_date: '2026-05-30' },
  { id: '4', title: 'Tank Calibration – Terminal A', job_number: 'TE-01004', status: 'completed', template: { name: 'Tank Calibration' }, client: { name: 'Pacific Shipping Co.' }, scheduled_date: '2026-05-18' },
  { id: '2', title: 'Bunker Survey – MV Aurora', job_number: 'TE-01002', status: 'submitted', template: { name: 'Bunker Survey Checklist' }, client: { name: 'Global Marine Ltd.' }, scheduled_date: '2026-05-22' },
]

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700', assigned: 'bg-blue-100 text-blue-700', in_progress: 'bg-yellow-100 text-yellow-700',
  submitted: 'bg-purple-100 text-purple-700', completed: 'bg-green-100 text-green-700',
}
const statusLabels: Record<string, string> = {
  draft: 'Draft', assigned: 'Assigned', in_progress: 'In Progress', submitted: 'Submitted', completed: 'Completed',
}

export default function SurveyorDashboard() {
  const active = DEMO_JOBS.filter(j => ['assigned', 'in_progress'].includes(j.status))
  const submitted = DEMO_JOBS.filter(j => ['submitted', 'completed'].includes(j.status))

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">My Jobs</h1>
          <p className="text-gray-500 mt-1">Welcome, James Wilson</p>
        </div>
        <Link href="/surveyor/jobs/new" className="btn-primary"><Plus className="h-4 w-4" />Start New Job</Link>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4 text-center"><p className="text-3xl font-bold text-yellow-600">{active.length}</p><p className="text-sm text-gray-500 mt-1">Active</p></div>
        <div className="card p-4 text-center"><p className="text-3xl font-bold text-purple-600">{submitted.length}</p><p className="text-sm text-gray-500 mt-1">Submitted</p></div>
        <div className="card p-4 text-center"><p className="text-3xl font-bold text-gray-600">0</p><p className="text-sm text-gray-500 mt-1">Draft</p></div>
      </div>

      <div>
        <h2 className="section-title mb-3">Active Jobs</h2>
        <div className="space-y-3">
          {active.map(job => (
            <Link key={job.id} href={`/surveyor/jobs/${job.id}`} className="card p-4 flex items-center gap-4 hover:shadow-md transition-shadow block">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-gray-900 truncate">{job.title}</p>
                  <span className="text-xs text-gray-400">{job.job_number}</span>
                </div>
                <p className="text-sm text-gray-500 mt-0.5">{job.template.name} · {job.client.name} · {job.scheduled_date}</p>
              </div>
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0 ${statusColors[job.status]}`}>{statusLabels[job.status]}</span>
            </Link>
          ))}
        </div>
      </div>

      <div>
        <h2 className="section-title mb-3">Submitted / Completed</h2>
        <div className="space-y-3">
          {submitted.map(job => (
            <Link key={job.id} href={`/surveyor/jobs/${job.id}`} className="card p-4 flex items-center gap-4 hover:shadow-md transition-shadow block">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-gray-900 truncate">{job.title}</p>
                  <span className="text-xs text-gray-400">{job.job_number}</span>
                </div>
                <p className="text-sm text-gray-500 mt-0.5">{job.template.name} · {job.client.name} · {job.scheduled_date}</p>
              </div>
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0 ${statusColors[job.status]}`}>{statusLabels[job.status]}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
