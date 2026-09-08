'use client'

// P&I Cases — Protection & Indemnity matters, which run for months or years and are
// tracked by who attended, for how long, and what happened.
//
// This route used to be the admin dashboard. It is no longer a landing page at all:
// admins now open on /admin/jobs (lib/auth/roleHome), and the two alert panels that
// used to sit here moved to the pages where their work actually is — reports due to
// Jobs, inventory alerts to Inventory.
//
// A case IS a job (migration 204), so there is no case detail page: opening one goes
// to the ordinary job page, where JobOpsPanel already provides the per-surveyor
// attendance logs with date, hours, location and notes. Adding a second detail
// surface would duplicate the thing that already works.

import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { Scale, Plus, Receipt } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatDate, withVesselPrefix } from '@/lib/utils'
import { qtyWithUnit } from '@/lib/jobs/labourUnit'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/toast'
import BillCaseModal from '@/components/job/BillCaseModal'
import {
  listCases, createCase, caseDaysOpen,
  CASE_STATUS, CASE_STATUS_ORDER, type CaseRow, type CaseStatus,
} from '@/lib/jobs/cases'

type Filter = CaseStatus | 'all'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'open',      label: 'Open' },
  { key: 'on_hold',   label: 'On hold' },
  { key: 'concluded', label: 'Concluded' },
  { key: 'all',       label: 'All' },
]

export default function PandICasesPage() {
  const [cases, setCases] = useState<CaseRow[] | null>(null)
  const [filter, setFilter] = useState<Filter>('open')
  const [newOpen, setNewOpen] = useState(false)
  const [billing, setBilling] = useState<CaseRow | null>(null)

  const load = useCallback(async () => {
    setCases(await listCases())
  }, [])

  useEffect(() => { load() }, [load])

  const visible = useMemo(
    () => (cases ?? []).filter(c => filter === 'all' || c.case_status === filter),
    [cases, filter],
  )

  const counts = useMemo(() => {
    const m = new Map<Filter, number>([['all', cases?.length ?? 0]])
    for (const s of CASE_STATUS_ORDER) m.set(s, (cases ?? []).filter(c => c.case_status === s).length)
    return m
  }, [cases])

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-rise">
      <PageHeader
        icon={Scale}
        title="P&I Cases"
        subtitle="Long-running matters, tracked by attendance"
        actions={
          <button type="button" onClick={() => setNewOpen(true)} className="btn-primary text-sm">
            <Plus className="h-4 w-4" />New Case
          </button>
        }
      />

      {cases === null ? (
        <div className="card p-6 space-y-3">
          {[0, 1, 2].map(i => <div key={i} className="skeleton h-12 w-full rounded-lg" />)}
        </div>
      ) : cases.length === 0 ? (
        // No cases have ever been opened. Say exactly that — not "nothing here".
        <EmptyState
          icon={Scale}
          title="No cases yet"
          description="A P&I case is a job that runs for months or years. Open one and every attendance, with its hours and notes, is recorded against it."
          action={
            <button type="button" onClick={() => setNewOpen(true)} className="btn-primary text-sm">
              <Plus className="h-4 w-4" />New Case
            </button>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={`text-sm px-3 py-1 rounded-full border transition-colors ${
                  filter === f.key
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {f.label}
                <span className="ml-1.5 tnum opacity-70">{counts.get(f.key) ?? 0}</span>
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <EmptyState icon={Scale} title={`No ${FILTERS.find(f => f.key === filter)?.label.toLowerCase()} cases`} />
          ) : (
            <div className="card divide-y divide-gray-100">
              {visible.map(c => <CaseRowItem key={c.id} c={c} onBill={() => setBilling(c)} />)}
            </div>
          )}
        </>
      )}

      <NewCaseModal open={newOpen} onClose={() => setNewOpen(false)} onCreated={load} />
      <BillCaseModal
        open={billing !== null}
        row={billing}
        onClose={() => setBilling(null)}
        onBilled={load}
      />
    </div>
  )
}

function CaseRowItem({ c, onBill }: { c: CaseRow; onBill: () => void }) {
  const meta = CASE_STATUS[c.case_status]
  const days = caseDaysOpen(c)

  return (
    // A div, not a Link: the Bill button must not be nested inside an anchor. The
    // link covers the identity of the case; the button is its own control.
    <div className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors">
      {/* The CASE page, not the job page: a case's fees, currencies and billing
          position have nowhere to live on the ordinary job page, and opening a case at
          /admin/jobs/{id} also lit up Jobs in the sidebar instead of P&I Cases. */}
      <Link href={`/admin/cases/${c.id}`} className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">
          {c.vessel_name ? withVesselPrefix(c.vessel_name, c.vessel_type as any) : c.title || 'Untitled case'}
        </p>
        <p className="text-xs text-gray-500 mt-0.5 truncate">
          {[
            c.client_name ?? 'No client',
            c.surveyor_names.length ? c.surveyor_names.join(', ') : 'No surveyor',
          ].join(' · ')}
        </p>
      </Link>

      {/* Outstanding is the number that decides whether to bill, so it leads.
          Billed-to-date sits under it as context. */}
      <div className="hidden sm:block text-right flex-shrink-0 w-28">
        <p className="text-xs text-gray-500">Outstanding</p>
        <p className="text-sm font-medium text-gray-900 tnum">
          {c.outstanding_hours > 0 ? qtyWithUnit(c.outstanding_hours, c.labour_unit) : '—'}
        </p>
        {c.billed_hours > 0 && (
          <p className="text-xs text-gray-400 tnum">{qtyWithUnit(c.billed_hours, c.labour_unit)} billed</p>
        )}
      </div>

      <div className="hidden lg:block text-right flex-shrink-0 w-28">
        <p className="text-xs text-gray-500">Last attended</p>
        <p className="text-sm text-gray-900 tnum">{c.last_attendance ? formatDate(c.last_attendance) : '—'}</p>
      </div>

      <div className="flex items-center gap-3 flex-shrink-0">
        {c.outstanding_hours > 0 && (
          <button
            type="button"
            onClick={onBill}
            className="btn-secondary text-xs"
            title="Close off billing up to a date you choose. The case stays open."
          >
            <Receipt className="h-4 w-4" /><span className="hidden sm:inline">Bill</span>
          </button>
        )}
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${meta.pill}`}>{meta.label}</span>
        <span className="hidden md:inline text-xs text-gray-400 tnum w-20 text-right">
          {days === null ? '—' : `${days} day${days === 1 ? '' : 's'}`}
        </span>
      </div>
    </div>
  )
}

function NewCaseModal({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [title, setTitle] = useState('')
  const [clientId, setClientId] = useState('')
  const [vessel, setVessel] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    createClient().from('clients').select('id, name').eq('is_active', true).order('name')
      .then(({ data }) => setClients((data ?? []) as any[]))
  }, [open])

  async function save() {
    if (!title.trim()) { toast.error('Give the case a name'); return }
    setSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); toast.error('Your session has expired — sign in again'); return }

    const { error } = await createCase({
      title: title.trim(),
      clientId: clientId || null,
      vesselName: vessel.trim() || null,
      actorId: user.id,
      surveyorIds: [],
      notes: notes.trim() || null,
    })
    setSaving(false)
    if (error) { toast.error(error); return }

    toast.success('Case opened')
    setTitle(''); setClientId(''); setVessel(''); setNotes('')
    onCreated()
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New case"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button type="button" onClick={save} disabled={saving} className="btn-primary text-sm">
            {saving ? 'Opening…' : 'Open case'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label-base" htmlFor="case-title">Case name</label>
          <input
            id="case-title" className="input-base" value={title} autoFocus
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. MV Chaconia — cargo damage claim"
          />
        </div>
        <div>
          <label className="label-base" htmlFor="case-client">Client</label>
          <select id="case-client" className="input-base" value={clientId} onChange={e => setClientId(e.target.value)}>
            <option value="">No client</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label-base" htmlFor="case-vessel">Vessel</label>
          <input
            id="case-vessel" className="input-base" value={vessel}
            onChange={e => setVessel(e.target.value)} placeholder="Optional"
          />
        </div>
        <div>
          <label className="label-base" htmlFor="case-notes">Notes</label>
          <textarea
            id="case-notes" className="input-base" rows={3} value={notes}
            onChange={e => setNotes(e.target.value)} placeholder="Optional"
          />
        </div>
        {/* Surveyors are added on the case itself, where their hours are logged —
            the same panel every other job uses. */}
        <p className="text-xs text-gray-500">
          Surveyors and their attendances are added on the case once it&rsquo;s open.
        </p>
      </div>
    </Modal>
  )
}
