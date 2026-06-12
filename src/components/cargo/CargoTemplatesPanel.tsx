'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Ship, Edit, Trash2, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { type CargoTemplate } from '@/lib/cargo/types'
import { confirmDialog } from '@/components/ui/confirm'

const statusColor: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  draft: 'bg-gray-100 text-gray-700',
  archived: 'bg-red-100 text-red-700',
}

export default function CargoTemplatesPanel() {
  const [templates, setTemplates] = useState<CargoTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  async function load() {
    const supabase = createClient()
    const { data, error } = await supabase.from('cargo_templates').select('*').order('created_at', { ascending: false })
    if (error) setError(error.message)
    setTemplates((data as CargoTemplate[]) ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleDelete(t: CargoTemplate) {
    if (!(await confirmDialog({ title: 'Delete template', message: `Permanently delete "${t.name}"? Existing voyages keep their own copy of the readings; this only removes the template.`, danger: true, confirmLabel: 'Delete' }))) return
    setDeleting(t.id)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.from('cargo_templates').delete().eq('id', t.id)
    setDeleting(null)
    if (error) { setError(`Could not delete "${t.name}": ${error.message}`); return }
    load()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {loading ? '…' : `${templates.length} cargo template${templates.length !== 1 ? 's' : ''}`}
        </p>
        <Link href="/admin/templates/cargo/new" className="btn-primary"><Plus className="h-4 w-4" />New Cargo Template</Link>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="card p-10 flex items-center justify-center text-gray-400"><Loader2 className="h-6 w-6 animate-spin mr-2" />Loading…</div>
      ) : templates.length === 0 ? (
        <div className="card p-10 text-center text-gray-400">
          No cargo templates yet. <Link href="/admin/templates/cargo/new" className="text-brand-600 hover:underline">Create one →</Link>
        </div>
      ) : templates.map(t => (
        <div key={t.id} className="card p-4 sm:p-5 hover:shadow-md transition-shadow">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            <div className="flex items-start gap-3 sm:contents">
              <div className="w-10 h-10 rounded-lg bg-brand-100 flex items-center justify-center flex-shrink-0 mt-0.5 sm:mt-0">
                <Ship className="h-5 w-5 text-brand-700" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-medium text-gray-900 truncate">{t.name}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${statusColor[t.status] ?? statusColor.draft}`}>{t.status}</span>
                </div>
                <p className="text-sm text-gray-500 mt-0.5 truncate">
                  {t.description && `${t.description} · `}
                  {t.default_hold_count} holds · {t.reading_types?.length ?? 0} reading types
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 border-t border-gray-100 pt-2.5 sm:border-t-0 sm:pt-0 sm:flex-nowrap sm:gap-2 sm:flex-shrink-0">
              <Link href={`/admin/templates/cargo/${t.id}/edit`} className="btn-secondary py-1.5 px-3 text-xs"><Edit className="h-3.5 w-3.5" />Edit</Link>
              <button onClick={() => handleDelete(t)} disabled={deleting === t.id} className="btn-ghost py-1.5 px-3 text-xs text-red-600 hover:text-red-700 hover:bg-red-50">
                {deleting === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}Delete
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
