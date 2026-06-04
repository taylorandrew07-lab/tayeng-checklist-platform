import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const ADMIN_EMAIL = 'andrew.taylor@tayeng.com'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tayeng-checklist-platform.vercel.app'
const VALID_TYPES = ['signup', 'surveyor_request', 'client_request']

/** Escape user-supplied values before interpolating into the notification HTML. */
function escapeHtml(value: string | undefined): string {
  if (!value) return '—'
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Single-line, header-safe text for email subjects. */
function safeSubject(value: string | undefined): string {
  return (value ?? '').replace(/[\r\n]+/g, ' ').trim()
}

type NotifyPayload = {
  type: 'signup' | 'surveyor_request' | 'client_request'
  name?: string
  email?: string
  role?: string
  requestedName?: string
}

async function sendEmail(subject: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    // Gracefully skip if not configured — admin must set up Resend
    console.log('[notify] RESEND_API_KEY not set, skipping email:', subject)
    return
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Tayeng App <noreply@tayeng.com>',
      to: [ADMIN_EMAIL],
      subject,
      html,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[notify] Resend error:', err)
  }
}

export async function POST(request: Request) {
  // Require an active authenticated session to prevent notification spam
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
      await sendEmail(
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
      await sendEmail(
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
      await sendEmail(
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
