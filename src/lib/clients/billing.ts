// Private client contact + payment info (admin/office only — RLS enforced by the
// client_billing table). Surveyors can't read this at all; they only ever see
// client names from the clients table.

import { createClient } from '@/lib/supabase/client'
import type { ClientBilling } from '@/lib/types/database'

export type ClientBillingPatch = Partial<Omit<ClientBilling, 'client_id' | 'created_at' | 'updated_at'>>

export async function getClientBilling(clientId: string): Promise<ClientBilling | null> {
  const { data } = await createClient().from('client_billing').select('*').eq('client_id', clientId).maybeSingle()
  return (data as ClientBilling) ?? null
}

/** All billing rows keyed by client_id — for the clients list (admin view). Returns
 *  an empty map for callers without access (RLS simply yields no rows). */
export async function listClientBilling(): Promise<Record<string, ClientBilling>> {
  const { data } = await createClient().from('client_billing').select('*')
  const map: Record<string, ClientBilling> = {}
  for (const r of (data ?? []) as ClientBilling[]) map[r.client_id] = r
  return map
}

export async function upsertClientBilling(clientId: string, patch: ClientBillingPatch): Promise<{ error?: string }> {
  const { error } = await createClient()
    .from('client_billing')
    .upsert({ client_id: clientId, ...patch }, { onConflict: 'client_id' })
  return { error: error?.message }
}
