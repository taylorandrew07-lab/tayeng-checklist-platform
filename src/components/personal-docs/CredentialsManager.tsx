'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { FileText, Pencil, Trash2, Download, Loader2, Upload, X, Check, Copy } from 'lucide-react'
import type { PersonalDocument, CredentialKey } from '@/lib/types/database'
import {
  CREDENTIALS, credentialDef, type CredentialDef, type CredentialInput,
  listCredentialRows, saveCredential, deleteDocument, signedUrl, formatBytes, expiryStatus,
} from '@/lib/personal-docs/api'
import PersonalDocsManager from './PersonalDocsManager'
import { confirmDialog } from '@/components/ui/confirm'

function StatusChip({ expiry, lead }: { expiry: string | null; lead: number }) {
  const { status, days } = expiryStatus(expiry, lead)
  if (status === 'none') return null
  if (status === 'expired') return <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">Expired {Math.abs(days!)}d ago</span>
  if (status === 'expiring') return <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Expires in {days}d</span>
  return <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-100 text-green-700">Valid</span>
}

function rowToInput(r: PersonalDocument | undefined): CredentialInput {
  return {
    doc_number: r?.doc_number ?? '', issue_date: r?.issue_date ?? '', expiry_date: r?.expiry_date ?? '',
    reminder_lead_days: r?.reminder_lead_days ?? 60, notes: r?.notes ?? '',
    insurance_company: r?.insurance_company ?? '', insurance_type: r?.insurance_type ?? '',
  }
}

async function openFile(path: string | null) {
  if (!path) return
  const url = await signedUrl(path)
  if (url) window.open(url, '_blank')
}

/** One credential slot — read view + inline edit. For CoC, `stage` differentiates
 *  the receipt from the full certificate. */
function CredentialCard({ profileId, def, stage, row, canManage, label, hint, onChanged }: {
  profileId: string; def: CredentialDef; stage?: 'receipt' | 'full'
  row?: PersonalDocument; canManage: boolean; label: string; hint?: string
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<CredentialInput>(rowToInput(row))
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function open() { setForm(rowToInput(row)); setFile(null); setError(null); setEditing(true) }

  async function save() {
    setSaving(true); setError(null)
    const res = await saveCredential(profileId, def, form, file, stage)
    setSaving(false)
    if (res.error) { setError(res.error); return }
    setEditing(false); onChanged()
  }
  async function remove() {
    if (!row) return
    if (!(await confirmDialog({ message: `Remove ${label}? This deletes the details and any uploaded file.`, danger: true, confirmLabel: 'Remove' }))) return
    await deleteDocument(row); onChanged()
  }

  const hasData = !!(row && (row.doc_number || row.expiry_date || row.issue_date || row.storage_path || row.insurance_company))

  return (
    <div className="rounded-lg border border-gray-200 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <p className="font-medium text-gray-900">{label}</p>
          {row && <StatusChip expiry={row.expiry_date} lead={row.reminder_lead_days} />}
        </div>
        {canManage && !editing && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={open} className="btn-ghost py-1 px-2 text-xs"><Pencil className="h-3.5 w-3.5" />{hasData ? 'Edit' : 'Add'}</button>
            {row && <button onClick={remove} className="btn-ghost py-1 px-2 text-xs text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></button>}
          </div>
        )}
      </div>
      {hint && !editing && <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>}

      {!editing && (
        hasData ? (
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-sm">
            {def.insurance && <Field label="Company" value={row?.insurance_company} />}
            {def.insurance && <Field label="Type" value={row?.insurance_type} />}
            <Field label={def.numberLabel} value={row?.doc_number} />
            <Field label="Issued" value={row?.issue_date} />
            <Field label="Expires" value={row?.expiry_date} />
            <div>
              <p className="text-[11px] text-gray-400">File</p>
              {row?.storage_path
                ? <button onClick={() => openFile(row.storage_path)} className="text-brand-600 hover:text-brand-800 text-sm inline-flex items-center gap-1"><Download className="h-3.5 w-3.5" />Open ({formatBytes(row.size_bytes)})</button>
                : <p className="text-gray-400 text-sm">Not uploaded</p>}
            </div>
            {row?.notes && <div className="col-span-2 sm:col-span-3"><Field label="Notes" value={row.notes} /></div>}
          </div>
        ) : (
          <p className="text-sm text-gray-400 mt-1">Not provided.</p>
        )
      )}

      {editing && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {def.insurance && (
              <>
                <div><label className="label-base">Insurance company</label><input className="input-base" value={form.insurance_company ?? ''} onChange={e => setForm(f => ({ ...f, insurance_company: e.target.value }))} /></div>
                <div><label className="label-base">Insurance type</label><input className="input-base" value={form.insurance_type ?? ''} onChange={e => setForm(f => ({ ...f, insurance_type: e.target.value }))} placeholder="e.g. Auto, Life, Health" /></div>
              </>
            )}
            <div><label className="label-base">{def.numberLabel}</label><input className="input-base" value={form.doc_number ?? ''} onChange={e => setForm(f => ({ ...f, doc_number: e.target.value }))} /></div>
            <div><label className="label-base">Remind me (days before expiry)</label><input type="number" min={1} max={365} className="input-base" value={form.reminder_lead_days ?? 60} onChange={e => setForm(f => ({ ...f, reminder_lead_days: Number(e.target.value) }))} /></div>
            <div><label className="label-base">Issue date</label><input type="date" className="input-base" value={form.issue_date ?? ''} onChange={e => setForm(f => ({ ...f, issue_date: e.target.value }))} /></div>
            <div><label className="label-base">Expiry date</label><input type="date" className="input-base" value={form.expiry_date ?? ''} onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))} /></div>
            <div className="sm:col-span-2"><label className="label-base">Notes</label><input className="input-base" value={form.notes ?? ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" /></div>
            <div className="sm:col-span-2">
              <label className="label-base">File {row?.storage_path ? '(uploading replaces the current file)' : '(optional)'}</label>
              <input ref={fileRef} type="file" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
              <button onClick={() => fileRef.current?.click()} className="btn-secondary text-sm"><Upload className="h-4 w-4" />{file ? file.name : 'Choose file'}</button>
            </div>
          </div>
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(false)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={save} disabled={saving} className="btn-primary text-sm">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-[11px] text-gray-400">{label}</p>
      <p className="text-gray-900">{value || <span className="text-gray-400">—</span>}</p>
    </div>
  )
}

/** Simple identifiers (no expiry / no file) kept on the profile row. */
function Identifiers({ profileId, canManage }: { profileId: string; canManage: boolean }) {
  const [vals, setVals] = useState<{ vehicle_number: string; employee_number: string }>({ vehicle_number: '', employee_number: '' })
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data } = await createClient().from('profiles')
      .select('vehicle_number, employee_number').eq('id', profileId).single()
    setVals({ vehicle_number: (data as any)?.vehicle_number ?? '', employee_number: (data as any)?.employee_number ?? '' })
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [profileId])

  async function save() {
    setSaving(true); setError(null)
    const { error } = await createClient().from('profiles')
      .update({ vehicle_number: vals.vehicle_number.trim() || null, employee_number: vals.employee_number.trim() || null })
      .eq('id', profileId)
    setSaving(false)
    if (error) { setError(error.message); return }
    setEditing(false)
  }

  return (
    <div className="rounded-lg border border-gray-200 p-3.5">
      <div className="flex items-center justify-between">
        <p className="font-medium text-gray-900">Identifiers</p>
        {canManage && !editing && <button onClick={() => setEditing(true)} className="btn-ghost py-1 px-2 text-xs"><Pencil className="h-3.5 w-3.5" />Edit</button>}
      </div>
      {!editing ? (
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <Field label="Vehicle number" value={vals.vehicle_number} />
          <Field label="Employee number" value={vals.employee_number} />
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="label-base">Vehicle number</label><input className="input-base" value={vals.vehicle_number} onChange={e => setVals(v => ({ ...v, vehicle_number: e.target.value }))} /></div>
            <div><label className="label-base">Employee number</label><input className="input-base" value={vals.employee_number} onChange={e => setVals(v => ({ ...v, employee_number: e.target.value }))} /></div>
          </div>
          {error && <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={() => { setEditing(false); setError(null); load() }} className="btn-secondary text-sm">Cancel</button>
            <button onClick={save} disabled={saving} className="btn-primary text-sm">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function CredentialsManager({ profileId, canManage, ownerName, showCopy }: {
  profileId: string; canManage: boolean; ownerName?: string; showCopy?: boolean
}) {
  const [rows, setRows] = useState<PersonalDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  async function reload() { setRows(await listCredentialRows(profileId)); setLoading(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload() }, [profileId])

  const byKey = (k: CredentialKey, stage?: 'receipt' | 'full') =>
    rows.find(r => r.credential_key === k && (k !== 'coc' || r.coc_stage === (stage ?? 'full')))

  async function copyDetails() {
    const lines: string[] = []
    if (ownerName) lines.push(`Name: ${ownerName}`)
    const prof = await createClient().from('profiles').select('vehicle_number, employee_number').eq('id', profileId).single()
    lines.push(`Vehicle #: ${(prof.data as any)?.vehicle_number || '—'}`)
    lines.push(`Employee #: ${(prof.data as any)?.employee_number || '—'}`)
    for (const def of CREDENTIALS) {
      if (def.coc) continue
      const r = byKey(def.key)
      lines.push(`${def.label}: ${r?.doc_number || '—'}${r?.expiry_date ? ` (exp ${r.expiry_date})` : ''}`)
    }
    const ins = byKey('insurance')
    if (ins) lines.push(`Insurance: ${ins.insurance_company || '—'} ${ins.insurance_type ? `(${ins.insurance_type})` : ''}`.trim())
    const coc = byKey('coc', 'full') ?? byKey('coc', 'receipt')
    if (coc) lines.push(`CoC: ${coc.coc_stage === 'receipt' ? 'receipt' : 'full'}${coc.expiry_date ? ` (exp ${coc.expiry_date})` : ''}`)
    navigator.clipboard?.writeText(lines.join('\n')).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {})
  }

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>

  const dp = credentialDef
  return (
    <div className="space-y-5">
      {showCopy && (
        <div className="flex justify-end">
          <button onClick={copyDetails} className="btn-secondary text-sm">{copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}{copied ? 'Copied' : 'Copy details'}</button>
        </div>
      )}

      <Identifiers profileId={profileId} canManage={canManage} />

      <div className="space-y-3">
        {CREDENTIALS.filter(c => !c.coc).map(def => (
          <CredentialCard key={def.key} profileId={profileId} def={def} row={byKey(def.key)} canManage={canManage} label={def.label} onChanged={reload} />
        ))}

        {/* CoC — receipt first, then the full certificate (which removes the receipt). */}
        <div className="rounded-lg border border-gray-200 p-3.5 space-y-3">
          <div>
            <p className="font-medium text-gray-900">Certificate of Character (CoC)</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Upload the receipt first; when the full certificate is added it automatically replaces the receipt.</p>
          </div>
          <CredentialCard profileId={profileId} def={dp('coc')} stage="receipt" row={byKey('coc', 'receipt')} canManage={canManage} label="Receipt" hint="Temporary — used until the certificate is collected." onChanged={reload} />
          <CredentialCard profileId={profileId} def={dp('coc')} stage="full" row={byKey('coc', 'full')} canManage={canManage} label="Full certificate" onChanged={reload} />
        </div>
      </div>

      <div>
        <p className="font-medium text-gray-900 mb-2">Other documents</p>
        <p className="text-[11px] text-gray-400 mb-2">Anything else — medicals, safety certs, references. Add an expiry to be reminded.</p>
        <PersonalDocsManager profileId={profileId} canManage={canManage} />
      </div>
    </div>
  )
}
