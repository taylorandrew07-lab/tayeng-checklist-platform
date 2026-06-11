'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Modal } from '@/components/ui/Modal'
import { Loader2, Search, X } from 'lucide-react'
import { sendMessage } from '@/lib/messages/api'
import type { UserRole } from '@/lib/types/database'

const ROLE_OPTIONS: { role: UserRole; label: string }[] = [
  { role: 'surveyor', label: 'All surveyors' },
  { role: 'office', label: 'All office' },
  { role: 'client', label: 'All clients' },
  { role: 'admin', label: 'All administrators' },
]

interface PickedUser { id: string; full_name: string; role: string }

export interface ComposeInitial {
  subject?: string
  parentId?: string
  /** Fixed recipients (a reply) — when set, the picker is hidden. */
  recipientIds?: string[]
  toLabel?: string
}

export default function ComposeModal({ open, onClose, isAdmin, initial, onSent }: {
  open: boolean; onClose: () => void; isAdmin: boolean; initial?: ComposeInitial; onSent?: () => void
}) {
  const [subject, setSubject] = useState(initial?.subject ?? '')
  const [body, setBody] = useState('')
  const [roles, setRoles] = useState<Set<UserRole>>(new Set())
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PickedUser[]>([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState<PickedUser[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fixedRecipients = initial?.recipientIds && initial.recipientIds.length > 0

  function toggleRole(r: UserRole) {
    setRoles(prev => { const n = new Set(prev); if (n.has(r)) n.delete(r); else n.add(r); return n })
  }

  async function search(q: string) {
    setQuery(q)
    if (q.trim().length < 2) { setResults([]); return }
    setSearching(true)
    const { data } = await createClient().from('profiles')
      .select('id, full_name, role').ilike('full_name', `%${q.trim()}%`).eq('is_active', true)
      .order('full_name').limit(8)
    setResults((data as PickedUser[] ?? []).filter(u => !picked.some(p => p.id === u.id)))
    setSearching(false)
  }
  function addUser(u: PickedUser) {
    setPicked(p => [...p, u]); setResults(r => r.filter(x => x.id !== u.id)); setQuery(''); setResults([])
  }
  function removeUser(id: string) { setPicked(p => p.filter(x => x.id !== id)) }

  async function submit() {
    if (!subject.trim()) { setError('Subject is required.'); return }
    if (!body.trim()) { setError('Message body is required.'); return }
    if (isAdmin && !fixedRecipients && roles.size === 0 && picked.length === 0) {
      setError('Choose at least one recipient.'); return
    }
    setSending(true); setError(null)
    const res = await sendMessage({
      subject: subject.trim(),
      body: body.trim(),
      parentId: initial?.parentId,
      ...(fixedRecipients
        ? { recipientIds: initial!.recipientIds }
        : isAdmin
          ? { recipientRoles: Array.from(roles), recipientIds: picked.map(p => p.id) }
          : {}), // non-admins always go to administrators (server-enforced)
    })
    setSending(false)
    if (res.error) { setError(res.error); return }
    onSent?.()
    onClose()
  }

  const toLine = fixedRecipients
    ? (initial?.toLabel ?? 'Reply')
    : isAdmin ? null : 'Administrators'

  return (
    <Modal open={open} onClose={onClose} title={initial?.parentId ? 'Reply' : 'New message'} size="lg"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={submit} disabled={sending} className="btn-primary">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Send
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {toLine !== null && (
          <div>
            <label className="label-base">To</label>
            <p className="text-sm text-gray-900">{toLine}</p>
          </div>
        )}

        {isAdmin && !fixedRecipients && (
          <div className="space-y-3">
            <div>
              <label className="label-base">Send to groups</label>
              <div className="flex flex-wrap gap-2">
                {ROLE_OPTIONS.map(o => (
                  <button
                    key={o.role}
                    onClick={() => toggleRole(o.role)}
                    className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${roles.has(o.role) ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="label-base">…or specific people</label>
              <div className="relative">
                <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input className="input-base pl-9" placeholder="Search by name" value={query} onChange={e => search(e.target.value)} />
              </div>
              {searching && <p className="text-xs text-gray-400 mt-1">Searching…</p>}
              {results.length > 0 && (
                <div className="mt-1 border border-gray-200 rounded-lg divide-y divide-gray-100 overflow-hidden">
                  {results.map(u => (
                    <button key={u.id} onClick={() => addUser(u)} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between">
                      <span>{u.full_name}</span><span className="text-xs text-gray-400 capitalize">{u.role}</span>
                    </button>
                  ))}
                </div>
              )}
              {picked.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {picked.map(u => (
                    <span key={u.id} className="inline-flex items-center gap-1 text-sm bg-brand-50 text-brand-700 px-2.5 py-1 rounded-full">
                      {u.full_name}
                      <button onClick={() => removeUser(u.id)} className="hover:text-brand-900"><X className="h-3.5 w-3.5" /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div>
          <label className="label-base">Subject</label>
          <input className="input-base" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" />
        </div>
        <div>
          <label className="label-base">Message</label>
          <textarea className="input-base min-h-[140px]" value={body} onChange={e => setBody(e.target.value)} placeholder="Write your message…" />
        </div>

        {error && <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700">{error}</div>}
      </div>
    </Modal>
  )
}
