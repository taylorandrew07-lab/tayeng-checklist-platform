import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendEmail, escapeHtml } from '@/lib/email/send'
import { expiryStatus } from '@/lib/personal-docs/api'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tayeng-checklist-platform.vercel.app'

/**
 * Daily document-expiry reminder digest. Secured by CRON_SECRET (Vercel Cron sends
 * `Authorization: Bearer <secret>`). Emails each surveyor about their own
 * soon-to-expire documents, and sends all active admins + opted-in office users a
 * digest of everyone's. Re-sends at most weekly per document (last_reminded_at).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceClient()
  const now = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const horizon = new Date(now); horizon.setDate(horizon.getDate() + 120)   // widest lead we support
  const recentlyExpired = new Date(now); recentlyExpired.setDate(recentlyExpired.getDate() - 7)
  const weekAgoIso = new Date(now.getTime() - 7 * 86400_000).toISOString()

  // Candidate docs: have an expiry in the window, not reminded in the last week.
  const { data: docs, error } = await db
    .from('personal_documents')
    .select('id, doc_name, doc_type, expiry_date, reminder_lead_days, profile_id, owner:profiles!personal_documents_profile_id_fkey(email, full_name)')
    .not('expiry_date', 'is', null)
    .gte('expiry_date', iso(recentlyExpired))
    .lte('expiry_date', iso(horizon))
    .or(`last_reminded_at.is.null,last_reminded_at.lt.${weekAgoIso}`)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Keep only docs actually within their per-row reminder lead (or just expired).
  const due = (docs ?? [])
    .map((d: any) => {
      const { status, days } = expiryStatus(d.expiry_date, d.reminder_lead_days)
      return { ...d, status, days, ownerEmail: d.owner?.email as string | undefined, ownerName: d.owner?.full_name as string | undefined }
    })
    .filter(d => d.status === 'expired' || d.status === 'expiring')

  if (due.length === 0) return NextResponse.json({ ok: true, due: 0 })

  // Staff recipients: active admins/super-admins + opted-in active office users.
  const { data: admins } = await db.from('profiles').select('email')
    .or('role.eq.admin,is_super_admin.eq.true').eq('is_active', true)
  const { data: officeOpt } = await db.from('office_user_permissions')
    .select('profile:profiles!office_user_permissions_profile_id_fkey(email, is_active, role)')
    .eq('permission_key', 'personal_docs.expiry.notify').eq('allowed', true)
  const staffEmails = new Set<string>()
  for (const a of admins ?? []) if (a.email) staffEmails.add(a.email)
  for (const o of officeOpt ?? []) {
    const p: any = (o as any).profile
    if (p?.is_active && p?.role === 'office' && p.email) staffEmails.add(p.email)
  }

  const line = (d: any) =>
    `<li><strong>${escapeHtml(d.doc_name)}</strong>${d.doc_type ? ` (${escapeHtml(d.doc_type)})` : ''} — ${escapeHtml(d.ownerName)} — expires <strong>${escapeHtml(d.expiry_date)}</strong> (${d.days < 0 ? `${Math.abs(d.days)} day(s) ago` : `in ${d.days} day(s)`})</li>`

  // Owner digests (skip owners who are also staff — they get the full digest).
  const byOwner = new Map<string, any[]>()
  for (const d of due) if (d.ownerEmail && !staffEmails.has(d.ownerEmail)) {
    byOwner.set(d.ownerEmail, [...(byOwner.get(d.ownerEmail) ?? []), d])
  }
  // Only mark a document reminded when its notification ACTUALLY sent, so a
  // missing API key or a delivery failure doesn't silently suppress retries.
  const reminded = new Set<string>()
  for (const [email, list] of byOwner) {
    const ok = await sendEmail({
      to: [email],
      subject: `Your documents are expiring — ${list.length} to review`,
      html: `<p>The following documents on your Taylor Engineering profile are expiring soon:</p><ul>${list.map(line).join('')}</ul><p><a href="${APP_URL}/profile">Update your documents →</a></p>`,
    })
    if (ok) list.forEach((d: any) => reminded.add(d.id))
  }

  // Staff digest: everyone's due docs.
  let staffSent = false
  for (const email of staffEmails) {
    const ok = await sendEmail({
      to: [email],
      subject: `Surveyor documents expiring — ${due.length} across the team`,
      html: `<p>The following surveyor documents are expiring soon:</p><ul>${due.map(line).join('')}</ul><p><a href="${APP_URL}/admin">Open the dashboard →</a></p>`,
    })
    if (ok) staffSent = true
  }
  // Staff-owned docs are notified via the staff digest, not an owner digest.
  if (staffSent) for (const d of due) if (d.ownerEmail && staffEmails.has(d.ownerEmail)) reminded.add(d.id)

  if (reminded.size) {
    await db.from('personal_documents').update({ last_reminded_at: now.toISOString() }).in('id', [...reminded])
  }

  return NextResponse.json({ ok: true, due: due.length, reminded: reminded.size, owners: byOwner.size, staff: staffEmails.size })
}
