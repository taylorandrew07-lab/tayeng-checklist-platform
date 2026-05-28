import Link from 'next/link'
import { ClipboardList } from 'lucide-react'

const DEMO_JOBS = [
  { id: '4', title: 'Tank Calibration – Terminal A', job_number: 'TE-01004', status: 'completed', template: { name: 'Tank Calibration' }, scheduled_date: '2026-05-18', can_view_status: true, can_view_pdf: true, can_view_checklist_details: false },
  { id: '6', title: 'Draft Survey – MV Pacific Star', job_number: 'TE-01006', status: 'client_visible', template: { name: 'Marine Draft Survey' }, scheduled_date: '2026-05-15', can_view_status: true, can_view_pdf: true, can_view_checklist_details: true },
  { id: '2', title: 'Bunker Survey – MV Aurora', job_number: 'TE-01002', status: 'submitted', template: { name: 'Bunker Survey Checklist' }, scheduled_date: '2026-05-22', can_view_status: true, can_view_pdf: false, can_view_checklist_details: false },
]

const statusColors: Record<string, string> = {
  submitted: 'bg-purple-100 text-purple-700', completed: 'bg-green-100 text-green-700', client_visible: 'bg-teal-100 text-teal-700',
}
const statusLabels: Record<string, string> = {
  submitted: 'Submitted', completed: 'Completed', client_visible: 'Available',
}

export default function ClientPortal() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="page-title">Jobs — Global Marine Ltd.</h1>
        <p className="text-gray-500 mt-1">{DEMO_JOBS.length} jobs visible to you</p>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-700">Job</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Template</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Scheduled</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Access</th>
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
                <td className="px-4 py-3">
                  {job.can_view_status ? (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[job.status] ?? 'bg-gray-100 text-gray-700'}`}>{statusLabels[job.status] ?? job.status}</span>
                  ) : <span className="text-xs text-gray-400">—</span>}
                </td>
                <td className="px-4 py-3 text-gray-500">{job.scheduled_date}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1 flex-wrap">
                    {job.can_view_pdf && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">PDF</span>}
                    {job.can_view_checklist_details && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">Details</span>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {(job.can_view_pdf || job.can_view_checklist_details) && (
                    <Link href={`/client/jobs/${job.id}`} className="text-xs text-brand-600 hover:text-brand-800 font-medium">View →</Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
