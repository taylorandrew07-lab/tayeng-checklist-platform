// Cross-entity quick search for the top bar. RLS scopes every query, so a
// surveyor only matches their own jobs; clients/invoices are admin/office only.
// Each category is capped — this is a "jump to it" search, not a report.

import { createClient } from '@/lib/supabase/client'
import { titleCaseVesselName, withVesselPrefix } from '@/lib/utils'

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
  // Vessel names are stored BARE, so searching "M.T. Lila" would ilike against
  // "Lila Montreal" and find nothing. Strip a leading prefix off the term before
  // matching; the ORIGINAL term still drives the non-vessel columns below.
  const bare = titleCaseVesselName(safe)
  const like = `%${safe}%`
  const vesselLike = bare && bare.toLowerCase() !== safe.toLowerCase() ? `%${bare}%` : like
  const jobBase = role === 'surveyor' ? '/surveyor/jobs' : role === 'office' ? '/office/jobs' : '/admin/jobs'
  const adminish = role === 'admin' || role === 'office'

  const tasks: Promise<SearchHit[]>[] = []

  // Jobs — report #, vessel, title, surveyor name.
  tasks.push((async () => {
    const { data } = await supabase.from('jobs')
      .select('id, report_number, vessel_name, vessel_type, title, client:clients(name)')
      .or(`report_number.ilike.${like},vessel_name.ilike.${vesselLike},title.ilike.${like},surveyor_name.ilike.${like}`)
      .order('created_at', { ascending: false })
      .limit(6)
    return ((data ?? []) as any[]).map(j => ({
      kind: 'job' as const,
      id: j.id,
      title: j.report_number
        ? `${j.report_number} · ${j.vessel_name ? withVesselPrefix(j.vessel_name, j.vessel_type) : j.title}`
        : (j.vessel_name ? withVesselPrefix(j.vessel_name, j.vessel_type) : j.title),
      subtitle: [j.client?.name, j.title].filter(Boolean).join(' — ') || undefined,
      href: `${jobBase}/${j.id}`,
    }))
  })())

  if (adminish) {
    // Clients — by name.
    tasks.push((async () => {
      // Name only — contact info is private (client_billing, admin/office-gated).
      const { data } = await supabase.from('clients').select('id, name').ilike('name', like).order('name').limit(5)
      return ((data ?? []) as any[]).map(c => ({
        kind: 'client' as const, id: c.id, title: c.name,
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
