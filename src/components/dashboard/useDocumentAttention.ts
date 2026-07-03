'use client'

import { useEffect, useState } from 'react'
import { FileWarning } from 'lucide-react'
import { useRealtimeRefresh } from '@/lib/realtime'
import { listExpiring } from '@/lib/personal-docs/api'
import type { AttentionItem } from './AttentionCard'

type Context = 'self' | 'admin' | 'office'

function hrefFor(context: Context, profileId: string): string {
  if (context === 'self') return '/profile'
  if (context === 'admin') return `/admin/users/${profileId}/documents`
  // Office expiry alerts land on the canonical Credentials page (/personnel),
  // which shows the same data as a filterable matrix with downloads + CSV.
  return '/personnel'
}

/**
 * Expired / soon-to-expire personal documents as AttentionCard items. Live via
 * useRealtimeRefresh('personal_documents'). RLS decides what each caller sees:
 *  - 'self'  → that surveyor's own (pass profileId)
 *  - 'admin' → everyone's (admin-wide; omit profileId)
 *  - 'office'→ everyone's, only if the office user holds personal_docs.view
 * `enabled = false` short-circuits (e.g. office without the permission).
 */
export function useDocumentAttention({ context, profileId, enabled = true }: {
  context: Context; profileId?: string; enabled?: boolean
}): AttentionItem[] {
  const [items, setItems] = useState<AttentionItem[]>([])
  const tick = useRealtimeRefresh('personal_documents')

  useEffect(() => {
    let cancelled = false
    if (!enabled) { setItems([]); return }
    async function load() {
      const docs = await listExpiring(profileId).catch(() => [])
      if (cancelled) return
      setItems(docs.map(d => ({
        icon: FileWarning,
        label: context === 'self' || !d.owner_name ? d.doc_name : `${d.doc_name} — ${d.owner_name}`,
        detail: d.status === 'expired'
          ? `Expired ${Math.abs(d.days ?? 0)} day(s) ago`
          : `Expires in ${d.days} day(s)`,
        href: hrefFor(context, d.profile_id),
        tone: d.status === 'expired' ? 'danger' : 'warn',
      })))
    }
    load()
    return () => { cancelled = true }
  }, [context, profileId, enabled, tick])

  return items
}
