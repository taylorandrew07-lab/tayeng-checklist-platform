'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Loader2, Building2, Pencil, Mail, Phone, MapPin, Briefcase, FolderOpen, AlertTriangle, Lock,
} from 'lucide-react'
import { getClientDetail, type ClientDetail } from '@/lib/jobs/client-detail'
import { listBankAccounts } from '@/lib/jobs/invoicing'
import { money } from '@/lib/jobs/tracker'
import { WorkflowPill } from '@/components/job/StatusPill'
import { formatDate } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/components/ui/toast'
import ColorSwatchPicker from '@/components/ui/ColorSwatchPicker'

const LOGO_BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/client-logos`
const logoUrl = (path?: string | null) => (path ? `${LOGO_BASE}/${path}` : null)

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [data, setData] = useState<ClientDetail | null>(null)
  const [loading, setLoading] = useState(true)
  // undefined = "use the loaded client.color"; a value = a just-picked override.
  const [colorOverride, setColorOverride] = useState<string | null | undefined>(undefined)
  // Label of the bank account this client pays into (client_billing link, mig 121).
  const [payToLabel, setPayToLabel] = useState<string | null>(null)

  async function saveColor(key: string | null) {
    if (!data) return
    const prev = colorOverride
    setColorOverride(key) // optimistic
    const { error } = await createClient().from('clients').update({ color: key }).eq('id', data.client.id)
    if (error) { setColorOverride(prev); toast.error('Could not save the colour: ' + error.message) }
  }

  useEffect(() => {
    let active = true
    getClientDetail(params.id).then(d => { if (active) { setData(d); setLoading(false) } }).catch(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [params.id])

  const payToId = data?.clientBilling?.pay_to_bank_account_id ?? null
  useEffect(() => {
    if (!payToId) { setPayToLabel(null); return }
    let active = true
    listBankAccounts().then(accts => {
      if (!active) return
      const a = accts.find(x => x.id === payToId)
      setPayToLabel(a ? `${a.label}${a.currency ? ` (${a.currency})` : ''}` : null)
    })
    return () => { active = false }
  }, [payToId])

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>

  if (!data) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <h1 className="page-title mb-2">Client not found</h1>
        <Link href="/admin/clients" className="btn-secondary">Back to clients</Link>
      </div>
    )
  }

  const { client, clientBilling, jobCount, openJobs, billing, jobs, invoices } = data
  const logo = logoUrl(client.logo_path)
  const cb = clientBilling
  const hasPayment = !!(cb && (cb.payment_terms || cb.ap_email || cb.ap_contact || cb.ap_phone || cb.pay_to_bank_account_id))

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button onClick={() => router.push('/admin/clients')} className="btn-ghost py-2 px-3 mt-1" aria-label="Back to clients">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="h-16 w-16 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0">
          {logo ? <img src={logo} alt={`${client.name} logo`} className="h-full w-full object-contain p-1.5" /> : <Building2 className="h-8 w-8 text-gray-300" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="page-title truncate">{client.name}</h1>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${client.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {client.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-500">
            {cb?.contact_name && <span className="text-gray-700">{cb.contact_name}</span>}
            {cb?.contact_email && <a href={`mailto:${cb.contact_email}`} className="inline-flex items-center gap-1 hover:text-brand-700"><Mail className="h-3.5 w-3.5" />{cb.contact_email}</a>}
            {cb?.contact_phone && <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{cb.contact_phone}</span>}
            {cb?.address && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{cb.address}</span>}
          </div>
          <div className="mt-2.5 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400">Colour <span className="hidden sm:inline">(used when colouring jobs by client)</span></span>
            <ColorSwatchPicker value={colorOverride !== undefined ? colorOverride : client.color} onChange={saveColor} />
          </div>
        </div>
        <Link href={`/admin/clients?focus=${client.id}`} className="btn-secondary flex-shrink-0"><Pencil className="h-4 w-4" /><span className="hidden sm:inline">Edit</span></Link>
      </div>

      {cb?.notes && <div className="card p-4 text-sm text-gray-600"><span className="text-xs font-medium text-gray-400 block mb-1">Notes</span>{cb.notes}</div>}

      {hasPayment && (
        <div className="card p-4">
          <p className="text-xs font-medium text-gray-400 mb-2 flex items-center gap-1.5"><Lock className="h-3 w-3" /> Payment &amp; billing <span className="font-normal">— admin/office only</span></p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {cb?.payment_terms && <div><span className="text-gray-400">Terms: </span><span className="text-gray-700">{cb.payment_terms}</span></div>}
            {cb?.ap_email && <div><span className="text-gray-400">AP email: </span><a href={`mailto:${cb.ap_email}`} className="text-brand-700 hover:underline">{cb.ap_email}</a></div>}
            {(cb?.ap_contact || cb?.ap_phone) && <div><span className="text-gray-400">AP contact: </span><span className="text-gray-700">{[cb?.ap_contact, cb?.ap_phone].filter(Boolean).join(' · ')}</span></div>}
            {payToLabel && <div><span className="text-gray-400">Pays into: </span><span className="text-gray-700">{payToLabel}</span></div>}
          </div>
        </div>
      )}

      {/* Summary tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Total jobs" value={String(jobCount)} icon={<Briefcase className="h-4 w-4" />} />
        <Stat label="Open jobs" value={String(openJobs)} icon={<FolderOpen className="h-4 w-4" />} />
        <div className="card p-4 col-span-2">
          <p className="text-xs font-medium text-gray-400 mb-2">Billing</p>
          {billing.length === 0 ? (
            <p className="text-sm text-gray-400">No invoices yet</p>
          ) : (
            <div className="space-y-1.5">
              {billing.map(b => (
                <div key={b.currency} className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">{b.currency}</span>
                  <span className="flex items-center gap-3">
                    {b.outstanding > 0 && <span className="text-amber-700">{money(b.outstanding, b.currency)} due{b.overdue > 0 ? ` · ${money(b.overdue, b.currency)} overdue` : ''}</span>}
                    <span className="text-gray-400 tnum">{money(b.paid, b.currency)} paid</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Jobs + Invoices sit side by side on wide screens to use desktop width;
          they stack on smaller screens. */}
      <div className="grid xl:grid-cols-2 gap-6 items-start">
      {/* Jobs */}
      <div className="card p-0 overflow-hidden">
        <h2 className="section-title px-4 pt-4 pb-3">Jobs ({jobCount})</h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-gray-400 px-4 pb-4">No jobs for this client yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-y border-gray-100 bg-gray-50/50">
                  <th className="px-4 py-2 font-medium">Report</th>
                  <th className="px-4 py-2 font-medium">Vessel</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Invoice</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(j => (
                  <tr key={j.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/jobs/${j.id}`} className="text-brand-700 hover:underline font-medium tnum">{j.report_number || '—'}</Link>
                      <span className="block text-xs text-gray-400 truncate max-w-[14rem]">{j.title}</span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-700">{j.vessel_name ? `M.V. ${j.vessel_name}` : '—'}</td>
                    <td className="px-4 py-2.5"><WorkflowPill status={j.workflow_status} /></td>
                    <td className="px-4 py-2.5 text-gray-500 tnum">{formatDate(j.scheduled_date ?? j.created_at)}</td>
                    <td className="px-4 py-2.5 text-gray-600 tnum">
                      {j.invoice_number ? `${j.invoice_currency ?? ''} ${j.invoice_total?.toLocaleString(undefined, { minimumFractionDigits: 2 }) ?? ''}` : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Invoices */}
      <div className="card p-0 overflow-hidden">
        <h2 className="section-title px-4 pt-4 pb-3">Invoices ({invoices.length})</h2>
        {invoices.length === 0 ? (
          <p className="text-sm text-gray-400 px-4 pb-4">No invoices yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-y border-gray-100 bg-gray-50/50">
                  <th className="px-4 py-2 font-medium">Invoice</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Total</th>
                  <th className="px-4 py-2 font-medium">Due</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      {inv.job_id
                        ? <Link href={`/admin/jobs/${inv.job_id}`} className="text-brand-700 hover:underline font-medium tnum">{inv.invoice_number || '—'}</Link>
                        : <span className="font-medium tnum">{inv.invoice_number || '—'}</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium capitalize ${invStatusClass(inv.status, inv.overdue)}`}>
                        {inv.overdue && <AlertTriangle className="h-3 w-3" />}{inv.overdue ? 'overdue' : inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 tnum text-gray-700">{money(inv.total, inv.currency)}</td>
                    <td className="px-4 py-2.5 text-gray-500 tnum">{inv.due_date ? formatDate(inv.due_date) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </div>
    </div>
  )
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-400 mb-1">{icon}{label}</div>
      <p className="text-2xl font-semibold text-gray-900 tnum">{value}</p>
    </div>
  )
}

function invStatusClass(status: string, overdue: boolean): string {
  if (overdue) return 'bg-red-100 text-red-700'
  switch (status) {
    case 'paid': return 'bg-green-100 text-green-700'
    case 'sent': return 'bg-teal-100 text-teal-700'
    case 'draft': return 'bg-gray-100 text-gray-500'
    case 'void': return 'bg-gray-100 text-gray-400 line-through'
    default: return 'bg-gray-100 text-gray-600'
  }
}
