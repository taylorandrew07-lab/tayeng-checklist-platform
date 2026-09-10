'use client'

// P&I Cases — the list.
//
// This route used to be the admin dashboard and then, briefly, a case that was really a
// job. It is neither now: a case has its own tables (migration 212) and no relationship
// to the job pipeline at all. Admins land on /admin/jobs; this is its own section,
// reached from the sidebar.
//
// The route stays /admin because the sidebar's saved order (ui_prefs.nav_order) is keyed
// by href — repointing it would silently drop P&I Cases to the bottom of the menu for
// anyone who has reordered theirs.

import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { Scale, Plus, Loader2 } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/toast'
import { formatDate } from '@/lib/utils'
import { todayKey } from '@/lib/cargo/voyageDate'
import {
  listCases, createCase, listAttendances, listCharges,
  CASE_STATUS, CASE_STATUS_ORDER, CASE_TYPE_SUGGESTIONS,
  type CaseRow, type CaseStatus,
} from '@/lib/cases/api'
import { claimPosition } from '@/lib/cases/claim'
import { formatMinutes } from '@/lib/cases/minutes'

type Filter = CaseStatus | 'all'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'on_hold', label: 'On hold' },
  { key: 'concluded', label: 'Concluded' },
  { key: 'all', label: 'All' },
]

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Per-case totals, loaded after the list paints. Kept separate so the page shows the
 *  cases immediately rather than waiting on every case's attendances and charges. */
type Totals = { minutes: number; outstanding: { currency: string; total: number }[] }

export default function PandICasesPage() {
  const [cases, setCases] = useState<CaseRow[] | null>(null)
  const [totals, setTotals] = useState<Record<string, Totals>>({})
  const [filter, setFilter] = useState<Filter>('open')
  const [newOpen, setNewOpen] = useState(false)

  const load = useCallback(async () => {
    const rows = await listCases()
    setCases(rows)
    const acc: Record<string, Totals> = {}
    await Promise.all(rows.map(async r => {
      const [a, c] = await Promise.all([listAttendances(r.id), listCharges(r.id)])
      const p = claimPosition(a, c, null)
      acc[r.id] = {
        minutes: p.totalMinutes,
        outstanding: p.groups.map(g => ({ currency: g.currency, total: g.total })),
      }
    }))
    setTotals(acc)
  }, [])

  useEffect(() => { load() }, [load])

  const visible = useMemo(
    () => (cases ?? []).filter(c => filter === 'all' || c.status === filter),
    [cases, filter],
  )
  const counts = useMemo(() => {
    const m = new Map<Filter, number>([['all', cases?.length ?? 0]])
    for (const s of CASE_STATUS_ORDER) m.set(s, (cases ?? []).filter(c => c.status === s).length)
    return m
  }, [cases])

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-rise">
      <PageHeader
        icon={Scale}
        title="P&I Cases"
        subtitle="Attendances, costs and what is still to be claimed"
        actions={
          <button type="button" onClick={() => setNewOpen(true)} className="btn-primary text-sm">
            <Plus className="h-4 w-4" />New case
          </button>
        }
      />

      {cases === null ? (
        <div className="card p-6 space-y-3">
          {[0, 1, 2].map(i => <div key={i} className="skeleton h-12 w-full rounded-lg" />)}
        </div>
      ) : cases.length === 0 ? (
        <EmptyState
          icon={Scale}
          title="No cases yet"
          description="A case records who attended, for how long and at what rate — our people and any contractor — plus fees and costs, and what has already been claimed."
          action={
            <button type="button" onClick={() => setNewOpen(true)} className="btn-primary text-sm">
              <Plus className="h-4 w-4" />New case
            </button>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}
                className={`text-sm px-3 py-1 rounded-full border transition-colors ${
                  filter === f.key
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
                {f.label}<span className="ml-1.5 tnum opacity-70">{counts.get(f.key) ?? 0}</span>
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <EmptyState icon={Scale} title={`No ${FILTERS.find(f => f.key === filter)?.label.toLowerCase()} cases`} />
          ) : (
            <div className="card divide-y divide-gray-100">
              {visible.map(c => {
                const t = totals[c.id]
                const meta = CASE_STATUS[c.status]
                return (
                  <Link key={c.id} href={`/admin/cases/${c.id}`}
                    className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {c.title}
                        {c.case_type && <span className="ml-2 text-xs text-gray-400">{c.case_type}</span>}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">
                        {[c.our_vessel, c.other_party ? `v. ${c.other_party}` : null, c.principal, c.case_ref]
                          .filter(Boolean).join(' · ') || 'No details yet'}
                      </p>
                    </div>

                    <div className="hidden sm:block text-right flex-shrink-0 w-32">
                      <p className="text-xs text-gray-500">Outstanding</p>
                      {!t ? <p className="text-sm text-gray-300">—</p>
                        : t.outstanding.length === 0 ? <p className="text-sm text-gray-400">—</p>
                        : t.outstanding.map(o => (
                            <p key={o.currency} className="text-sm font-medium text-gray-900 tnum">
                              {money(o.total)} {o.currency}
                            </p>
                          ))}
                    </div>

                    <div className="hidden lg:block text-right flex-shrink-0 w-24">
                      <p className="text-xs text-gray-500">Time</p>
                      <p className="text-sm text-gray-900 tnum">{t ? formatMinutes(t.minutes) : '—'}</p>
                    </div>

                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${meta.pill}`}>{meta.label}</span>
                      <span className="hidden md:inline text-xs text-gray-400 tnum w-20 text-right">
                        {formatDate(c.opened_on)}
                      </span>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </>
      )}

      <NewCaseModal open={newOpen} onClose={() => setNewOpen(false)} onCreated={load} />
    </div>
  )
}

function NewCaseModal({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void
}) {
  const [f, setF] = useState({
    title: '', case_type: '', our_vessel: '', other_party: '',
    case_ref: '', principal: '', opened_on: todayKey(), notes: '',
  })
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!f.title.trim()) { toast.error('Give the case a title'); return }
    setBusy(true)
    const res = await createCase({ ...f, title: f.title } as any)
    setBusy(false)
    if (res.error) { toast.error(res.error); return }
    toast.success('Case opened')
    setF({ title: '', case_type: '', our_vessel: '', other_party: '', case_ref: '', principal: '', opened_on: todayKey(), notes: '' })
    onCreated(); onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="New case" size="lg"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button type="button" onClick={save} disabled={busy} className="btn-primary text-sm">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Open case
          </button>
        </>
      }>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="label-base" htmlFor="n-title">Title</label>
            <input id="n-title" className="input-base" value={f.title} autoFocus
              placeholder="What you call this matter"
              onChange={e => setF(p => ({ ...p, title: e.target.value }))} />
          </div>
          <div className="w-44">
            <label className="label-base" htmlFor="n-type">Type</label>
            <input id="n-type" className="input-base" list="new-case-types" value={f.case_type}
              placeholder="Collision, medical…"
              onChange={e => setF(p => ({ ...p, case_type: e.target.value }))} />
            <datalist id="new-case-types">
              {CASE_TYPE_SUGGESTIONS.map(t => <option key={t} value={t} />)}
            </datalist>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[160px]">
            <label className="label-base" htmlFor="n-vessel">Our vessel</label>
            <input id="n-vessel" className="input-base" value={f.our_vessel}
              onChange={e => setF(p => ({ ...p, our_vessel: e.target.value }))} />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="label-base" htmlFor="n-other">Other party</label>
            <input id="n-other" className="input-base" value={f.other_party}
              placeholder="Opposing vessel, or the person"
              onChange={e => setF(p => ({ ...p, other_party: e.target.value }))} />
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[160px]">
            <label className="label-base" htmlFor="n-principal">Principal</label>
            <input id="n-principal" className="input-base" value={f.principal} placeholder="Club or owner"
              onChange={e => setF(p => ({ ...p, principal: e.target.value }))} />
          </div>
          <div className="w-44">
            <label className="label-base" htmlFor="n-ref">Reference</label>
            <input id="n-ref" className="input-base" value={f.case_ref} placeholder="Their claim number"
              onChange={e => setF(p => ({ ...p, case_ref: e.target.value }))} />
          </div>
          <div className="w-40">
            <label className="label-base" htmlFor="n-on">Opened</label>
            <input id="n-on" type="date" className="input-base" value={f.opened_on}
              onChange={e => setF(p => ({ ...p, opened_on: e.target.value }))} />
          </div>
        </div>
        <div>
          <label className="label-base" htmlFor="n-notes">Notes</label>
          <textarea id="n-notes" className="input-base" rows={2} value={f.notes}
            onChange={e => setF(p => ({ ...p, notes: e.target.value }))} />
        </div>
      </div>
    </Modal>
  )
}
