'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Plus, Loader2, Building2, Pencil, Check, X, Upload, Trash2, Search } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import ColorSwatchPicker from '@/components/ui/ColorSwatchPicker'
import { formatDate, withTimeout } from '@/lib/utils'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/components/ui/confirm'
import { listClientBilling, upsertClientBilling } from '@/lib/clients/billing'
import type { Client, ClientBilling } from '@/lib/types/database'

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
  const [billing, setBilling] = useState<Record<string, ClientBilling>>({})
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editClient, setEditClient] = useState<Client | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jobCounts, setJobCounts] = useState<Record<string, number>>({})
  const [q, setQ] = useState('')
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const blankForm = {
    name: '',
    // contact + payment live in client_billing (admin/office only)
    contact_name: '', contact_email: '', contact_phone: '', address: '', notes: '',
    bank_details: '', payment_terms: '', ap_email: '', ap_contact: '', ap_phone: '', tax_number: '',
    logo_path: '',
    color: '' as string,
  }
  const [form, setForm] = useState(blankForm)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    const supabase = createClient()
    // One clients query + one jobs query (tallied in JS) instead of a count
    // query per client.
    const [{ data: c }, { data: jobRows }, billingMap] = await Promise.all([
      supabase.from('clients').select('*').order('name'),
      supabase.from('jobs').select('client_id'),
      listClientBilling(),
    ])
    setClients(c ?? [])
    setBilling(billingMap)
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
    setForm(blankForm)
    setLogoFile(null)
    setLogoPreview(null)
    setError(null)
    setShowModal(true)
  }

  function openEdit(client: Client) {
    setEditClient(client)
    const b = billing[client.id]
    setForm({
      name: client.name,
      contact_name: b?.contact_name ?? '',
      contact_email: b?.contact_email ?? '',
      contact_phone: b?.contact_phone ?? '',
      address: b?.address ?? '',
      notes: b?.notes ?? '',
      bank_details: b?.bank_details ?? '',
      payment_terms: b?.payment_terms ?? '',
      ap_email: b?.ap_email ?? '',
      ap_contact: b?.ap_contact ?? '',
      ap_phone: b?.ap_phone ?? '',
      tax_number: b?.tax_number ?? '',
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

    // The clients table is name-only (+ logo/colour). Contact and payment info go to
    // the private client_billing table (admin/office only).
    const clientPayload = { name: form.name.trim(), logo_path, color: form.color || null }
    const billingPatch = {
      contact_name: form.contact_name || null,
      contact_email: form.contact_email || null,
      contact_phone: form.contact_phone || null,
      address: form.address || null,
      notes: form.notes || null,
      bank_details: form.bank_details || null,
      payment_terms: form.payment_terms || null,
      ap_email: form.ap_email || null,
      ap_contact: form.ap_contact || null,
      ap_phone: form.ap_phone || null,
      tax_number: form.tax_number || null,
    }

    let clientId = editClient?.id
    if (editClient) {
      const { data, error: err } = await supabase.from('clients').update(clientPayload).eq('id', editClient.id).select('id')
      if (err) { setError(err.message); setSaving(false); return }
      if (!data || data.length === 0) { setError('That change was blocked — you may not have permission.'); setSaving(false); return }
    } else {
      const { data, error: err } = await supabase.from('clients').insert(clientPayload).select('id').single()
      if (err) { setError(err.message); setSaving(false); return }
      clientId = data.id
    }

    if (clientId) {
      const bres = await upsertClientBilling(clientId, billingPatch)
      if (bres.error) { setError('Saved the client, but the billing details failed: ' + bres.error); setSaving(false); return }
    }

    setShowModal(false)
    setSaving(false)
    toast.success(editClient ? 'Client updated' : 'Client created')
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
    if (client.is_active && !(await confirmDialog({
      title: 'Deactivate client',
      message: `Deactivate "${client.name}"? They'll be hidden from active lists and new-job pickers. You can reactivate anytime.`,
      danger: true, confirmLabel: 'Deactivate',
    }))) return
    const supabase = createClient()
    const { data, error } = await supabase.from('clients')
      .update({ is_active: !client.is_active }).eq('id', client.id).select('id')
    if (error) { toast.error('Could not update client: ' + error.message); return }
    if (!data || data.length === 0) { toast.error('That change was blocked — you may not have permission.'); return }
    load()
  }

  const filteredClients = useMemo(() => {
    const term = q.trim().toLowerCase()
    return clients.filter(c => {
      if (activeFilter === 'active' && !c.is_active) return false
      if (activeFilter === 'inactive' && c.is_active) return false
      if (!term) return true
      const b = billing[c.id]
      return [c.name, b?.contact_name, b?.contact_email, b?.contact_phone]
        .some(v => (v ?? '').toLowerCase().includes(term))
    })
  }, [clients, billing, q, activeFilter])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Clients"
        subtitle={`${clients.length} clients`}
        actions={<button onClick={openCreate} className="btn-primary"><Plus className="h-4 w-4" />Add Client</button>}
      />

      {clients.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No clients yet"
          description="Add your first client to start assigning jobs."
          action={<button onClick={openCreate} className="btn-primary"><Plus className="h-4 w-4" />Add Client</button>}
        />
      ) : (
        <>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search by name, contact, email or phone…"
              className="input-base pl-9"
            />
          </div>
          <select value={activeFilter} onChange={e => setActiveFilter(e.target.value as typeof activeFilter)} className="input-base sm:w-44">
            <option value="all">All clients</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
        </div>

        {filteredClients.length === 0 ? (
          <div className="card py-12 text-center text-gray-400 text-sm">No clients match your search.</div>
        ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredClients.map(client => (
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
              {billing[client.id]?.contact_name && <p className="text-sm text-gray-600 mt-0.5 truncate">{billing[client.id].contact_name}</p>}
              {billing[client.id]?.contact_email && <p className="text-sm text-gray-500 truncate">{billing[client.id].contact_email}</p>}
              {billing[client.id]?.contact_phone && <p className="text-sm text-gray-500 truncate">{billing[client.id].contact_phone}</p>}

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
        </>
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

          {/* Payment / billing — private (admin + office only; never shown to surveyors) */}
          <div className="pt-2 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500 mb-2">Payment &amp; billing <span className="font-normal text-gray-400">— private; surveyors never see this</span></p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-base">Payment terms</label>
                  <input type="text" value={form.payment_terms} onChange={(e) => setForm(p => ({ ...p, payment_terms: e.target.value }))} className="input-base" placeholder="e.g. 30 days" />
                </div>
                <div>
                  <label className="label-base">Tax / BRC / VAT no.</label>
                  <input type="text" value={form.tax_number} onChange={(e) => setForm(p => ({ ...p, tax_number: e.target.value }))} className="input-base" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-base">Accounts-payable email</label>
                  <input type="email" value={form.ap_email} onChange={(e) => setForm(p => ({ ...p, ap_email: e.target.value }))} className="input-base" placeholder="invoices@client.com" />
                </div>
                <div>
                  <label className="label-base">AP contact name</label>
                  <input type="text" value={form.ap_contact} onChange={(e) => setForm(p => ({ ...p, ap_contact: e.target.value }))} className="input-base" placeholder="Name" />
                </div>
              </div>
              <div>
                <label className="label-base">AP phone</label>
                <input type="tel" value={form.ap_phone} onChange={(e) => setForm(p => ({ ...p, ap_phone: e.target.value }))} className="input-base" />
              </div>
              <div>
                <label className="label-base">Bank / payment details</label>
                <textarea value={form.bank_details} onChange={(e) => setForm(p => ({ ...p, bank_details: e.target.value }))} className="input-base resize-y text-sm" rows={3} placeholder="Bank name, account, SWIFT…" />
              </div>
            </div>
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
