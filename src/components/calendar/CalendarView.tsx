'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  addMonths, subMonths, format, isSameMonth, isToday,
} from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { Modal } from '@/components/ui/Modal'
import { useRealtimeRefresh } from '@/lib/realtime'
import {
  ChevronLeft, ChevronRight, Plus, Loader2, Plane, Briefcase, Check, X, Pencil, Trash2,
} from 'lucide-react'
import {
  listCalendar, listPendingLeave, requestLeave, reviewLeave,
  createGeneralEvent, updateGeneralEvent, deleteEvent,
  type CalendarEventRow,
} from '@/lib/calendar/api'
import type { CalendarJob, CalendarVisibility, UserRole } from '@/lib/types/database'
import { confirmDialog } from '@/components/ui/confirm'

const iso = (d: Date) => format(d, 'yyyy-MM-dd')
const JOB_COLOR = '#3b82f6'
const LEAVE_COLOR = '#f59e0b'
const EVENT_COLOR = '#6366f1' // indigo — distinct from jobs

// Jobs are coloured by status so the calendar reads at a glance.
const JOB_STATUS_COLOR: Record<string, string> = {
  draft: '#94a3b8',          // slate
  assigned: '#3b82f6',       // blue
  in_progress: '#3b82f6',    // blue
  submitted: '#8b5cf6',      // violet
  completed: '#22c55e',      // green
  client_visible: '#14b8a6', // teal
  archived: '#94a3b8',
}
const jobColor = (status: string) => JOB_STATUS_COLOR[status] ?? JOB_COLOR

const LEGEND: { color: string; label: string }[] = [
  { color: '#3b82f6', label: 'Job — active' },
  { color: '#8b5cf6', label: 'Job — submitted' },
  { color: '#22c55e', label: 'Job — completed' },
  { color: '#14b8a6', label: 'Job — client visible' },
  { color: LEAVE_COLOR, label: 'Leave' },
  { color: EVENT_COLOR, label: 'Event' },
]

const ROLE_OPTIONS: { role: UserRole; label: string }[] = [
  { role: 'surveyor', label: 'Surveyors' }, { role: 'admin', label: 'Admins' },
  { role: 'office', label: 'Office' }, { role: 'client', label: 'Clients' },
]

export default function CalendarView({ isAdmin, canRequestLeave }: { isAdmin: boolean; canRequestLeave: boolean }) {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()))
  const [jobs, setJobs] = useState<CalendarJob[]>([])
  const [events, setEvents] = useState<CalendarEventRow[]>([])
  const [pending, setPending] = useState<CalendarEventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [dayDetail, setDayDetail] = useState<string | null>(null)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [eventEdit, setEventEdit] = useState<CalendarEventRow | 'new' | null>(null)
  const tick = useRealtimeRefresh('calendar_events')

  const days = useMemo(() => eachDayOfInterval({
    start: startOfWeek(startOfMonth(cursor)), end: endOfWeek(endOfMonth(cursor)),
  }), [cursor])

  async function reload() {
    setLoading(true)
    const gridStart = iso(days[0]), gridEnd = iso(days[days.length - 1])
    const [{ jobs, events }, pend] = await Promise.all([
      listCalendar(gridStart, gridEnd),
      isAdmin ? listPendingLeave() : Promise.resolve([] as CalendarEventRow[]),
    ])
    setJobs(jobs); setEvents(events); setPending(pend); setLoading(false)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload() }, [cursor, tick, isAdmin])

  function jobsOn(dayStr: string) { return jobs.filter(j => j.scheduled_date === dayStr) }
  function eventsOn(dayStr: string) {
    return events.filter(e => e.start_date <= dayStr && e.end_date >= dayStr)
  }

  const weeks: Date[][] = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Calendar</h1>
          <p className="text-gray-500 mt-0.5">Jobs, leave and team events.</p>
        </div>
        <div className="flex items-center gap-2">
          {canRequestLeave && <button onClick={() => setLeaveOpen(true)} className="btn-secondary text-sm"><Plane className="h-4 w-4" />Request leave</button>}
          {isAdmin && <button onClick={() => setEventEdit('new')} className="btn-primary text-sm"><Plus className="h-4 w-4" />Add event</button>}
        </div>
      </div>

      {isAdmin && pending.length > 0 && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4">
          <p className="text-sm font-semibold text-amber-800 mb-2">{pending.length} leave request{pending.length > 1 ? 's' : ''} awaiting approval</p>
          <div className="space-y-2">
            {pending.map(p => (
              <div key={p.id} className="flex items-center justify-between gap-3 bg-white rounded-lg px-3 py-2 border border-amber-100">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{p.owner_name ?? 'Surveyor'}</p>
                  <p className="text-xs text-gray-500">{p.start_date}{p.end_date !== p.start_date ? ` → ${p.end_date}` : ''}{p.description ? ` · ${p.description}` : ''}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button onClick={async () => { await reviewLeave(p.id, 'approved'); reload() }} className="btn-secondary py-1 px-2.5 text-xs text-green-700"><Check className="h-3.5 w-3.5" />Approve</button>
                  <button onClick={async () => { await reviewLeave(p.id, 'rejected'); reload() }} className="btn-ghost py-1 px-2.5 text-xs text-red-600 hover:bg-red-50"><X className="h-3.5 w-3.5" />Reject</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900">{format(cursor, 'MMMM yyyy')}</h2>
          <div className="flex items-center gap-1">
            <button onClick={() => setCursor(c => subMonths(c, 1))} className="btn-ghost p-1.5"><ChevronLeft className="h-4 w-4" /></button>
            <button onClick={() => setCursor(startOfMonth(new Date()))} className="btn-secondary text-xs py-1 px-3">Today</button>
            <button onClick={() => setCursor(c => addMonths(c, 1))} className="btn-ghost p-1.5"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-px text-center text-[11px] font-medium text-gray-400 mb-1">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d} className="py-1">{d}</div>)}
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-brand-600" /></div>
        ) : (
          <div className="space-y-px">
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-px">
                {week.map(day => {
                  const dayStr = iso(day)
                  const inMonth = isSameMonth(day, cursor)
                  const dayJobs = jobsOn(dayStr)
                  const dayEvents = eventsOn(dayStr)
                  const total = dayJobs.length + dayEvents.length
                  return (
                    <button key={dayStr} onClick={() => setDayDetail(dayStr)}
                      className={`min-h-[84px] text-left p-1.5 rounded-lg border align-top transition-colors ${inMonth ? 'bg-white border-gray-100 hover:border-brand-200' : 'bg-gray-50/60 border-transparent'}`}>
                      <span className={`inline-flex items-center justify-center h-6 w-6 rounded-full text-xs ${isToday(day) ? 'bg-brand-600 text-white font-semibold' : inMonth ? 'text-gray-700' : 'text-gray-300'}`}>{format(day, 'd')}</span>
                      <div className="mt-1 space-y-0.5">
                        {dayEvents.slice(0, 2).map(e => <Chip key={e.id} color={e.event_type === 'leave' ? LEAVE_COLOR : (e.color ?? EVENT_COLOR)} label={e.event_type === 'leave' ? (isAdmin ? `Leave: ${e.owner_name ?? ''}` : 'Leave') + (e.status === 'pending' ? ' (pending)' : '') : e.title} />)}
                        {dayJobs.slice(0, Math.max(0, 3 - Math.min(dayEvents.length, 2))).map(j => <Chip key={j.id} color={jobColor(j.status)} label={j.surveyor_name ? `${j.vessel_name ?? j.title} · ${j.surveyor_name}` : (j.vessel_name ?? j.title)} />)}
                        {total > 3 && <p className="text-[10px] text-gray-400 pl-0.5">+{total - 3} more</p>}
                      </div>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500">
          {LEGEND.map(l => (
            <span key={l.label} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: l.color }} />{l.label}</span>
          ))}
        </div>
      </div>

      {dayDetail && (
        <DayModal dayStr={dayDetail} jobs={jobsOn(dayDetail)} events={eventsOn(dayDetail)} isAdmin={isAdmin}
          onClose={() => setDayDetail(null)}
          onEditEvent={(e) => { setDayDetail(null); setEventEdit(e) }}
          onChanged={reload} />
      )}
      {leaveOpen && <LeaveModal onClose={() => setLeaveOpen(false)} onSaved={() => { setLeaveOpen(false); reload() }} />}
      {eventEdit && <EventModal editing={eventEdit} onClose={() => setEventEdit(null)} onSaved={() => { setEventEdit(null); reload() }} />}
    </div>
  )
}

function Chip({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1 text-[10px] leading-tight text-gray-700 truncate">
      <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      <span className="truncate">{label}</span>
    </div>
  )
}

function DayModal({ dayStr, jobs, events, isAdmin, onClose, onEditEvent, onChanged }: {
  dayStr: string; jobs: CalendarJob[]; events: CalendarEventRow[]; isAdmin: boolean
  onClose: () => void; onEditEvent: (e: CalendarEventRow) => void; onChanged: () => void
}) {
  async function removeEvent(id: string) {
    if (!(await confirmDialog({ message: 'Delete this event?', danger: true, confirmLabel: 'Delete' }))) return
    await deleteEvent(id); onChanged(); onClose()
  }
  return (
    <Modal open onClose={onClose} title={format(new Date(dayStr + 'T00:00:00'), 'EEEE, d MMMM yyyy')} size="lg">
      <div className="space-y-4">
        {events.length === 0 && jobs.length === 0 && <p className="text-sm text-gray-400 text-center py-6">Nothing scheduled.</p>}

        {events.map(e => (
          <div key={e.id} className="rounded-lg border border-gray-200 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-gray-900">{e.event_type === 'leave' ? (isAdmin ? `Leave — ${e.owner_name ?? ''}` : 'Leave') : e.title}{e.status === 'pending' && <span className="ml-2 text-xs text-amber-600">pending</span>}</p>
                <p className="text-xs text-gray-500">{e.start_date}{e.end_date !== e.start_date ? ` → ${e.end_date}` : ''}</p>
                {e.description && <p className="text-sm text-gray-600 mt-1">{e.description}</p>}
              </div>
              {isAdmin && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  {e.event_type === 'general' && <button onClick={() => onEditEvent(e)} className="btn-ghost py-1 px-2 text-xs"><Pencil className="h-3.5 w-3.5" /></button>}
                  <button onClick={() => removeEvent(e.id)} className="btn-ghost py-1 px-2 text-xs text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              )}
            </div>
          </div>
        ))}

        {jobs.map(j => (
          <div key={j.id} className="rounded-lg border border-gray-200 p-3" style={{ borderLeftWidth: 3, borderLeftColor: jobColor(j.status) }}>
            <p className="font-medium text-gray-900 flex items-center gap-2"><Briefcase className="h-4 w-4" style={{ color: jobColor(j.status) }} />{j.vessel_name ?? j.title}<span className="text-xs text-gray-400">{j.job_number}</span></p>
            <p className="text-xs text-gray-500 mt-0.5">{j.surveyor_name ?? 'No surveyor'} · {j.client_name ?? 'No client'} · {j.status}</p>
          </div>
        ))}
      </div>
    </Modal>
  )
}

function LeaveModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!start || !end) { setError('Pick a start and end date.'); return }
    if (end < start) { setError('End date must be on or after the start date.'); return }
    setSaving(true); setError(null)
    const res = await requestLeave({ start_date: start, end_date: end, description: note })
    setSaving(false)
    if (res.error) { setError(res.error); return }
    onSaved()
  }
  return (
    <Modal open onClose={onClose} title="Request leave" size="md"
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={submit} disabled={saving} className="btn-primary">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Submit</button></>}>
      <div className="space-y-3">
        <p className="text-sm text-gray-500">Your request goes to the administrators for approval. Other surveyors can&apos;t see your leave.</p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label-base">From</label><input type="date" className="input-base" value={start} onChange={e => setStart(e.target.value)} /></div>
          <div><label className="label-base">To</label><input type="date" className="input-base" value={end} onChange={e => setEnd(e.target.value)} /></div>
        </div>
        <div><label className="label-base">Note (optional)</label><input className="input-base" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Annual leave" /></div>
        {error && <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700">{error}</div>}
      </div>
    </Modal>
  )
}

interface PickedUser { id: string; full_name: string; role: string }

function EventModal({ editing, onClose, onSaved }: { editing: CalendarEventRow | 'new'; onClose: () => void; onSaved: () => void }) {
  const e = editing === 'new' ? null : editing
  const [title, setTitle] = useState(e?.title ?? '')
  const [desc, setDesc] = useState(e?.description ?? '')
  const [start, setStart] = useState(e?.start_date ?? '')
  const [end, setEnd] = useState(e?.end_date ?? '')
  const [color, setColor] = useState(e?.color ?? EVENT_COLOR)
  const [visibility, setVisibility] = useState<CalendarVisibility>(e && e.visibility !== 'private' ? e.visibility : 'everyone')
  const [roles, setRoles] = useState<Set<UserRole>>(new Set(e?.visible_roles ?? []))
  const [picked, setPicked] = useState<PickedUser[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PickedUser[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleRole(r: UserRole) { setRoles(prev => { const n = new Set(prev); if (n.has(r)) n.delete(r); else n.add(r); return n }) }
  async function search(q: string) {
    setQuery(q)
    if (q.trim().length < 2) { setResults([]); return }
    const { data } = await createClient().from('profiles').select('id, full_name, role').ilike('full_name', `%${q.trim()}%`).eq('is_active', true).order('full_name').limit(8)
    setResults((data as PickedUser[] ?? []).filter(u => !picked.some(p => p.id === u.id)))
  }

  async function submit() {
    if (!title.trim()) { setError('Title is required.'); return }
    if (!start || !end) { setError('Pick start and end dates.'); return }
    if (end < start) { setError('End date must be on or after the start date.'); return }
    if (visibility === 'roles' && roles.size === 0) { setError('Choose at least one role.'); return }
    if (visibility === 'users' && picked.length === 0) { setError('Choose at least one person.'); return }
    setSaving(true); setError(null)
    const payload = {
      title, description: desc, start_date: start, end_date: end, color,
      visibility, visible_roles: Array.from(roles), visible_user_ids: picked.map(p => p.id),
    }
    const res = e ? await updateGeneralEvent(e.id, payload) : await createGeneralEvent(payload)
    setSaving(false)
    if (res.error) { setError(res.error); return }
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={e ? 'Edit event' : 'Add event'} size="lg"
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={submit} disabled={saving} className="btn-primary">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save</button></>}>
      <div className="space-y-3">
        <div><label className="label-base">Title</label><input className="input-base" value={title} onChange={ev => setTitle(ev.target.value)} placeholder="e.g. Team meeting, Public holiday" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label-base">From</label><input type="date" className="input-base" value={start} onChange={ev => setStart(ev.target.value)} /></div>
          <div><label className="label-base">To</label><input type="date" className="input-base" value={end} onChange={ev => setEnd(ev.target.value)} /></div>
        </div>
        <div><label className="label-base">Details (optional)</label><input className="input-base" value={desc} onChange={ev => setDesc(ev.target.value)} /></div>
        <div className="flex items-center gap-3">
          <label className="label-base mb-0">Colour</label>
          <input type="color" className="h-8 w-12 rounded border border-gray-200" value={color} onChange={ev => setColor(ev.target.value)} />
        </div>

        <div>
          <label className="label-base">Who can see this?</label>
          <select className="input-base" value={visibility} onChange={ev => setVisibility(ev.target.value as CalendarVisibility)}>
            <option value="everyone">Everyone with calendar access</option>
            <option value="roles">Specific roles</option>
            <option value="users">Specific people</option>
          </select>
        </div>

        {visibility === 'roles' && (
          <div className="flex flex-wrap gap-2">
            {ROLE_OPTIONS.map(o => (
              <button key={o.role} onClick={() => toggleRole(o.role)} className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${roles.has(o.role) ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>{o.label}</button>
            ))}
          </div>
        )}

        {visibility === 'users' && (
          <div>
            <input className="input-base" placeholder="Search people by name" value={query} onChange={ev => search(ev.target.value)} />
            {results.length > 0 && (
              <div className="mt-1 border border-gray-200 rounded-lg divide-y divide-gray-100 overflow-hidden">
                {results.map(u => (
                  <button key={u.id} onClick={() => { setPicked(p => [...p, u]); setResults([]); setQuery('') }} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between"><span>{u.full_name}</span><span className="text-xs text-gray-400 capitalize">{u.role}</span></button>
                ))}
              </div>
            )}
            {picked.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {picked.map(u => <span key={u.id} className="inline-flex items-center gap-1 text-sm bg-brand-50 text-brand-700 px-2.5 py-1 rounded-full">{u.full_name}<button onClick={() => setPicked(p => p.filter(x => x.id !== u.id))} className="hover:text-brand-900"><X className="h-3.5 w-3.5" /></button></span>)}
              </div>
            )}
          </div>
        )}

        {error && <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700">{error}</div>}
      </div>
    </Modal>
  )
}
