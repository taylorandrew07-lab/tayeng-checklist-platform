import Link from 'next/link'
import { Plus, Briefcase } from 'lucide-react'

const DEMO_JOBS = [
  { id: '1', title: 'Draft Survey – MV Endeavour', job_number: 'TE-01001', status: 'in_progress', template: { name: 'Marine Draft Survey' }, assignee: { full_name: 'James Wilson' }, client: { name: 'Pacific Shipping Co.' }, scheduled_date: '2026-05-28' },
  { id: '2', title: 'Bunker Survey – MV Aurora', job_number: 'TE-01002', status: 'submitted', template: { name: 'Bunker Survey Checklist' }, assignee: { full_name: 'Sarah Chen' }, client: { name: 'Global Marine Ltd.' }, scheduled_date: '2026-05-22' },
  { id: '3', title: 'Cargo Inspection – Bulk Carrier', job_number: 'TE-01003', status: 'assigned', template: { name: 'Cargo Inspection' }, assignee: { full_name: 'Mike Roberts' }, client: { name: 'Acme Logistics' }, scheduled_date: '2026-05-30' },
  { id: '4', title: 'Tank Calibration – Terminal A', job_number: 'TE-01004', status: 'completed', template: { name: 'Tank Calibration' }, assignee: { full_name: 'James Wilson' }, client: { name: 'Pacific Shipping Co.' }, scheduled_date: '2026-05-18' },
  { id: '5', title: 'Hatch Survey – MV Titan', job_number: 'TE-01005', status: 'draft', template: { name: 'Hatch Survey' }, assignee: null, client: null, scheduled_date: null },
  { id: '6', title: 'Draft Survey – MV Pacific Star', job_number: 'TE-01006', status: 'client_visible', template: { name: 'Marine Draft Survey' }, assignee: { full_name: 'Sarah Chen' }, client: { name: 'Global Marine Ltd.' }, scheduled_date: '2026-05-15' },
  { id: '7', title: 'Bunker Survey – MV Neptune', job_number: 'TE-01007', status: 'in_progress', template: { name: 'Bunker Survey Checklist' }, assignee: { full_name: 'Mike Roberts' }, client: { name: 'Acme Logistics' }, scheduled_date: '2026-05-27' },
]

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700', assigned: 'bg-blue-100 text-blue-700', in_progress: 'bg-yellow-100 text-yellow-700',
  submitted: 'bg-purple-100 text-purple-700', completed: 'bg-green-100 text-green-700', client_visible: 'bg-teal-100 text-teal-700', archived: 'bg-red-100 text-red-700',
}
const statusLabels: Record<string, string> = {
  draft: 'Draft', assigned: 'Assigned', in_progress: 'In Progress', submitted: 'Submitted', completed: 'Completed', client_visible: 'Client Visible', archived: 'Archived',
}

export default function AdminJobsPage() {
  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Jobs</h1>
          <p className="text-gray-500 mt-1">{DEMO_JOBS.length} jobs</p>
        </div>
        <Link href="/admin/jobs/new" className="btn-primary"><Plus className="h-4 w-4" />New Job</Link>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-700">Job</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Template</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Client</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Assignee</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">Scheduled</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {DEMO_JOBS.map((job) => (
                <tr key={job.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium text-gray-900">{job.title}</p>
                      <p className="text-xs text-gray-400">{job.job_number}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{job.template.name}</td>
                  <td className="px-4 py-3 text-gray-600">{job.client?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{job.assignee?.full_name ?? 'Unassigned'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[job.status]}`}>{statusLabels[job.status]}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{job.scheduled_date ?? '—'}</td>
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
