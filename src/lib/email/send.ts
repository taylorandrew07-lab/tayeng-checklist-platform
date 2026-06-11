// Shared transactional email via Resend. Used by /api/notify/admin and the
// document-reminder cron. If RESEND_API_KEY is unset, sends are skipped (logged),
// so the app still works in environments without email configured.

const FROM = 'Tayeng App <noreply@tayeng.com>'

/** Escape user-supplied values before interpolating into notification HTML. */
export function escapeHtml(value: string | undefined | null): string {
  if (!value) return '—'
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Single-line, header-safe text for email subjects. */
export function safeSubject(value: string | undefined | null): string {
  return (value ?? '').replace(/[\r\n]+/g, ' ').trim()
}

export async function sendEmail({ to, subject, html }: { to: string[]; subject: string; html: string }): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const recipients = Array.from(new Set(to.filter(Boolean)))
  if (!recipients.length) return
  if (!apiKey) {
    console.log('[email] RESEND_API_KEY not set, skipping:', safeSubject(subject), '→', recipients.join(', '))
    return
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: recipients, subject: safeSubject(subject), html }),
  })
  if (!res.ok) {
    console.error('[email] Resend error:', await res.text().catch(() => res.status))
  }
}
