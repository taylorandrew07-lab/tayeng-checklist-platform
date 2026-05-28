import Link from 'next/link'
import { Plus, FileText, Copy, Edit } from 'lucide-react'

const DEMO_TEMPLATES = [
  { id: '1', name: 'Marine Draft Survey', description: 'Complete draught survey checklist for bulk carriers', status: 'active', version: 3, allow_surveyor_start: true, created_at: '2026-01-15', creator: { full_name: 'Andrew Taylor' } },
  { id: '2', name: 'Bunker Survey Checklist', description: 'Fuel oil bunker quantity survey', status: 'active', version: 2, allow_surveyor_start: false, created_at: '2026-02-10', creator: { full_name: 'Andrew Taylor' } },
  { id: '3', name: 'Cargo Inspection Report', description: 'General cargo inspection and condition report', status: 'active', version: 1, allow_surveyor_start: true, created_at: '2026-03-05', creator: { full_name: 'Andrew Taylor' } },
  { id: '4', name: 'Tank Calibration Survey', description: 'Shore tank ullage and calibration survey', status: 'active', version: 4, allow_surveyor_start: false, created_at: '2025-11-20', creator: { full_name: 'Andrew Taylor' } },
  { id: '5', name: 'Hatch Survey', description: 'Pre-loading hatch condition inspection', status: 'draft', version: 1, allow_surveyor_start: false, created_at: '2026-05-01', creator: { full_name: 'James Wilson' } },
  { id: '6', name: 'Marine Warranty Survey (Legacy)', description: 'Old format — replaced by v2', status: 'archived', version: 1, allow_surveyor_start: false, created_at: '2024-08-10', creator: { full_name: 'Andrew Taylor' } },
]

const statusColor: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  draft: 'bg-gray-100 text-gray-700',
  archived: 'bg-red-100 text-red-700',
}

export default function TemplatesPage() {
  const grouped = { active: DEMO_TEMPLATES.filter(t => t.status === 'active'), draft: DEMO_TEMPLATES.filter(t => t.status === 'draft'), archived: DEMO_TEMPLATES.filter(t => t.status === 'archived') }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Checklist Templates</h1>
          <p className="text-gray-500 mt-1">{DEMO_TEMPLATES.length} templates total</p>
        </div>
        <Link href="/admin/templates/new" className="btn-primary">
          <Plus className="h-4 w-4" />New Template
        </Link>
      </div>

      <div className="flex gap-2">
        {[
          { label: `Active (${grouped.active.length})`, color: 'bg-green-100 text-green-700' },
          { label: `Draft (${grouped.draft.length})`, color: 'bg-gray-100 text-gray-700' },
          { label: `Archived (${grouped.archived.length})`, color: 'bg-red-100 text-red-700' },
        ].map(pill => (
          <span key={pill.label} className={`text-xs font-medium px-3 py-1 rounded-full ${pill.color}`}>{pill.label}</span>
        ))}
      </div>

      <div className="space-y-3">
        {DEMO_TEMPLATES.map((template) => (
          <div key={template.id} className="card p-5 flex items-center gap-4 hover:shadow-md transition-shadow">
            <div className="w-10 h-10 rounded-lg bg-brand-100 flex items-center justify-center flex-shrink-0">
              <FileText className="h-5 w-5 text-brand-700" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-gray-900 truncate">{template.name}</h3>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[template.status]}`}>{template.status}</span>
                {template.allow_surveyor_start && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700">Surveyor start</span>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-0.5 truncate">
                {template.description} · v{template.version} · {template.creator.full_name} · {template.created_at}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Link href={`/admin/templates/${template.id}/edit`} className="btn-secondary py-1.5 px-3 text-xs">
                <Edit className="h-3.5 w-3.5" />Edit
              </Link>
              <Link href="/admin/templates/new" className="btn-ghost py-1.5 px-3 text-xs">
                <Copy className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
