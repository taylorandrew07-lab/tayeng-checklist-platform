import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { sendEmail, escapeHtml, safeSubject } from '@/lib/email/send'
import type { UserRole } from '@/lib/types/database'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tayeng-checklist-platform.vercel.app'
const VALID_ROLES: UserRole[] = ['admin', 'surveyor', 'client', 'office']

// Best-effort per-sender rate limit (in-memory; resets on cold start) — mirrors
// /api/notify/admin. Caps message-send spam without an external store.
const RL_WINDOW_MS = 10 * 60 * 1000
const RL_MAX = 20
const rlMap = new Map<string, { count: number; resetAt: number }>()
function rateLimited(key: string): boolean {
  const now = Date.now()
  const e = rlMap.get(key)
  if (!e || now > e.resetAt) { rlMap.set(key, { count: 1, resetAt: now + RL_WINDOW_MS }); return false }
  if (e.count >= RL_MAX) return true
  e.count++
  return false
}

interface SendBody {
  subject?: string
  body?: string
  recipientIds?: string[]
  recipientRoles?: UserRole[]
  parentId?: string
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (rateLimited(user.id)) {
    return NextResponse.json({ error: 'Too many messages — please try again shortly.' }, { status: 429 })
  }

  const { data: me } = await supabase.from('profiles').select('role, is_super_admin, is_active, full_name').eq('id', user.id).single()
  if (!me?.is_active) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const isAdmin = me.role === 'admin' || me.is_super_admin === true

  const payload: SendBody = await request.json().catch(() => ({}))
  const subject = (payload.subject ?? '').toString().trim()
  const body = (payload.body ?? '').toString().trim()
  const parentId = payload.parentId?.toString() || null
  if (!subject) return NextResponse.json({ error: 'Subject is required.' }, { status: 400 })
  if (!body) return NextResponse.json({ error: 'Message body is required.' }, { status: 400 })

  const db = createServiceClient()

  // Resolve the recipient set, scoped by the sender's authority.
  const recipients = new Map<string, string | null>() // id -> email
  const explicitIds = new Set<string>()

  if (isAdmin) {
    const roles = (payload.recipientRoles ?? []).filter(r => VALID_ROLES.includes(r))
    const ids = (payload.recipientIds ?? []).filter(Boolean)
    ids.forEach(id => explicitIds.add(id))
    if (roles.length) {
      const { data } = await db.from('profiles').select('id, email').in('role', roles).eq('is_active', true)
      for (const p of data ?? []) recipients.set(p.id, p.email)
    }
    if (ids.length) {
      const { data } = await db.from('profiles').select('id, email').in('id', ids).eq('is_active', true)
      for (const p of data ?? []) recipients.set(p.id, p.email)
    }
  } else {
    // Non-admins can only message the administrators (anti-spam).
    const { data } = await db.from('profiles').select('id, email')
      .or('role.eq.admin,is_super_admin.eq.true').eq('is_active', true)
    for (const p of data ?? []) recipients.set(p.id, p.email)
  }

  // Exclude the sender unless they explicitly addressed themselves.
  if (!explicitIds.has(user.id)) recipients.delete(user.id)

  if (recipients.size === 0) {
    return NextResponse.json({ error: 'No valid recipients.' }, { status: 400 })
  }

  // Insert the message, then fan out recipient rows; roll back the message if the
  // recipient insert fails so we never leave an orphan.
  const { data: msg, error: msgErr } = await db.from('messages')
    .insert({ sender_id: user.id, subject, body, parent_id: parentId })
    .select('id').single()
  if (msgErr || !msg) return NextResponse.json({ error: msgErr?.message ?? 'Could not create message.' }, { status: 400 })

  const rows = Array.from(recipients.keys()).map(rid => ({ message_id: msg.id, recipient_id: rid }))
  const { error: recErr } = await db.from('message_recipients').insert(rows)
  if (recErr) {
    await db.from('messages').delete().eq('id', msg.id)
    return NextResponse.json({ error: recErr.message }, { status: 400 })
  }

  // Best-effort email notification (skipped automatically if RESEND_API_KEY unset).
  // Send one email PER recipient so staff/client addresses are never disclosed
  // to each other (no shared to/cc array).
  try {
    const emails = Array.from(recipients.values()).filter((e): e is string => !!e)
    const html = `
          <p>You have a new message on the Tayeng App from <strong>${escapeHtml(me.full_name)}</strong>:</p>
          <p style="font-weight:600">${escapeHtml(subject)}</p>
          <p style="white-space:pre-wrap">${escapeHtml(body)}</p>
          <p><a href="${APP_URL}/inbox">Open your inbox →</a></p>
        `
    for (const email of emails) {
      await sendEmail({ to: [email], subject: safeSubject(`New message: ${subject}`), html })
    }
  } catch { /* non-blocking */ }

  return NextResponse.json({ ok: true, messageId: msg.id, recipients: rows.length })
}
