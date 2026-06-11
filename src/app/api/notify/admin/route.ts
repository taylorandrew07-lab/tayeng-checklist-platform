import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendEmail, escapeHtml, safeSubject } from '@/lib/email/send'

const ADMIN_EMAIL = 'andrew.taylor@tayeng.com'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tayeng-checklist-platform.vercel.app'
const VALID_TYPES = ['signup', 'surveyor_request', 'client_request']

type NotifyPayload = {
  type: 'signup' | 'surveyor_request' | 'client_request'
  name?: string
  email?: string
  role?: string
  requestedName?: string
}

// Best-effort per-user rate limit (in-memory; resets on cold start). Caps
// notification spam to the admin inbox without an external store.
const RL_WINDOW_MS = 10 * 60 * 1000
const RL_MAX = 8
const rlMap = new Map<string, { count: number; resetAt: number }>()
function rateLimited(key: string): boolean {
  const now = Date.now()
  const e = rlMap.get(key)
  if (!e || now > e.resetAt) { rlMap.set(key, { count: 1, resetAt: now + RL_WINDOW_MS }); return false }
  if (e.count >= RL_MAX) return true
  e.count++
  return false
}

/** Email the single configured admin recipient. */
function notifyAdmin(subject: string, html: string) {
  return sendEmail({ to: [ADMIN_EMAIL], subject, html })
}

export async function POST(request: Request) {
  // Require an active authenticated session to prevent notification spam
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (rateLimited(user.id)) {
    return NextResponse.json({ error: 'Too many requests — please try again shortly.' }, { status: 429 })
  }

  const payload: NotifyPayload = await request.json()
  const { type, name, email, role, requestedName } = payload

  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Invalid notification type' }, { status: 400 })
  }

  // 'signup' is sent by a just-created (still inactive) user, so it only needs a
  // valid session. Request notifications must come from an active surveyor/admin.
  if (type === 'surveyor_request' || type === 'client_request') {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, is_active')
      .eq('id', user.id)
      .single()
    if (!profile?.is_active || !['surveyor', 'admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // Escape all user-supplied values before placing them in the email HTML.
  const safeName = escapeHtml(name)
  const safeEmail = escapeHtml(email)
  const safeRole = escapeHtml(role)
  const safeRequested = escapeHtml(requestedName)
  const reviewUrl = `${APP_URL}/admin/users`

  switch (type) {
    case 'signup': {
      await notifyAdmin(
        safeSubject(`New account request — ${name ?? email ?? ''}`),
        `
          <p>A new user has requested an account on the Tayeng App.</p>
          <ul>
            <li><strong>Name:</strong> ${safeName}</li>
            <li><strong>Email:</strong> ${safeEmail}</li>
            <li><strong>Requested role:</strong> ${safeRole}</li>
          </ul>
          <p><a href="${reviewUrl}">Review pending accounts →</a></p>
        `
      )
      break
    }
    case 'surveyor_request': {
      await notifyAdmin(
        safeSubject(`New surveyor name request — ${requestedName ?? ''}`),
        `
          <p>A surveyor has requested a new surveyor name to be added to the system.</p>
          <ul>
            <li><strong>Requested by:</strong> ${safeName} (${safeEmail})</li>
            <li><strong>Surveyor name:</strong> ${safeRequested}</li>
          </ul>
          <p><a href="${reviewUrl}">Review pending requests →</a></p>
        `
      )
      break
    }
    case 'client_request': {
      await notifyAdmin(
        safeSubject(`New client company request — ${requestedName ?? ''}`),
        `
          <p>A surveyor has requested a new client company to be added to the system.</p>
          <ul>
            <li><strong>Requested by:</strong> ${safeName} (${safeEmail})</li>
            <li><strong>Client name:</strong> ${safeRequested}</li>
          </ul>
          <p><a href="${reviewUrl}">Review pending requests →</a></p>
        `
      )
      break
    }
  }

  return NextResponse.json({ ok: true })
}
