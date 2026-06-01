import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const ADMIN_EMAIL = 'andrew.taylor@tayeng.com'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tayeng-checklist-platform.vercel.app'

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
      from: 'TEAL Platform <noreply@tayeng.com>',
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
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const payload: NotifyPayload = await request.json()
  const { type, name, email, role, requestedName } = payload

  const reviewUrl = `${APP_URL}/admin/users`

  switch (type) {
    case 'signup': {
      await sendEmail(
        `New account request — ${name ?? email}`,
        `
          <p>A new user has requested an account on the TEAL Checklist Platform.</p>
          <ul>
            <li><strong>Name:</strong> ${name ?? '—'}</li>
            <li><strong>Email:</strong> ${email ?? '—'}</li>
            <li><strong>Requested role:</strong> ${role ?? '—'}</li>
          </ul>
          <p><a href="${reviewUrl}">Review pending accounts →</a></p>
        `
      )
      break
    }
    case 'surveyor_request': {
      await sendEmail(
        `New surveyor name request — ${requestedName}`,
        `
          <p>A surveyor has requested a new surveyor name to be added to the system.</p>
          <ul>
            <li><strong>Requested by:</strong> ${name ?? '—'} (${email ?? '—'})</li>
            <li><strong>Surveyor name:</strong> ${requestedName ?? '—'}</li>
          </ul>
          <p><a href="${reviewUrl}">Review pending requests →</a></p>
        `
      )
      break
    }
    case 'client_request': {
      await sendEmail(
        `New client company request — ${requestedName}`,
        `
          <p>A surveyor has requested a new client company to be added to the system.</p>
          <ul>
            <li><strong>Requested by:</strong> ${name ?? '—'} (${email ?? '—'})</li>
            <li><strong>Client name:</strong> ${requestedName ?? '—'}</li>
          </ul>
          <p><a href="${reviewUrl}">Review pending requests →</a></p>
        `
      )
      break
    }
  }

  return NextResponse.json({ ok: true })
}
