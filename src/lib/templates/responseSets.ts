// Reusable response sets ("Global Response Sets"): named lists of choice options the
// template builder can apply to a field (or save from one). Options are COPIED into
// the field, so editing/deleting a set never breaks an existing template. See mig 096.
import { createClient } from '@/lib/supabase/client'
import type { FieldOption } from '@/lib/types/database'

export interface ResponseSet {
  id: string
  name: string
  options: FieldOption[]
  created_at: string
}

export async function listResponseSets(): Promise<ResponseSet[]> {
  const { data } = await createClient()
    .from('response_sets').select('id, name, options, created_at').order('name')
  return (data ?? []) as ResponseSet[]
}

export async function createResponseSet(name: string, options: FieldOption[]): Promise<{ error?: string; set?: ResponseSet }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('response_sets')
    .insert({ name, options, created_by: user?.id ?? null })
    .select('id, name, options, created_at').single()
  if (error) return { error: error.message }
  return { set: data as ResponseSet }
}

export async function deleteResponseSet(id: string): Promise<{ error?: string }> {
  const { error } = await createClient().from('response_sets').delete().eq('id', id)
  return { error: error?.message }
}
