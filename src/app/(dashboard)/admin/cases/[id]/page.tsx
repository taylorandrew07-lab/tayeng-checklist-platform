'use client'

// One P&I case.
//
// A case is not a job and this page shares nothing with the job pages: no workflow bar,
// no report number, no checklist, no link into /admin/jobs. We act as correspondent, and
// what matters here is who attended, what it cost, what is outstanding, and what has
// already been claimed.
//
// Five cards, in the order you work them: what the case IS · the money position ·
// attendances · fees and costs · documents · past claims.

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Scale, Receipt, Trash2, Loader2, CheckCircle2 } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/components/ui/confirm'
import { formatDate } from '@/lib/utils'
import {
  getCase, updateCase, setCaseStatus, listAttendances, listCharges, listDocuments,
  listClaims, deleteClaim,
  CASE_STATUS, CASE_STATUS_ORDER, CASE_TYPE_SUGGESTIONS,
  type CaseRow, type CaseStatus, type CaseAttendance, type CaseCharge, type CaseDocument, type CaseClaim,
} from '@/lib/cases/api'
import { claimPosition } from '@/lib/cases/claim'
import { formatMinutes } from '@/lib/cases/minutes'
import CaseAttendances from '@/components/cases/CaseAttendances'
import CaseCharges from '@/components/cases/CaseCharges'
import CaseDocuments from '@/components/cases/CaseDocuments'
import ClaimCaseModal from '@/components/cases/ClaimCaseModal'

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function CasePage() {
  const params = useParams()
  const caseId = String(params?.id ?? '')

  const [row, setRow] = useState<CaseRow | null | undefined>(undefined)
  const [attendances, setAttendances] = useState<CaseAttendance[]>([])
  const [charges, setCharges] = useState<CaseCharge[]>([])
  const [docs, setDocs] = useState<CaseDocument[]>([])
  const [claims, setClaims] = useState<CaseClaim[]>([])
  const [claiming, setClaiming] = useState(false)

  const load = useCallback(async () => {
    if (!caseId) return
    const [c, a, ch, d, cl] = await Promise.all([
      getCase(caseId), listAttendances(caseId), listCharges(caseId),
      listDocuments(caseId), listClaims(caseId),
    ])
    setRow(c); setAttendances(a); setCharges(ch); setDocs(d); setClaims(cl)
  }, [caseId])

  useEffect(() => { load() }, [load])

  // No cutoff — this is the case's whole position, not a claim about to happen.
  const position = useMemo(() => claimPosition(attendances, charges, null), [attendances, charges])

  if (row === undefined) {
    return (
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="skeleton h-24 w-full rounded-xl" />
        <div className="skeleton h-64 w-full rounded-xl" />
      </div>
    )
  }
  if (row === null) {
    return (
      <div className="max-w-7xl mx-auto">
        <EmptyState icon={Scale} title="Case not found"
          description="It may have been deleted."
          action={<Link href="/admin" className="btn-primary text-sm">Back to cases</Link>} />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-rise">
      <PageHeader
        icon={Scale}
        title={row.title}
        subtitle={[row.case_type, row.our_vessel, row.other_party ? `v. ${row.other_party}` : null]
          .filter(Boolean).join(' · ') || 'P&I case'}
        back={{ href: '/admin', label: 'P&I Cases' }}
        actions={
          <button type="button" onClick={() => setClaiming(true)} className="btn-primary text-sm">
            <Receipt className="h-4 w-4" />Claim
          </button>
        }
      />

      <IdentityCard row={row} onSaved={load} />

      {/* Split by currency, because one claim carries one and nothing is ever converted. */}
      <div className="card">
        <div className="px-6 py-4 border-b border-gray-200"><h2 className="section-title">Position</h2></div>
        <div className="px-6 py-4 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-gray-500">Outstanding</p>
            {position.groups.length === 0
              ? <p className="text-sm text-gray-400">Nothing outstanding</p>
              : position.groups.map(g => (
                  <p key={g.currency} className="text-sm text-gray-900 tnum">{money(g.total)} {g.currency}</p>
                ))}
            {position.unpriced.length > 0 && (
              <p className="text-xs text-amber-700 mt-1">
                {position.unpriced.length} attendance{position.unpriced.length === 1 ? '' : 's'} with no rate
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-gray-500">Claimed to date</p>
            {Object.keys(position.claimed).length === 0
              ? <p className="text-sm text-gray-400">Nothing claimed yet</p>
              : Object.entries(position.claimed).map(([ccy, amt]) => (
                  <p key={ccy} className="text-sm text-gray-900 tnum">{money(amt)} {ccy}</p>
                ))}
          </div>
          <div>
            <p className="text-xs text-gray-500">Time recorded</p>
            <p className="text-sm text-gray-900 tnum">{formatMinutes(position.totalMinutes)}</p>
          </div>
        </div>
      </div>

      <CaseAttendances caseId={row.id} onChanged={load} />
      <CaseCharges caseId={row.id} charges={charges} onChanged={load} />
      <CaseDocuments caseId={row.id} docs={docs} onChanged={load} />
      <ClaimsCard claims={claims} onChanged={load} />

      <ClaimCaseModal
        open={claiming} onClose={() => setClaiming(false)}
        kase={row} attendances={attendances} charges={charges}
        onClaimed={load}
      />
    </div>
  )
}

/** What the case IS. Deliberately few fields, all free text: the matters vary too much
 *  to enumerate, and a closed list would be wrong the first time something new came in.
 *  "Other party" holds an opposing vessel OR an injured person, which is why it is not
 *  called "opposing vessel". */
function IdentityCard({ row, onSaved }: { row: CaseRow; onSaved: () => void }) {
  const [f, setF] = useState({
    title: row.title, case_type: row.case_type ?? '', our_vessel: row.our_vessel ?? '',
    other_party: row.other_party ?? '', case_ref: row.case_ref ?? '',
    principal: row.principal ?? '', notes: row.notes ?? '',
  })
  const [busy, setBusy] = useState(false)
  const dirty = f.title !== row.title || f.case_type !== (row.case_type ?? '')
    || f.our_vessel !== (row.our_vessel ?? '') || f.other_party !== (row.other_party ?? '')
    || f.case_ref !== (row.case_ref ?? '') || f.principal !== (row.principal ?? '')
    || f.notes !== (row.notes ?? '')

  async function save() {
    if (!f.title.trim()) { toast.error('A case needs a title'); return }
    setBusy(true)
    const res = await updateCase(row.id, {
      title: f.title.trim(),
      case_type: f.case_type.trim() || null, our_vessel: f.our_vessel.trim() || null,
      other_party: f.other_party.trim() || null, case_ref: f.case_ref.trim() || null,
      principal: f.principal.trim() || null, notes: f.notes.trim() || null,
    } as Partial<CaseRow>)
    setBusy(false)
    if (res.error) { toast.error(res.error); return }
    toast.success('Case updated'); onSaved()
  }

  async function changeStatus(next: CaseStatus) {
    const res = await setCaseStatus(row.id, next)
    if (res.error) { toast.error(res.error); return }
    toast.success(`Marked ${CASE_STATUS[next].label.toLowerCase()}`); onSaved()
  }

  const meta = CASE_STATUS[row.status]

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-gray-200">
        <h2 className="section-title">The case</h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${meta.pill}`}>{meta.label}</span>
          {CASE_STATUS_ORDER.filter(s => s !== row.status).map(s => (
            <button key={s} type="button" onClick={() => changeStatus(s)} className="btn-ghost text-xs">
              Mark {CASE_STATUS[s].label.toLowerCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="px-6 py-4 space-y-3">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="label-base" htmlFor="c-title">Title</label>
            <input id="c-title" className="input-base" value={f.title}
              onChange={e => setF(p => ({ ...p, title: e.target.value }))} />
          </div>
          <div className="w-44">
            <label className="label-base" htmlFor="c-type">Type</label>
            <input id="c-type" className="input-base" list="case-types" value={f.case_type}
              placeholder="Collision, medical…"
              onChange={e => setF(p => ({ ...p, case_type: e.target.value }))} />
            <datalist id="case-types">
              {CASE_TYPE_SUGGESTIONS.map(t => <option key={t} value={t} />)}
            </datalist>
          </div>
          <div className="w-44">
            <label className="label-base" htmlFor="c-ref">Reference</label>
            <input id="c-ref" className="input-base" value={f.case_ref} placeholder="Their claim number"
              onChange={e => setF(p => ({ ...p, case_ref: e.target.value }))} />
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[160px]">
            <label className="label-base" htmlFor="c-vessel">Our vessel</label>
            <input id="c-vessel" className="input-base" value={f.our_vessel}
              onChange={e => setF(p => ({ ...p, our_vessel: e.target.value }))} />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="label-base" htmlFor="c-other">Other party</label>
            <input id="c-other" className="input-base" value={f.other_party}
              placeholder="Opposing vessel, or the person"
              onChange={e => setF(p => ({ ...p, other_party: e.target.value }))} />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="label-base" htmlFor="c-principal">Principal</label>
            <input id="c-principal" className="input-base" value={f.principal} placeholder="Club or owner"
              onChange={e => setF(p => ({ ...p, principal: e.target.value }))} />
          </div>
        </div>
        <div>
          <label className="label-base" htmlFor="c-notes">Notes</label>
          <textarea id="c-notes" className="input-base" rows={2} value={f.notes}
            onChange={e => setF(p => ({ ...p, notes: e.target.value }))} />
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={!dirty || busy} className="btn-primary text-sm">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Save
          </button>
          <span className="text-xs text-gray-500 tnum">
            Opened {formatDate(row.opened_on)}{row.closed_on ? ` · closed ${formatDate(row.closed_on)}` : ''}
          </span>
        </div>
      </div>
    </div>
  )
}

/** Past claims. Undo is a plain delete — every item on it returns to unclaimed by itself,
 *  because the foreign keys are ON DELETE SET NULL. */
function ClaimsCard({ claims, onChanged }: { claims: CaseClaim[]; onChanged: () => void }) {
  async function undo(c: CaseClaim) {
    if (!(await confirmDialog({
      title: `Undo claim ${c.claim_no}?`,
      message: `Its ${c.item_count} item${c.item_count === 1 ? '' : 's'} go back to unclaimed and will appear on the next claim.`,
      confirmLabel: 'Undo claim', danger: true,
    }))) return
    const res = await deleteClaim(c.id)
    if (res.error) { toast.error(res.error); return }
    onChanged()
  }

  return (
    <div className="card">
      <div className="px-6 py-4 border-b border-gray-200"><h2 className="section-title">Claims</h2></div>
      {claims.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-gray-400">
          Nothing claimed yet. Use Claim to close off a period.
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {claims.map(c => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 px-6 py-3">
              <span className="text-sm font-medium text-gray-900 w-14 tnum">#{c.claim_no}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-900 tnum">{money(c.total)} {c.currency}</p>
                <p className="text-xs text-gray-500 tnum">
                  {c.item_count} item{c.item_count === 1 ? '' : 's'} · up to {formatDate(c.cutoff_on)}
                  {c.reference ? ` · invoice ${c.reference}` : ''}
                  {c.invoiced_on ? ` · ${formatDate(c.invoiced_on)}` : ''}
                </p>
              </div>
              {!c.reference && !c.invoiced_on && (
                <span className="text-xs text-amber-700">no invoice recorded</span>
              )}
              <button type="button" onClick={() => undo(c)} aria-label={`Undo claim ${c.claim_no}`}
                className="btn-ghost p-1 text-gray-400 hover:text-red-600 flex-shrink-0">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
