'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Plus, Loader2, Building2, Pencil, Check, X, Upload, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import PeopleTabs from '@/components/admin/PeopleTabs'
import ColorSwatchPicker from '@/components/ui/ColorSwatchPicker'
import { formatDate, withTimeout } from '@/lib/utils'
import { toast } from '@/components/ui/toast'
import type { Client } from '@/lib/types/database'

const LOGO_BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/client-logos`
function logoUrl(path?: string | null): string | null {
  return path ? `${LOGO_BASE}/${path}` : null
}

// Renders a client logo filling a fixed-height zone, left-aligned. object-contain
// keeps the aspect ratio (never cropped/distorted): wide logos run the full width
// of the zone, square logos fill its height — both as large as they can go.
function ClientLogo({ src, name }: { src: string | null; name: string }) {
  return (
    <div className="h-24 sm:h-28 rounded-lg bg-gray-50 border border-gray-100 flex items-center p-3 overflow-hidden">
      {src ? (
        <img
          src={src}
          alt={`${name} logo`}
          className="h-full w-full object-contain object-left"
        />
      ) : (
        <Building2 className="h-10 w-10 text-gray-300 mx-auto" />
      )}
    </div>
  )
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editClient, setEditClient] = useState<Client | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jobCounts, setJobCounts] = useState<Record<string, number>>({})
  const [form, setForm] = useState({
    name: '',
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    address: '',
    notes: '',
    logo_path: '',
    color: '' as string,
  })
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    const supabase = createClient()
    // One clients query + one jobs query (tallied in JS) instead of a count
    // query per client.
    const [{ data: c }, { data: jobRows }] = await Promise.all([
      supabase.from('clients').select('*').order('name'),
      supabase.from('jobs').select('client_id'),
    ])
    setClients(c ?? [])
    const counts: Record<string, number> = {}
    for (const j of (jobRows ?? []) as { client_id: string | null }[]) {
      if (j.client_id) counts[j.client_id] = (counts[j.client_id] ?? 0) + 1
    }
    setJobCounts(counts)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // Deep link from the Jobs Tracker (?focus=<clientId>) opens that client.
  const focusHandled = useRef(false)
  useEffect(() => {
    if (focusHandled.current || clients.length === 0) return
    const focus = new URLSearchParams(window.location.search).get('focus')
    if (!focus) return
    const c = clients.find(x => x.id === focus)
    if (c) { focusHandled.current = true; openEdit(c) }
  }, [clients])

  function openCreate() {
    setEditClient(null)
    setForm({ name: '', contact_name: '', contact_email: '', contact_phone: '', address: '', notes: '', logo_path: '', color: '' })
    setLogoFile(null)
    setLogoPreview(null)
    setError(null)
    setShowModal(true)
  }

  function openEdit(client: Client) {
    setEditClient(client)
    setForm({
      name: client.name,
      contact_name: client.contact_name ?? '',
      contact_email: client.contact_email ?? '',
      contact_phone: client.contact_phone ?? '',
      address: client.address ?? '',
      notes: client.notes ?? '',
      logo_path: client.logo_path ?? '',
      color: client.color ?? '',
    })
    setLogoFile(null)
    setLogoPreview(logoUrl(client.logo_path))
    setError(null)
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Client name is required'); return }
    setSaving(true)
    setError(null)
    const supabase = createClient()

    // Upload a newly-selected logo first; keep the existing path otherwise.
    let logo_path: string | null = form.logo_path || null
    if (logoFile) {
      const safeName = logoFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${crypto.randomUUID()}-${safeName}`
      let upErr
      try {
        ({ error: upErr } = await withTimeout(
          supabase.storage.from('client-logos').upload(path, logoFile, { contentType: logoFile.type, upsert: false }),
          60_000, 'Uploading logo'
        ))
      } catch {
        setError('Logo upload timed out — check your connection and try again.'); setSaving(false); return
      }
      if (upErr) { setError('Logo upload failed: ' + upErr.message); setSaving(false); return }
      logo_path = path
    }

    const payload = {
      name: form.name.trim(),
      contact_name: form.contact_name || null,
      contact_email: form.contact_email || null,
      contact_phone: form.contact_phone || null,
      address: form.address || null,
      notes: form.notes || null,
      logo_path,
      color: form.color || null,
    }

    if (editClient) {
      const { error: err } = await supabase.from('clients').update(payload).eq('id', editClient.id)
      if (err) { setError(err.message); setSaving(false); return }
    } else {
      const { error: err } = await supabase.from('clients').insert(payload)
      if (err) { setError(err.message); setSaving(false); return }
    }

    setShowModal(false)
    setSaving(false)
    load()
  }

  function onLogoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoFile(file)
    setLogoPreview(URL.createObjectURL(file))
  }

  function removeLogo() {
    setLogoFile(null)
    setLogoPreview(null)
    setForm(p => ({ ...p, logo_path: '' }))
    if (fileRef.current) fileRef.current.value = ''
  }

  async function toggleActive(client: Client) {
    const supabase = createClient()
    const { data, error } = await supabase.from('clients')
      .update({ is_active: !client.is_active }).eq('id', client.id).select('id')
    if (error) { toast.error('Could not update client: ' + error.message); return }
    if (!data || data.length === 0) { toast.error('That change was blocked — you may not have permission.'); return }
    load()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PeopleTabs />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Clients</h1>
          <p className="text-gray-500 mt-1">{clients.length} clients</p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus className="h-4 w-4" />
          Add Client
        </button>
      </div>

      {clients.length === 0 ? (
        <div className="card py-16 text-center">
          <Building2 className="h-12 w-12 mx-auto text-gray-300 mb-3" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">No clients yet</h3>
          <p className="text-gray-500 text-sm mb-6">Add your first client to start assigning jobs.</p>
          <button onClick={openCreate} className="btn-primary">
            <Plus className="h-4 w-4" />
            Add Client
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {clients.map(client => (
            <div key={client.id} className={`card p-5 sm:p-6 flex flex-col ${!client.is_active ? 'opacity-60' : ''}`}>
              {/* Status */}
              <div className="flex justify-end mb-3">
                {client.is_active ? (
                  <span className="text-xs text-green-600 font-medium flex items-center gap-0.5"><Check className="h-3 w-3" />Active</span>
                ) : (
                  <span className="text-xs text-gray-400 font-medium">Inactive</span>
                )}
              </div>

              {/* Logo */}
              <Link href={`/admin/clients/${client.id}`} className="block">
                <ClientLogo src={logoUrl(client.logo_path)} name={client.name} />
              </Link>

              {/* Name + contacts */}
              <h3 className="font-semibold text-gray-900 mt-4 break-words">
                <Link href={`/admin/clients/${client.id}`} className="hover:text-brand-700 hover:underline">{client.name}</Link>
              </h3>
              {client.contact_name && <p className="text-sm text-gray-600 mt-0.5 truncate">{client.contact_name}</p>}
              {client.contact_email && <p className="text-sm text-gray-500 truncate">{client.contact_email}</p>}
              {client.contact_phone && <p className="text-sm text-gray-500 truncate">{client.contact_phone}</p>}

              {/* Footer */}
              <div className="flex items-center justify-between mt-auto pt-4 border-t border-gray-100">
                <span className="text-xs text-gray-400">{jobCounts[client.id] ?? 0} jobs</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => openEdit(client)} className="text-xs btn-ghost py-1 px-2">
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  <button onClick={() => toggleActive(client)} className="text-xs text-gray-500 hover:text-gray-700">
                    {client.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editClient ? 'Edit Client' : 'Add Client'}
        footer={
          <>
            <button onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {saving ? 'Saving…' : editClient ? 'Save Changes' : 'Add Client'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
          )}
          <div>
            <label className="label-base">Client Name *</label>
            <input type="text" value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} className="input-base" placeholder="e.g. Acme Shipping Co." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-base">Contact Name</label>
              <input type="text" value={form.contact_name} onChange={(e) => setForm(p => ({ ...p, contact_name: e.target.value }))} className="input-base" />
            </div>
            <div>
              <label className="label-base">Contact Phone</label>
              <input type="tel" value={form.contact_phone} onChange={(e) => setForm(p => ({ ...p, contact_phone: e.target.value }))} className="input-base" />
            </div>
          </div>
          <div>
            <label className="label-base">Contact Email</label>
            <input type="email" value={form.contact_email} onChange={(e) => setForm(p => ({ ...p, contact_email: e.target.value }))} className="input-base" />
          </div>
          <div>
            <label className="label-base">Address</label>
            <textarea value={form.address} onChange={(e) => setForm(p => ({ ...p, address: e.target.value }))} className="input-base resize-none" rows={2} />
          </div>
          <div>
            <label className="label-base">Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))} className="input-base resize-none" rows={2} placeholder="Internal notes about this client" />
          </div>
          <div>
            <label className="label-base">Colour <span className="text-gray-400 font-normal">— used when colouring jobs by client</span></label>
            <ColorSwatchPicker value={form.color || null} onChange={(key) => setForm(p => ({ ...p, color: key ?? '' }))} />
          </div>
          <div>
            <label className="label-base">Logo</label>
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-lg border border-gray-200 bg-white flex items-center justify-center overflow-hidden flex-shrink-0">
                {logoPreview ? (
                  <img src={logoPreview} alt="Client logo" className="h-full w-full object-contain" />
                ) : (
                  <Building2 className="h-7 w-7 text-gray-300" />
                )}
              </div>
              <div className="flex items-center gap-2">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={onLogoSelect} className="hidden" />
                <button type="button" onClick={() => fileRef.current?.click()} className="btn-secondary">
                  <Upload className="h-4 w-4" />{logoPreview ? 'Replace' : 'Upload'}
                </button>
                {logoPreview && (
                  <button type="button" onClick={removeLogo} className="btn-ghost text-red-600">
                    <Trash2 className="h-4 w-4" />Remove
                  </button>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-1">PNG, JPG, SVG or WebP, up to 2 MB.</p>
          </div>
        </div>
      </Modal>
    </div>
  )
}
