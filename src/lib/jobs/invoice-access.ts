// Server-side authorization for invoice routes: admins always; office staff
// only when they hold the invoicing.view permission. Pass adminOnly for actions
// (e.g. creating an email draft) that office should not perform.

import { createClient } from '@/lib/supabase/server'

export async function assertInvoicingAccess(opts?: { adminOnly?: boolean }): Promise<
  { ok: true; userId: string; role: string } | { ok: false; status: number; error: string }
> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, status: 401, error: 'Unauthorized' }

  const { data: profile } = await supabase.from('profiles').select('role, is_active').eq('id', user.id).single()
  if (!profile || profile.is_active !== true) return { ok: false, status: 403, error: 'Forbidden' }

  if (profile.role === 'admin') return { ok: true, userId: user.id, role: 'admin' }

  if (!opts?.adminOnly && profile.role === 'office') {
    const { data: perm } = await supabase
      .from('office_user_permissions')
      .select('permission_key')
      .eq('profile_id', user.id).eq('permission_key', 'invoicing.view').eq('allowed', true)
      .maybeSingle()
    if (perm) return { ok: true, userId: user.id, role: 'office' }
  }

  return { ok: false, status: 403, error: 'Forbidden' }
}
