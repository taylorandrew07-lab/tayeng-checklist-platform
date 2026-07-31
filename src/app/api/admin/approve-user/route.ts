import { NextResponse } from 'next/server'
import { createServiceClient, createClient } from '@/lib/supabase/server'

const ALLOWED_ROLES = ['admin', 'surveyor', 'client', 'office']

// Approve a pending self-signup account.
//
// This used to be three plain browser-client writes to `profiles` (role, client_users,
// is_active) and nothing else — which meant approval never touched Supabase Auth. A
// user who signed themselves up has `auth.users.email_confirmed_at = NULL` until they
// click a mailed confirmation link, and `signInWithPassword` refuses them with
// `email_not_confirmed` no matter how many times an admin "activates" them. Since auth
// mail runs on Supabase's built-in mailer (a couple per hour project-wide, unreliable
// to external domains, and its single-use GET token gets burned by Gmail's link
// scanner), that link routinely never lands — leaving an approved, active, permanently
// unloginable account and an admin with no way to tell.
//
// An admin approving a named person by hand is a stronger identity check than a mailed
// link, so approval now confirms the email too — the same reasoning already applied to
// set-password. That also makes this the single server-side place where "approved"
// means "can actually sign in".
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

  const { user_id, role, client_id } = await request.json()
  if (!user_id || !role) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  if (!ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }
  if (role === 'client' && !client_id) {
    return NextResponse.json({ error: 'Please select the client this user belongs to.' }, { status: 400 })
  }

  // Granting the Admin role is a privilege escalation — Super Admin only, mirroring
  // create-user.
  if (role === 'admin' && !actor.is_super_admin) {
    return NextResponse.json(
      { error: 'Only the Super Admin can approve an account as Admin.' },
      { status: 403 }
    )
  }

  const serviceClient = createServiceClient()

  const { data: target, error: targetErr } = await serviceClient
    .from('profiles')
    .select('id, role, is_super_admin, full_name, email')
    .eq('id', user_id)
    .single()

  if (targetErr || !target) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // The service role bypasses RLS, so the rule that migration 032 enforced in the
  // database — a plain admin may not modify an admin/super-admin row — has to be
  // restated here or this route would quietly widen it.
  if ((target.role === 'admin' || target.is_super_admin) && !actor.is_super_admin) {
    return NextResponse.json(
      { error: 'Only the Super Admin can approve an Admin account.' },
      { status: 403 }
    )
  }

  // Confirm the auth email FIRST. If this fails the account cannot sign in, so
  // activating the profile anyway would recreate exactly the bug this route exists to
  // fix: an account that looks approved everywhere in the admin UI and is rejected at
  // the login screen.
  const { error: confirmErr } = await serviceClient.auth.admin.updateUserById(user_id, {
    email_confirm: true,
  })

  if (confirmErr) {
    console.error('[approve-user:confirm]', confirmErr)
    return NextResponse.json(
      {
        error:
          `Could not confirm the sign-in account for ${target.full_name}: ${confirmErr.message}. ` +
          `Their profile has NOT been activated. If their login account is missing, delete this ` +
          `request and add them with "Add member" instead.`,
      },
      { status: 400 }
    )
  }

  const { data: updated, error: profileErr } = await serviceClient
    .from('profiles')
    .update({ role, is_active: true })
    .eq('id', user_id)
    .select('id')

  if (profileErr || !updated || updated.length === 0) {
    console.error('[approve-user:activate]', profileErr)
    return NextResponse.json(
      { error: profileErr?.message ?? 'Could not activate that account.' },
      { status: 400 }
    )
  }

  if (role === 'client' && client_id) {
    const { error: linkErr } = await serviceClient.from('client_users').upsert(
      { profile_id: user_id, client_id },
      { onConflict: 'profile_id,client_id' }
    )
    if (linkErr) {
      console.error('[approve-user:client-link]', linkErr)
      // The account is live and can sign in; only the client link failed. Say so
      // precisely rather than implying the whole approval failed.
      return NextResponse.json(
        { error: `Account approved, but linking it to that client failed: ${linkErr.message}` },
        { status: 400 }
      )
    }
  }

  return NextResponse.json({ ok: true })
}
