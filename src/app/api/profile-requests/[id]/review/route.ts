import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// Only these profile fields can be requested/applied via this flow.
const ALLOWED_FIELDS = ['full_name', 'phone', 'email'] as const

/**
 * Approve or reject a profile change request. Admin-only. The apply runs with the
 * service role so a client never writes another user's profile. Email changes also
 * update Supabase Auth via the Admin API — the admin's approval stands in for the
 * user's self-service email-confirmation step.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await supabase.from('profiles').select('role, is_super_admin, is_active').eq('id', user.id).single()
  const isAdmin = (me?.role === 'admin' || me?.is_super_admin === true) && me?.is_active === true
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const action = body?.action as 'approve' | 'reject'
  const comment: string | null = (body?.comment ?? '').toString().trim() || null
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const db = createServiceClient()

  const { data: req } = await db.from('profile_change_requests').select('*').eq('id', id).single()
  if (!req) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  if (req.status !== 'pending') return NextResponse.json({ error: 'This request has already been reviewed.' }, { status: 409 })

  if (action === 'approve') {
    // Whitelist + drop no-op changes.
    const changes: Record<string, any> = {}
    for (const f of ALLOWED_FIELDS) {
      if (f in (req.requested_changes ?? {})) changes[f] = req.requested_changes[f]
    }

    // Email is special: it must also change the auth login email.
    if (typeof changes.email === 'string' && changes.email && changes.email !== req.current_values?.email) {
      const { error: authErr } = await db.auth.admin.updateUserById(req.user_id, { email: changes.email, email_confirm: true })
      if (authErr) return NextResponse.json({ error: `Could not update login email: ${authErr.message}` }, { status: 400 })
    }

    if (Object.keys(changes).length > 0) {
      const { error: profErr } = await db.from('profiles').update(changes).eq('id', req.user_id)
      if (profErr) return NextResponse.json({ error: `Could not apply changes: ${profErr.message}` }, { status: 400 })
    }
  }

  const { error: updErr } = await db.from('profile_change_requests').update({
    status: action === 'approve' ? 'approved' : 'rejected',
    reviewer_id: user.id,
    review_comment: comment,
    reviewed_at: new Date().toISOString(),
  }).eq('id', id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 })

  return NextResponse.json({ ok: true })
}
