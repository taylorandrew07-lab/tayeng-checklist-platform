import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, is_super_admin, is_active').eq('id', user.id).single()
  // Must be an *active* admin — a deactivated admin's session must not reach the service role.
  if (profile?.role !== 'admin' || profile.is_active !== true) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { email, password, full_name, role, phone } = await request.json()

  if (!email || !password || !full_name || !role) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Validate the requested role server-side; never trust the client payload.
  const ALLOWED_ROLES = ['admin', 'surveyor', 'client', 'office']
  if (!ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  if (role === 'admin' && !profile.is_super_admin) {
    return NextResponse.json({ error: 'Only the Super Admin can create Admin accounts.' }, { status: 403 })
  }

  const serviceClient = createServiceClient()

  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, role },
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  if (data.user) {
    // handle_new_user trigger creates the profile with is_active=false.
    // Admin-created users are pre-approved — activate immediately and set phone.
    const { error: profileErr } = await serviceClient.from('profiles').update({
      is_active: true,
      phone: phone || null,
    }).eq('id', data.user.id)

    if (profileErr) {
      // Roll back the auth user so we don't leave a half-initialised, inactive
      // account that the admin believes was created successfully.
      console.error('[create-user:activate]', profileErr)
      await serviceClient.auth.admin.deleteUser(data.user.id)
      return NextResponse.json(
        { error: 'Account was created but could not be activated; it has been rolled back. Please try again.' },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({ user_id: data.user?.id }, { status: 201 })
}
