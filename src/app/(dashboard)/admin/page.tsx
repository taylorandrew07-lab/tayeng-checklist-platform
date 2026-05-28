import Link from 'next/link'
import { FileText, Briefcase, Users, Building2, ClipboardCheck, Clock, CheckCircle2, AlertCircle } from 'lucide-react'

const DEMO_JOBS = [
  { id: '1', title: 'Draft Survey – MV Endeavour', job_number: 'TE-01001', status: 'in_progress', template: { name: 'Marine Draft Survey' }, assignee: { full_name: 'James Wilson' }, client: { name: 'Pacific Shipping Co.' }, created_at: '2026-05-20' },
  { id: '2', title: 'Bunker Survey – MV Aurora', job_number: 'TE-01002', status: 'submitted', template: { name: 'Bunker Survey Checklist' }, assignee: { full_name: 'Sarah Chen' }, client: { name: 'Global Marine Ltd.' }, created_at: '2026-05-22' },
  { id: '3', title: 'Cargo Inspection – Bulk Carrier', job_number: 'TE-01003', status: 'assigned', template: { name: 'Cargo Inspection' }, assignee: { full_name: 'Mike Roberts' }, client: { name: 'Acme Logistics' }, created_at: '2026-05-24' },
  { id: '4', title: 'Tank Calibration – Terminal A', job_number: 'TE-01004', status: 'completed', template: { name: 'Tank Calibration' }, assignee: { full_name: 'James Wilson' }, client: { name: 'Pacific Shipping Co.' }, created_at: '2026-05-18' },
  { id: '5', title: 'Hatch Survey – MV Titan', job_number: 'TE-01005', status: 'draft', template: { name: 'Hatch Survey' }, assignee: null, client: null, created_at: '2026-05-26' },
]

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  assigned: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  submitted: 'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700',
  client_visible: 'bg-teal-100 text-teal-700',
  archived: 'bg-red-100 text-red-700',
}

const statusLabels: Record<string, string> = {
  draft: 'Draft', assigned: 'Assigned', in_progress: 'In Progress',
  submitted: 'Submitted', completed: 'Completed', client_visible: 'Client Visible', archived: 'Archived',
}

export default function AdminDashboard() {
  const stats = [
    { label: 'Templates', value: 6, icon: FileText, href: '/admin/templates', color: 'bg-blue-500' },
    { label: 'Total Jobs', value: 24, icon: Briefcase, href: '/admin/jobs', color: 'bg-indigo-500' },
    { label: 'Users', value: 8, icon: Users, href: '/admin/users', color: 'bg-purple-500' },
    { label: 'Clients', value: 5, icon: Building2, href: '/admin/clients', color: 'bg-pink-500' },
  ]

  const jobStats = [
    { label: 'Assigned', value: 4, icon: Clock, color: 'text-blue-600 bg-blue-50' },
    { label: 'In Progress', value: 7, icon: AlertCircle, color: 'text-yellow-600 bg-yellow-50' },
    { label: 'Submitted', value: 3, icon: CheckCircle2, color: 'text-purple-600 bg-purple-50' },
  ]

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="page-title">Admin Dashboard</h1>
        <p className="text-gray-500 mt-1">Overview of all platform activity</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href} className="card p-5 hover:shadow-md transition-shadow group">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">{stat.label}</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{stat.value}</p>
              </div>
              <div className={`w-12 h-12 rounded-xl ${stat.color} flex items-center justify-center`}>
                <stat.icon className="h-6 w-6 text-white" />
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {jobStats.map((stat) => (
          <div key={stat.label} className="card p-4 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-lg ${stat.color} flex items-center justify-center flex-shrink-0`}>
              <stat.icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
              <p className="text-sm text-gray-500">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="section-title">Recent Jobs</h2>
          <Link href="/admin/jobs" className="text-sm text-brand-600 hover:text-brand-800 font-medium">View all →</Link>
        </div>
        <div className="divide-y divide-gray-100">
          {DEMO_JOBS.map((job) => (
            <Link key={job.id} href={`/admin/jobs/${job.id}`} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-900 truncate">{job.title}</p>
                  <span className="text-xs text-gray-400">{job.job_number}</span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {job.client?.name ?? 'No client'} · {job.assignee?.full_name ?? 'Unassigned'} · {job.template.name}
                </p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[job.status]}`}>
                  {statusLabels[job.status]}
                </span>
                <span className="text-xs text-gray-400">{job.created_at}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'New Template', href: '/admin/templates/new', icon: FileText },
          { label: 'New Job', href: '/admin/jobs/new', icon: Briefcase },
          { label: 'Add User', href: '/admin/users', icon: Users },
          { label: 'Add Client', href: '/admin/clients', icon: Building2 },
        ].map((action) => (
          <Link key={action.label} href={action.href} className="btn-secondary justify-center py-3 flex-col gap-1 h-auto">
            <action.icon className="h-5 w-5" />
            <span>{action.label}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
