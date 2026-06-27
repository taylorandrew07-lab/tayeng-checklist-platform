// Shared transactional email via Resend. Used by /api/notify/admin and the
// document-reminder cron. If RESEND_API_KEY is unset, sends are skipped (logged),
// so the app still works in environments without email configured.

import { escapeHtml as escapeHtmlRaw } from '@/lib/escape-html'

const FROM = 'Tayeng App <noreply@tayeng.com>'

/** Escape user-supplied values before interpolating into notification HTML,
 *  mapping null/empty to an em-dash. Delegates the actual escaping to the
 *  canonical escapeHtml so the HTML-injection defence stays in one place. */
export function escapeHtml(value: string | undefined | null): string {
  if (!value) return '—'
  return escapeHtmlRaw(value)
}

/** Single-line, header-safe text for email subjects. */
export function safeSubject(value: string | undefined | null): string {
  return (value ?? '').replace(/[\r\n]+/g, ' ').trim()
}

/** Returns true only when the email was actually accepted by Resend (2xx).
 *  Returns false when skipped (no API key / no recipients) or on any failure —
 *  callers that gate state on delivery (e.g. the reminder cron) must check this. */
export async function sendEmail({ to, subject, html }: { to: string[]; subject: string; html: string }): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  const recipients = Array.from(new Set(to.filter(Boolean)))
  if (!recipients.length) return false
  if (!apiKey) {
    console.log('[email] RESEND_API_KEY not set, skipping:', safeSubject(subject), '→', recipients.join(', '))
    return false
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: recipients, subject: safeSubject(subject), html }),
    })
    if (!res.ok) {
      console.error('[email] Resend error:', await res.text().catch(() => res.status))
      return false
    }
    return true
  } catch (err) {
    console.error('[email] send failed:', err)
    return false
  }
}
