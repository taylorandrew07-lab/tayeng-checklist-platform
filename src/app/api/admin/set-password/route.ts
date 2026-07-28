import { NextResponse } from 'next/server'
import { createServiceClient, createClient } from '@/lib/supabase/server'

// Set a user's password directly, without any email round trip.
//
// The only recovery path used to be "Forgot password?", which depends on email
// delivery. This project uses Supabase's built-in mailer (a couple of messages per
// hour project-wide, and unreliable to external domains like hotmail.com), so a
// locked-out user could be stuck indefinitely with no way back in. An admin can now
// set a password and pass it on directly.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: actor } = await supabase
    .from('profiles')
    .select('role, is_super_admin, is_active')
    .eq('id', user.id)
    .single()

  // Must be an *active* admin — a deactivated admin's session must not reach the
  // service role.
  if (actor?.role !== 'admin' || actor.is_active !== true) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { user_id, password } = await request.json()
  if (!user_id || !password) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  if (typeof password !== 'string' || password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  const serviceClient = createServiceClient()

  const { data: target, error: targetErr } = await serviceClient
    .from('profiles')
    .select('id, role, is_super_admin, full_name')
    .eq('id', user_id)
    .single()

  if (targetErr || !target) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Setting the password of an admin (or the Super Admin) is an account takeover
  // primitive — restrict it to the Super Admin, mirroring create-user's rule.
  if ((target.role === 'admin' || target.is_super_admin) && !actor.is_super_admin) {
    return NextResponse.json(
      { error: 'Only the Super Admin can set the password of an Admin account.' },
      { status: 403 }
    )
  }

  const { error } = await serviceClient.auth.admin.updateUserById(user_id, {
    password,
    // A user whose email was never confirmed cannot sign in at all. An admin setting
    // the password by hand is a stronger identity check than a mailed link, so clear
    // that blocker at the same time.
    email_confirm: true,
  })

  if (error) {
    console.error('[set-password]', error)
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
