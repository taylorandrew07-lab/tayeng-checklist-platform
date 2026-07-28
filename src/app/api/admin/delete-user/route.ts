import { NextResponse } from 'next/server'
import { createServiceClient, createClient } from '@/lib/supabase/server'

// Delete a user completely — the auth.users row AND its profile.
//
// Rejecting an account used to delete only the `profiles` row. That left an orphaned
// auth.users record: the person could still authenticate, but had no profile, so the
// app bounced them with no explanation and no admin could see them anywhere in the
// UI to fix it. Worse, their email address stayed taken, so re-registering failed.
// Deleting the auth user cascades the profile away, so this is the whole job.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: actor } = await supabase
    .from('profiles')
    .select('role, is_super_admin, is_active')
    .eq('id', user.id)
    .single()

  if (actor?.role !== 'admin' || actor.is_active !== true) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { user_id } = await request.json()
  if (!user_id) return NextResponse.json({ error: 'Missing user_id' }, { status: 400 })
  if (user_id === user.id) {
    return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 })
  }

  const serviceClient = createServiceClient()

  const { data: target } = await serviceClient
    .from('profiles')
    .select('id, role, is_super_admin')
    .eq('id', user_id)
    .single()

  if (target && (target.role === 'admin' || target.is_super_admin) && !actor.is_super_admin) {
    return NextResponse.json(
      { error: 'Only the Super Admin can delete an Admin account.' },
      { status: 403 }
    )
  }

  const { error } = await serviceClient.auth.admin.deleteUser(user_id)
  if (error) {
    console.error('[delete-user]', error)
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  // Belt and braces: if the profiles FK isn't ON DELETE CASCADE, clear it explicitly
  // so we can never leave the mirror-image orphan (profile with no auth user).
  await serviceClient.from('profiles').delete().eq('id', user_id)

  return NextResponse.json({ ok: true })
}
