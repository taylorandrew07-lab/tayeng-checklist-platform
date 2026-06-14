// Cross-entity quick search for the top bar. RLS scopes every query, so a
// surveyor only matches their own jobs; clients/invoices are admin/office only.
// Each category is capped — this is a "jump to it" search, not a report.

import { createClient } from '@/lib/supabase/client'

export interface SearchHit {
  kind: 'job' | 'client' | 'invoice'
  id: string
  title: string
  subtitle?: string
  href: string
}

export async function globalSearch(term: string, role: string): Promise<SearchHit[]> {
  // Keep only filter-safe characters so the PostgREST .or() string can't break.
  const safe = term.replace(/[^\w\s.\-/]/g, ' ').trim()
  if (safe.length < 2) return []
  const supabase = createClient()
  const like = `%${safe}%`
  const jobBase = role === 'surveyor' ? '/surveyor/jobs' : role === 'office' ? '/office/jobs' : '/admin/jobs'
  const adminish = role === 'admin' || role === 'office'

  const tasks: Promise<SearchHit[]>[] = []

  // Jobs — report #, vessel, title, surveyor name.
  tasks.push((async () => {
    const { data } = await supabase.from('jobs')
      .select('id, report_number, vessel_name, title, client:clients(name)')
      .or(`report_number.ilike.${like},vessel_name.ilike.${like},title.ilike.${like},surveyor_name.ilike.${like}`)
      .order('created_at', { ascending: false })
      .limit(6)
    return ((data ?? []) as any[]).map(j => ({
      kind: 'job' as const,
      id: j.id,
      title: j.report_number
        ? `${j.report_number} · ${j.vessel_name ? 'M.V. ' + j.vessel_name : j.title}`
        : (j.vessel_name ? `M.V. ${j.vessel_name}` : j.title),
      subtitle: [j.client?.name, j.title].filter(Boolean).join(' — ') || undefined,
      href: `${jobBase}/${j.id}`,
    }))
  })())

  if (adminish) {
    // Clients — by name.
    tasks.push((async () => {
      const { data } = await supabase.from('clients').select('id, name, contact_name').ilike('name', like).order('name').limit(5)
      return ((data ?? []) as any[]).map(c => ({
        kind: 'client' as const, id: c.id, title: c.name, subtitle: c.contact_name ?? undefined,
        href: `/admin/clients/${c.id}`,
      }))
    })())

    // Invoices — by number; jump to the job.
    tasks.push((async () => {
      const { data } = await supabase.from('invoices').select('id, invoice_number, status, total, currency, job_id').ilike('invoice_number', like).limit(5)
      return ((data ?? []) as any[]).map(inv => ({
        kind: 'invoice' as const, id: inv.id, title: inv.invoice_number ?? 'Invoice',
        subtitle: `${inv.status} · ${inv.currency ?? ''} ${Number(inv.total ?? 0).toLocaleString()}`.trim(),
        href: inv.job_id ? `/admin/jobs/${inv.job_id}` : '/admin/invoicing',
      }))
    })())
  }

  const results = await Promise.all(tasks)
  return results.flat()
}
