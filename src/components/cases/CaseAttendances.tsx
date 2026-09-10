'use client'

// Attendances on a P&I case — the card you live in.
//
// Two things it does that the old job-shaped model could not:
//   * WHO can be an app user OR a name typed in. Every contractor on the matter is
//     first-class, not a placeholder profile.
//   * The RATE belongs to the work, per entry: hourly, daily or a flat fee, in its own
//     currency. The same person bills a call-out at one rate and testimony at another.
//
// Time is WHOLE MINUTES. Six taps of a ten-minute button is exactly one hour, not the
// 1.02 that decimal hours would give you.
//
// Editing reuses the ADD form rather than a second inline editor — same inputs, same
// validation — which is the pattern the job time logs use. A CLAIMED row is read-only:
// its claim carries a total that was exported and invoiced outside the app, so changing
// the lines underneath would make the two disagree silently.

import { useState, useEffect, useCallback } from 'react'
import { Phone, Mail, Plus, Pencil, X, Loader2, Paperclip, CheckCircle2 } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/components/ui/confirm'
import { formatDate } from '@/lib/utils'
import { todayKey } from '@/lib/cargo/voyageDate'
import { listSurveyorAccounts, type SurveyorAccount } from '@/lib/jobs/tracker'
import {
  listAttendances, addAttendance, updateAttendance, deleteAttendance, addQuickBlock,
  CURRENCIES, RATE_TYPE,
  type CaseAttendance, type RateType, type AttendanceInput,
} from '@/lib/cases/api'
import { formatMinutes, minutesFromHM, hmFromMinutes, QUICK_BLOCK_MINUTES } from '@/lib/cases/minutes'

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const BLANK = {
  useName: false, profileId: '', name: '',
  on: todayKey(), h: '', m: '',
  description: '', location: '', note: '',
  rateType: 'hourly' as RateType, rate: '', days: '', currency: 'USD',
}

export default function CaseAttendances({ caseId, onChanged }: { caseId: string; onChanged?: () => void }) {
  const [rows, setRows] = useState<CaseAttendance[] | null>(null)
  const [staff, setStaff] = useState<SurveyorAccount[]>([])
  const [open, setOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [f, setF] = useState({ ...BLANK })
  const [busy, setBusy] = useState(false)
  const [quick, setQuick] = useState<'call' | 'email' | null>(null)

  const load = useCallback(async () => {
    setRows(await listAttendances(caseId))
    onChanged?.()
  }, [caseId, onChanged])

  useEffect(() => {
    load()
    listSurveyorAccounts().then(setStaff).catch(() => {})
  }, [load])

  /** Each TAP mints its own key. A retry replays that key and the database returns the
   *  original row instead of logging a second block; a genuine second tap gets a new key
   *  and a second chunk, which is what "click it twice for 20 minutes" means. */
  async function tapQuick(kind: 'call' | 'email') {
    setQuick(kind)
    const res = await addQuickBlock(caseId, kind, crypto.randomUUID())
    setQuick(null)
    if (res.error) { toast.error(res.error); return }
    toast.success(`${kind === 'call' ? 'Phone call' : 'Email'} — ${QUICK_BLOCK_MINUTES} min`)
    load()
  }

  function startEdit(a: CaseAttendance) {
    const { hours, mins } = hmFromMinutes(a.minutes)
    setEditId(a.id)
    setOpen(true)
    setF({
      useName: !a.attendee_profile_id,
      profileId: a.attendee_profile_id ?? '',
      name: a.attendee_name ?? '',
      on: a.attended_on,
      h: hours ? String(hours) : '', m: mins ? String(mins) : '',
      description: a.description ?? '', location: a.location ?? '', note: a.note ?? '',
      rateType: a.rate_type,
      rate: a.rate_amount == null ? '' : String(a.rate_amount),
      days: a.days == null ? '' : String(a.days),
      currency: a.currency,
    })
  }

  function cancel() { setEditId(null); setOpen(false); setF({ ...BLANK }) }

  async function save() {
    const minutes = minutesFromHM(f.h, f.m)
    if (f.rateType !== 'fixed' && minutes === 0 && f.rateType === 'hourly') {
      toast.error('Enter how long it took'); return
    }
    if (!f.useName && !f.profileId) { toast.error('Choose who attended, or type a name'); return }
    if (f.useName && !f.name.trim()) { toast.error('Type the contractor’s name'); return }

    const input: AttendanceInput = {
      attendee_profile_id: f.useName ? null : f.profileId,
      attendee_name: f.useName ? f.name : null,
      attended_on: f.on, minutes,
      description: f.description, location: f.location, note: f.note,
      rate_type: f.rateType,
      rate_amount: f.rate.trim() === '' ? null : Number(f.rate),
      days: f.days.trim() === '' ? null : Number(f.days),
      currency: f.currency,
    }
    setBusy(true)
    const res = editId ? await updateAttendance(editId, input) : await addAttendance(caseId, input)
    setBusy(false)
    if (res.error) { toast.error(res.error); return }
    cancel()
    load()
  }

  async function remove(a: CaseAttendance) {
    if (!(await confirmDialog({
      title: 'Delete this attendance?',
      message: `${a.attendee_label} — ${formatMinutes(a.minutes)} on ${formatDate(a.attended_on)}`,
      confirmLabel: 'Delete', danger: true,
    }))) return
    const res = await deleteAttendance(a.id)
    if (res.error) { toast.error(res.error); return }
    load()
  }

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-gray-200">
        <h2 className="section-title">Attendances</h2>
        <div className="flex items-center gap-2">
          {/* The whole point of these: ten seconds of work should take one tap, not a form. */}
          <button type="button" onClick={() => tapQuick('call')} disabled={quick !== null}
            className="btn-secondary text-xs" title="Adds a 10-minute block, dated today, for you">
            {quick === 'call' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
            Phone call <span className="tnum opacity-70">+10m</span>
          </button>
          <button type="button" onClick={() => tapQuick('email')} disabled={quick !== null}
            className="btn-secondary text-xs" title="Adds a 10-minute block, dated today, for you">
            {quick === 'email' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Email <span className="tnum opacity-70">+10m</span>
          </button>
          {!open && (
            <button type="button" onClick={() => setOpen(true)} className="btn-secondary text-xs">
              <Plus className="h-4 w-4" />Log attendance
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 space-y-3">
          {/* WHO — an app user or a typed name. Radios rather than a magic combo box, so
              it is obvious which of the two you are answering. */}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <span className="label-base">Who attended</span>
              <div className="flex items-center gap-3 h-[38px]">
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="radio" checked={!f.useName} onChange={() => setF(p => ({ ...p, useName: false }))} />
                  Our team
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="radio" checked={f.useName} onChange={() => setF(p => ({ ...p, useName: true }))} />
                  Contractor
                </label>
              </div>
            </div>
            {f.useName ? (
              <div className="flex-1 min-w-[180px]">
                <label className="label-base" htmlFor="ca-name">Name</label>
                <input id="ca-name" className="input-base" value={f.name} placeholder="Who did the work"
                  onChange={e => setF(p => ({ ...p, name: e.target.value }))} />
              </div>
            ) : (
              <div className="flex-1 min-w-[180px]">
                <label className="label-base" htmlFor="ca-who">Person</label>
                <select id="ca-who" className="input-base" value={f.profileId}
                  onChange={e => setF(p => ({ ...p, profileId: e.target.value }))}>
                  <option value="">Choose…</option>
                  {staff.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}{s.display_title ? ` · ${s.display_title}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="label-base" htmlFor="ca-on">Date</label>
              <input id="ca-on" type="date" className="input-base w-40" value={f.on}
                onChange={e => setF(p => ({ ...p, on: e.target.value }))} />
            </div>
          </div>

          {/* HOW LONG — two integer boxes, never a decimal. */}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <span className="label-base">Time spent</span>
              <div className="flex items-center gap-1">
                <input aria-label="Hours" type="number" min="0" inputMode="numeric" placeholder="0"
                  className="input-base w-16 text-right tnum" value={f.h}
                  onChange={e => setF(p => ({ ...p, h: e.target.value }))} />
                <span className="text-sm text-gray-500">h</span>
                <input aria-label="Minutes" type="number" min="0" step="5" inputMode="numeric" placeholder="0"
                  className="input-base w-16 text-right tnum" value={f.m}
                  onChange={e => setF(p => ({ ...p, m: e.target.value }))} />
                <span className="text-sm text-gray-500">m</span>
              </div>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="label-base" htmlFor="ca-desc">What was done</label>
              <input id="ca-desc" className="input-base" value={f.description}
                placeholder="e.g. Attendance on board / Expert witness testimony"
                onChange={e => setF(p => ({ ...p, description: e.target.value }))} />
            </div>
            <div className="w-40">
              <label className="label-base" htmlFor="ca-loc">Location</label>
              <input id="ca-loc" className="input-base" value={f.location} placeholder="Optional"
                onChange={e => setF(p => ({ ...p, location: e.target.value }))} />
            </div>
          </div>

          {/* THE MONEY — the shape of the next field follows the basis. */}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <span className="label-base">Charged</span>
              <div className="flex rounded-lg border border-gray-300 overflow-hidden h-[38px]">
                {(Object.keys(RATE_TYPE) as RateType[]).map(rt => (
                  <button key={rt} type="button" onClick={() => setF(p => ({ ...p, rateType: rt }))}
                    aria-pressed={f.rateType === rt}
                    className={`px-3 text-xs transition-colors ${f.rateType === rt ? 'bg-brand-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                    {RATE_TYPE[rt]}
                  </button>
                ))}
              </div>
            </div>
            {f.rateType === 'daily' && (
              <div className="w-24">
                <label className="label-base" htmlFor="ca-days">Days</label>
                <input id="ca-days" type="number" min="0" step="0.5" inputMode="decimal"
                  className="input-base text-right tnum" value={f.days}
                  onChange={e => setF(p => ({ ...p, days: e.target.value }))} />
              </div>
            )}
            <div className="w-32">
              <label className="label-base" htmlFor="ca-rate">
                {f.rateType === 'hourly' ? 'Rate / hour' : f.rateType === 'daily' ? 'Rate / day' : 'Fee'}
              </label>
              <input id="ca-rate" type="number" min="0" step="0.01" inputMode="decimal"
                className="input-base text-right tnum" value={f.rate}
                onChange={e => setF(p => ({ ...p, rate: e.target.value }))} />
            </div>
            <div className="w-24">
              <label className="label-base" htmlFor="ca-ccy">Currency</label>
              <select id="ca-ccy" className="input-base" value={f.currency}
                onChange={e => setF(p => ({ ...p, currency: e.target.value }))}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex gap-2 ml-auto">
              <button type="button" onClick={save} disabled={busy} className="btn-primary text-sm">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : editId ? <CheckCircle2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {editId ? 'Save' : 'Add'}
              </button>
              <button type="button" onClick={cancel} className="btn-secondary text-sm">Cancel</button>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Leave the rate blank if you don’t know it yet — an unpriced attendance is never claimed,
            so it can’t be billed at zero by accident.
          </p>
        </div>
      )}

      {rows === null ? (
        <div className="p-6 space-y-2">{[0, 1].map(i => <div key={i} className="skeleton h-10 w-full rounded-lg" />)}</div>
      ) : rows.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-gray-400">
          Nothing logged yet — tap Phone call or Email for a ten-minute block, or log an attendance.
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {rows.map(a => (
            <div key={a.id} className={`flex flex-wrap items-center gap-3 px-6 py-3 ${editId === a.id ? 'bg-brand-50' : ''}`}>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-900 truncate">
                  {a.attendee_label}
                  {!a.attendee_profile_id && <span className="ml-1.5 text-xs text-gray-400">contractor</span>}
                  {a.description && <span className="text-gray-500"> · {a.description}</span>}
                </p>
                <p className="text-xs text-gray-500 tnum">
                  {formatDate(a.attended_on)} · {formatMinutes(a.minutes)}
                  {a.location ? ` · ${a.location}` : ''}
                  {a.document_count > 0 && (
                    <span className="ml-1.5 inline-flex items-center gap-0.5 text-gray-400">
                      <Paperclip className="h-3 w-3" />{a.document_count}
                    </span>
                  )}
                </p>
              </div>

              <span className="text-sm text-gray-900 tnum w-28 text-right">
                {a.charge_amount == null
                  ? <span className="text-xs text-amber-700">no rate</span>
                  : `${money(a.charge_amount)} ${a.currency}`}
              </span>

              <span className="w-24 text-right text-xs flex-shrink-0">
                {a.claim_no
                  ? <span className="text-gray-400">claim #{a.claim_no}</span>
                  : <span className="text-brand-700">unclaimed</span>}
              </span>

              {/* A claimed row is read-only: undo the claim to change it. */}
              <span className="flex items-center flex-shrink-0">
                <button type="button" onClick={() => startEdit(a)} disabled={!!a.claim_id}
                  aria-label="Edit this attendance"
                  title={a.claim_id ? `On claim #${a.claim_no} — undo it to make changes` : 'Edit this attendance'}
                  className="btn-ghost p-1 text-gray-400 hover:text-brand-700 disabled:opacity-30">
                  <Pencil className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => remove(a)} disabled={!!a.claim_id}
                  aria-label="Delete this attendance"
                  title={a.claim_id ? `On claim #${a.claim_no} — undo it first` : 'Delete this attendance'}
                  className="btn-ghost p-1 text-gray-400 hover:text-red-600 disabled:opacity-30">
                  <X className="h-4 w-4" />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
