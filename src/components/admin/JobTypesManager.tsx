'use client'

import { useEffect, useState } from 'react'
import { Loader2, Plus, Trash2, Check, X, Pencil, Eye, EyeOff, Bell, History } from 'lucide-react'
import { listAllJobTypes, addJobType, renameJobType, setJobTypeActive, setJobTypeReminderHours, countOpenJobsMissingReminder, applyReminderToOpenJobs, deleteJobType, type JobTypeRow } from '@/lib/jobs/tracker'
import { confirmDialog } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toast'
import { REMINDER_WINDOW_LABEL } from '@/lib/jobs/reminderWindow'

export default function JobTypesManager() {
  const [rows, setRows] = useState<JobTypeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  /** Reminder-hours inputs, kept as strings so the field can be emptied ("no
   *  reminder") without fighting a number-typed state. Keyed by job-type id. */
  const [hours, setHours] = useState<Record<string, string>>({})

  async function load() {
    const next = await listAllJobTypes()
    setRows(next)
    setHours(Object.fromEntries(next.map(r => [r.id, r.reminder_hours == null ? '' : String(r.reminder_hours)])))
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function add() {
    const n = newName.trim()
    if (!n) return
    setBusy(true)
    const { error } = await addJobType(n)
    setBusy(false)
    if (error) { toast.error(/duplicate|unique/i.test(error) ? 'That job type already exists.' : error); return }
    setNewName(''); toast.success('Job type added'); load()
  }

  async function saveRename(id: string) {
    const n = editName.trim()
    if (!n) { setEditId(null); return }
    const { error } = await renameJobType(id, n)
    if (error) { toast.error(error); return }
    setEditId(null); load()
  }

  async function toggle(r: JobTypeRow) {
    const { error } = await setJobTypeActive(r.id, !r.is_active)
    if (error) { toast.error(error); return }
    load()
  }

  /** Save the reminder default on blur/Enter. Blank clears it (this type never
   *  reminds). Only new jobs pick the value up — existing jobs keep whatever they
   *  were created with, which is why the helper text says so out loud. */
  async function saveHours(r: JobTypeRow, raw: string) {
    const trimmed = raw.trim()
    const hours = trimmed === '' ? null : Number(trimmed)
    if (hours !== null && (!Number.isFinite(hours) || hours <= 0 || hours > 8760)) {
      toast.error('Enter a number of hours between 1 and 8760, or leave blank for no reminder.')
      setHours(h => ({ ...h, [r.id]: r.reminder_hours == null ? '' : String(r.reminder_hours) }))
      return
    }
    if (hours === r.reminder_hours) return
    const { error } = await setJobTypeReminderHours(r.id, hours)
    if (error) { toast.error(error); return }
    toast.success(hours === null ? `${r.name}: reminder off` : `${r.name}: remind after ${hours}h`)
    load()
  }

  /** Arm the jobs that already exist. New jobs copy the default automatically; these
   *  were created before it was set, so they need an explicit opt-in. */
  async function applyToExisting(r: JobTypeRow) {
    if (r.reminder_hours == null) return
    setBusy(true)
    const n = await countOpenJobsMissingReminder(r.name)
    setBusy(false)
    if (n === 0) { toast.success(`No open ${r.name} jobs need arming — they all have a setting already.`); return }
    if (!(await confirmDialog({
      title: 'Apply to existing jobs',
      message: `Set a ${r.reminder_hours}-hour report reminder on ${n} open ${r.name} job${n === 1 ? '' : 's'}? Closed and invoiced jobs are left alone, and any job you've already given its own setting keeps it. Anything whose ${r.reminder_hours}h has already elapsed will show up as due right away.`,
      confirmLabel: `Arm ${n} job${n === 1 ? '' : 's'}`,
    }))) return
    const { count, error } = await applyReminderToOpenJobs(r.name, r.reminder_hours)
    if (error) { toast.error(error); return }
    toast.success(`Reminder set on ${count} ${r.name} job${count === 1 ? '' : 's'}`)
  }

  async function remove(r: JobTypeRow) {
    if (!(await confirmDialog({ title: 'Delete job type', message: `Delete "${r.name}"? It disappears from the New Job dropdown. Existing jobs keep their recorded type.`, danger: true, confirmLabel: 'Delete' }))) return
    const { error } = await deleteJobType(r.id)
    if (error) { toast.error(error); return }
    toast.success('Job type deleted'); load()
  }

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h2 className="section-title">Job Types</h2>
        <p className="text-xs text-gray-400 mt-0.5">The list of types shown when creating a job. Hidden (inactive) types stay on old jobs but drop off the dropdown.</p>
        <p className="text-xs text-gray-400 mt-1">
          <Bell className="h-3 w-3 inline-block -mt-0.5 text-amber-500" /> <strong>Report reminder</strong> — hours after a job finishes before it shows up as a report you need to write. Blank = no reminder.
          Delivered {REMINDER_WINDOW_LABEL}; if it comes due outside those hours it waits for the next working morning.
          Applies to <em>new</em> jobs of that type — existing jobs keep their own setting, which you can change on the job itself.
          To also arm the jobs you already have, use the <History className="h-3 w-3 inline-block -mt-0.5" /> button (open jobs only; closed and invoiced ones are left alone).
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} placeholder="New job type (e.g. Fuel Loadout)" className="input-base flex-1" />
        <button onClick={add} disabled={busy || !newName.trim()} className="btn-primary"><Plus className="h-4 w-4" />Add</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400">No job types yet.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {rows.map(r => (
            <div key={r.id} className="flex items-center gap-2 py-2">
              {editId === r.id ? (
                <>
                  <input value={editName} onChange={e => setEditName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveRename(r.id); if (e.key === 'Escape') setEditId(null) }} autoFocus className="input-base py-1 flex-1" />
                  <button onClick={() => saveRename(r.id)} className="btn-ghost py-1 px-1.5 text-green-600"><Check className="h-4 w-4" /></button>
                  <button onClick={() => setEditId(null)} className="btn-ghost py-1 px-1.5 text-gray-400"><X className="h-4 w-4" /></button>
                </>
              ) : (
                <>
                  <span className={`flex-1 text-sm ${r.is_active ? 'text-gray-900' : 'text-gray-400 line-through'}`}>{r.name}</span>
                  <label className="flex items-center gap-1 text-xs text-gray-400" title={`Remind after this many hours. Blank = no reminder. Delivered ${REMINDER_WINDOW_LABEL}.`}>
                    <Bell className={`h-3.5 w-3.5 ${r.reminder_hours == null ? 'text-gray-300' : 'text-amber-500'}`} />
                    <input
                      type="number" min={1} max={8760} inputMode="numeric" placeholder="off"
                      value={hours[r.id] ?? ''}
                      onChange={e => setHours(h => ({ ...h, [r.id]: e.target.value }))}
                      onBlur={e => saveHours(r, e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                      className="input-base py-1 w-16 text-center"
                    />
                    <span className="w-2">h</span>
                  </label>
                  {/* Only meaningful once a delay exists. New jobs inherit it
                      automatically; this is the opt-in for jobs already in flight. */}
                  {r.reminder_hours != null && (
                    <button onClick={() => applyToExisting(r)} disabled={busy}
                      title={`Also set this ${r.reminder_hours}h reminder on existing open ${r.name} jobs`}
                      className="btn-ghost py-1 px-1.5 text-gray-400 hover:text-amber-600 disabled:opacity-40">
                      <History className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button onClick={() => { setEditId(r.id); setEditName(r.name) }} title="Rename" className="btn-ghost py-1 px-1.5 text-gray-400 hover:text-brand-600"><Pencil className="h-3.5 w-3.5" /></button>
                  <button onClick={() => toggle(r)} title={r.is_active ? 'Hide from dropdown' : 'Show in dropdown'} className="btn-ghost py-1 px-1.5 text-gray-400 hover:text-gray-700">{r.is_active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button>
                  <button onClick={() => remove(r)} title="Delete" className="btn-ghost py-1 px-1.5 text-gray-300 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
