'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Lock, Copy, Check, Download, FileText, ChevronDown, ChevronRight } from 'lucide-react'
import { fetchMyOfficePermissions, OFFICE_PERMISSIONS } from '@/lib/office/permissions'
import { signedUrl, formatBytes } from '@/lib/personal-docs/api'
import { deliverFile, CSV_MIME } from '@/lib/pdf/deliver'

interface Person {
  id: string; full_name: string; role: string
  vehicle_number: string | null; employee_number: string | null
}
interface CredRow {
  id: string; profile_id: string; credential_key: string | null
  doc_name: string; doc_type: string | null; doc_number: string | null
  issue_date: string | null; expiry_date: string | null
  insurance_company: string | null; insurance_type: string | null; coc_stage: string | null
  storage_path: string | null; content_type: string | null; size_bytes: number | null
}
type CredMap = Record<string, CredRow> // keyed by credential_key for one person

// Selectable columns, grouped. get() pulls the value for a person + their creds.
interface Col { key: string; label: string; group: string; get: (p: Person, c: CredMap) => string }
const COLS: Col[] = [
  { key: 'role', label: 'Role', group: 'Identifiers', get: p => p.role },
  { key: 'employee_number', label: 'Employee #', group: 'Identifiers', get: p => p.employee_number ?? '' },
  { key: 'vehicle_number', label: 'Vehicle #', group: 'Identifiers', get: p => p.vehicle_number ?? '' },
  { key: 'dp_number', label: "Driver's permit #", group: "Driver's permit", get: (_p, c) => c.drivers_permit?.doc_number ?? '' },
  { key: 'dp_expiry', label: "Driver's permit expiry", group: "Driver's permit", get: (_p, c) => c.drivers_permit?.expiry_date ?? '' },
  { key: 'id_number', label: 'ID card #', group: 'ID card', get: (_p, c) => c.id_card?.doc_number ?? '' },
  { key: 'id_expiry', label: 'ID card expiry', group: 'ID card', get: (_p, c) => c.id_card?.expiry_date ?? '' },
  { key: 'pp_number', label: 'Passport #', group: 'Passport', get: (_p, c) => c.passport?.doc_number ?? '' },
  { key: 'pp_expiry', label: 'Passport expiry', group: 'Passport', get: (_p, c) => c.passport?.expiry_date ?? '' },
  { key: 'ins_company', label: 'Insurance company', group: 'Insurance', get: (_p, c) => c.insurance?.insurance_company ?? '' },
  { key: 'ins_type', label: 'Insurance type', group: 'Insurance', get: (_p, c) => c.insurance?.insurance_type ?? '' },
  { key: 'ins_number', label: 'Insurance #', group: 'Insurance', get: (_p, c) => c.insurance?.doc_number ?? '' },
  { key: 'ins_expiry', label: 'Insurance expiry', group: 'Insurance', get: (_p, c) => c.insurance?.expiry_date ?? '' },
  { key: 'coc_number', label: 'CoC #', group: 'CoC', get: (_p, c) => c.coc?.doc_number ?? '' },
  { key: 'coc_expiry', label: 'CoC expiry', group: 'CoC', get: (_p, c) => c.coc?.expiry_date ?? '' },
  { key: 'coc_stage', label: 'CoC stage', group: 'CoC', get: (_p, c) => c.coc?.coc_stage ?? '' },
]
const COL_GROUPS = [...new Set(COLS.map(c => c.group))]
const DEFAULT_COLS = ['employee_number', 'vehicle_number', 'dp_number', 'dp_expiry', 'id_number', 'id_expiry', 'pp_number', 'pp_expiry']

export default function PersonnelPage() {
  const [allowed, setAllowed] = useState(true)
  const [loading, setLoading] = useState(true)
  const [people, setPeople] = useState<Person[]>([])
  const [credsByPerson, setCredsByPerson] = useState<Record<string, CredMap>>({})
  const [filesByPerson, setFilesByPerson] = useState<Record<string, CredRow[]>>({})

  const [selPeople, setSelPeople] = useState<Set<string>>(new Set())
  const [selCols, setSelCols] = useState<Set<string>>(new Set(DEFAULT_COLS))
  const [showFiles, setShowFiles] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setAllowed(false); setLoading(false); return }
      const { data: me } = await supabase.from('profiles').select('role, is_super_admin').eq('id', user.id).single()
      const isAdmin = me?.role === 'admin' || (me as any)?.is_super_admin
      let ok = isAdmin
      if (!ok && me?.role === 'office') {
        const granted = await fetchMyOfficePermissions(supabase)
        ok = granted.has(OFFICE_PERMISSIONS.PERSONAL_DOCS_VIEW)
      }
      if (!ok) { setAllowed(false); setLoading(false); return }

      const { data: profs } = await supabase
        .from('profiles')
        .select('id, full_name, role, vehicle_number, employee_number')
        .in('role', ['surveyor', 'admin']).eq('is_active', true).order('full_name')
      const staff = (profs as Person[]) ?? []
      const ids = staff.map(p => p.id)

      const { data: rows } = ids.length
        ? await supabase.from('personal_documents')
            .select('id, profile_id, credential_key, doc_name, doc_type, doc_number, issue_date, expiry_date, insurance_company, insurance_type, coc_stage, storage_path, content_type, size_bytes')
            .in('profile_id', ids)
        : { data: [] }

      const creds: Record<string, CredMap> = {}
      const files: Record<string, CredRow[]> = {}
      for (const r of (rows as CredRow[]) ?? []) {
        if (r.storage_path) (files[r.profile_id] ??= []).push(r)
        if (!r.credential_key) continue
        const m = (creds[r.profile_id] ??= {})
        if (r.credential_key === 'coc') {
          if (!m.coc || r.coc_stage === 'full') m.coc = r
        } else {
          m[r.credential_key] = r
        }
      }
      setPeople(staff)
      setCredsByPerson(creds)
      setFilesByPerson(files)
      setSelPeople(new Set(ids))
      setLoading(false)
    }
    load()
  }, [])

  const cols = useMemo(() => COLS.filter(c => selCols.has(c.key)), [selCols])
  const rows = useMemo(() => people.filter(p => selPeople.has(p.id)), [people, selPeople])

  function togglePerson(id: string) { setSelPeople(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  function toggleCol(key: string) { setSelCols(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n }) }
  function setAllPeople(on: boolean) { setSelPeople(on ? new Set(people.map(p => p.id)) : new Set()) }
  function setRolePeople(role: string, on: boolean) {
    setSelPeople(s => { const n = new Set(s); people.filter(p => p.role === role).forEach(p => on ? n.add(p.id) : n.delete(p.id)); return n })
  }
  function setGroupCols(group: string, on: boolean) {
    setSelCols(s => { const n = new Set(s); COLS.filter(c => c.group === group).forEach(c => on ? n.add(c.key) : n.delete(c.key)); return n })
  }
  function setAllCols(on: boolean) { setSelCols(on ? new Set(COLS.map(c => c.key)) : new Set()) }

  function buildMatrix(): string[][] {
    const header = ['Name', ...cols.map(c => c.label)]
    const body = rows.map(p => [p.full_name, ...cols.map(c => c.get(p, credsByPerson[p.id] ?? {}))])
    return [header, ...body]
  }
  function copyTable() {
    const tsv = buildMatrix().map(r => r.join('\t')).join('\n')
    navigator.clipboard?.writeText(tsv).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {})
  }
  async function downloadCsv() {
    const esc = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
    const csv = buildMatrix().map(r => r.map(esc).join(',')).join('\r\n')
    // Share on mobile (Save to Files), download on desktop.
    await deliverFile(new Blob([csv], { type: CSV_MIME }), 'personnel.csv', CSV_MIME)
  }
  async function openFile(path: string | null) {
    if (!path) return
    const url = await signedUrl(path)
    if (url) window.open(url, '_blank')
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
  if (!allowed) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <Lock className="h-10 w-10 text-gray-300 mx-auto mb-3" />
        <h1 className="page-title mb-2">No access</h1>
        <p className="text-gray-500">This page is for administrators and office staff with document access.</p>
      </div>
    )
  }

  const surveyors = people.filter(p => p.role === 'surveyor')
  const admins = people.filter(p => p.role === 'admin')

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="page-title">Personnel</h1>
        <p className="text-gray-500 mt-0.5">Pull staff credentials, numbers and document expiry dates — for port passes and records. Pick the people and the fields, then copy or export.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* People selector */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-medium text-gray-900">People ({selPeople.size}/{people.length})</h2>
            <div className="flex gap-2 text-xs">
              <button onClick={() => setAllPeople(true)} className="text-brand-600 hover:underline">All</button>
              <button onClick={() => setAllPeople(false)} className="text-gray-500 hover:underline">None</button>
            </div>
          </div>
          {[{ role: 'surveyor', label: 'Surveyors', list: surveyors }, { role: 'admin', label: 'Admins', list: admins }].map(grp => grp.list.length > 0 && (
            <div key={grp.role} className="mb-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">{grp.label}</p>
                <div className="flex gap-2 text-[11px]">
                  <button onClick={() => setRolePeople(grp.role, true)} className="text-brand-600 hover:underline">+all</button>
                  <button onClick={() => setRolePeople(grp.role, false)} className="text-gray-400 hover:underline">−all</button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 mt-1">
                {grp.list.map(p => (
                  <label key={p.id} className="flex items-center gap-2 py-1 text-sm cursor-pointer">
                    <input type="checkbox" checked={selPeople.has(p.id)} onChange={() => togglePerson(p.id)} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                    <span className="text-gray-700 truncate">{p.full_name}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Column selector */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-medium text-gray-900">Fields ({selCols.size})</h2>
            <div className="flex gap-2 text-xs">
              <button onClick={() => setAllCols(true)} className="text-brand-600 hover:underline">All</button>
              <button onClick={() => setAllCols(false)} className="text-gray-500 hover:underline">None</button>
            </div>
          </div>
          {COL_GROUPS.map(group => (
            <div key={group} className="mb-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">{group}</p>
                <div className="flex gap-2 text-[11px]">
                  <button onClick={() => setGroupCols(group, true)} className="text-brand-600 hover:underline">+all</button>
                  <button onClick={() => setGroupCols(group, false)} className="text-gray-400 hover:underline">−all</button>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-3 mt-1">
                {COLS.filter(c => c.group === group).map(c => (
                  <label key={c.key} className="flex items-center gap-1.5 py-1 text-sm cursor-pointer">
                    <input type="checkbox" checked={selCols.has(c.key)} onChange={() => toggleCol(c.key)} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                    <span className="text-gray-700">{c.label}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Export bar */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={copyTable} disabled={!rows.length || !cols.length} className="btn-secondary text-sm disabled:opacity-40">
          {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}{copied ? 'Copied' : 'Copy table'}
        </button>
        <button onClick={downloadCsv} disabled={!rows.length || !cols.length} className="btn-secondary text-sm disabled:opacity-40">
          <Download className="h-4 w-4" />Download CSV
        </button>
        <button onClick={() => setShowFiles(v => !v)} className="btn-ghost text-sm">
          {showFiles ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}Document files
        </button>
      </div>

      {/* Results table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-3 py-2.5 font-medium text-gray-700 sticky left-0 bg-gray-50">Name</th>
                {cols.map(c => <th key={c.key} className="text-left px-3 py-2.5 font-medium text-gray-700 whitespace-nowrap">{c.label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 || cols.length === 0 ? (
                <tr><td colSpan={cols.length + 1} className="px-3 py-10 text-center text-gray-400">Select at least one person and one field.</td></tr>
              ) : rows.map(p => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap sticky left-0 bg-white">{p.full_name}</td>
                  {cols.map(c => {
                    const v = c.get(p, credsByPerson[p.id] ?? {})
                    return <td key={c.key} className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{v || <span className="text-gray-300">—</span>}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Document files */}
      {showFiles && (
        <div className="card p-4 space-y-4">
          <h2 className="font-medium text-gray-900">Document files</h2>
          {rows.length === 0 ? (
            <p className="text-sm text-gray-400">Select people above to list their uploaded files.</p>
          ) : rows.map(p => {
            const files = filesByPerson[p.id] ?? []
            return (
              <div key={p.id}>
                <p className="text-sm font-medium text-gray-800">{p.full_name} <span className="text-xs text-gray-400">· {files.length} file{files.length !== 1 ? 's' : ''}</span></p>
                {files.length === 0 ? (
                  <p className="text-xs text-gray-400 ml-1">No uploaded files.</p>
                ) : (
                  <div className="mt-1 space-y-1">
                    {files.map(f => (
                      <div key={f.id} className="flex items-center gap-2 text-sm">
                        <FileText className="h-4 w-4 text-gray-400 flex-shrink-0" />
                        <span className="text-gray-700">{f.doc_name}</span>
                        <span className="text-xs text-gray-400">{f.doc_type ?? ''}{f.expiry_date ? ` · exp ${f.expiry_date}` : ''}{f.size_bytes ? ` · ${formatBytes(f.size_bytes)}` : ''}</span>
                        <button onClick={() => openFile(f.storage_path)} className="text-brand-600 hover:text-brand-800 inline-flex items-center gap-1 text-xs ml-auto"><Download className="h-3.5 w-3.5" />Open</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
