'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Pencil } from 'lucide-react'
import PersonalDocsManager from './PersonalDocsManager'

/** Employee/pass fields editable directly by their owner (no approval), per the
 *  safe-self-update policy. Used on /profile for staff. */
const FIELDS = [
  ['vehicle_number', 'Vehicle number'],
  ['drivers_permit_number', "Driver's permit number"],
  ['id_card_number', 'ID card number'],
  ['passport_number', 'Passport number'],
  ['employee_number', 'Employee number'],
] as const

export default function ProfileExtras({ userId }: { userId: string }) {
  const [vals, setVals] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const supabase = createClient()
    const { data } = await supabase.from('profiles')
      .select('vehicle_number, drivers_permit_number, id_card_number, passport_number, employee_number')
      .eq('id', userId).single()
    const v: Record<string, string> = {}
    for (const [k] of FIELDS) v[k] = (data as any)?.[k] ?? ''
    setVals(v); setLoading(false)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [userId])

  async function save() {
    setSaving(true); setError(null)
    const supabase = createClient()
    const patch: Record<string, any> = {}
    for (const [k] of FIELDS) patch[k] = vals[k].trim() || null
    const { error } = await supabase.from('profiles').update(patch).eq('id', userId)
    setSaving(false)
    if (error) { setError(error.message); return }
    setEditing(false)
  }

  return (
    <>
      <div className="card p-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="section-title">Employee details</h2>
          {!editing && <button onClick={() => setEditing(true)} className="btn-secondary text-sm"><Pencil className="h-4 w-4" />Edit</button>}
        </div>
        <p className="text-xs text-gray-400 mb-2">Used by the office to produce port passes. You can edit these directly — no approval needed.</p>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>
        ) : (
          <>
            {FIELDS.map(([k, label]) => (
              <div key={k} className="py-3 border-b border-gray-100 last:border-0">
                <label className="text-sm font-medium text-gray-500">{label}</label>
                {editing ? (
                  <input className="input-base mt-1" value={vals[k] ?? ''} onChange={e => setVals(v => ({ ...v, [k]: e.target.value }))} />
                ) : (
                  <p className="text-gray-900 mt-0.5">{vals[k] || <span className="text-gray-400">—</span>}</p>
                )}
              </div>
            ))}
            {error && <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700 mt-3">{error}</div>}
            {editing && (
              <div className="flex justify-end gap-2 mt-3">
                <button onClick={() => { setEditing(false); setError(null); load() }} className="btn-secondary text-sm">Cancel</button>
                <button onClick={save} disabled={saving} className="btn-primary text-sm">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save</button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="card p-6">
        <h2 className="section-title mb-2">My Documents</h2>
        <p className="text-xs text-gray-400 mb-3">Port passes, licences, passport, COC, medicals, safety certs. Add issue/expiry dates and you&apos;ll be reminded before they expire.</p>
        <PersonalDocsManager profileId={userId} canManage />
      </div>
    </>
  )
}
