import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { isReminderDue } from '@/lib/jobs/reminderWindow'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tayeng-checklist-platform.vercel.app'

/** Never cache or statically evaluate a cron endpoint. */
export const dynamic = 'force-dynamic'

/** Ignore anything that came due more than this long ago. Belt-and-braces against a
 *  bulk backfill or a long outage dumping a wall of ancient jobs into the inbox. */
const STALE_DAYS = 30

/**
 * "Report due" reminders. A job is armed by giving it reminder_hours (seeded from
 * its job type); migration 162's trigger derives reminder_due_at from whichever
 * comes first — the job being marked complete, or 17:00 on its end date.
 *
 * This route finds the armed jobs whose delay has expired AND whose office-hours
 * window has opened (lib/jobs/reminderWindow.ts — Mon–Thu 08:00–16:00, Fri
 * 08:00–14:00 Trinidad), and posts ONE digest to the super-admin's inbox.
 *
 * Secured by CRON_SECRET exactly like /api/cron/document-reminders, and fails
 * closed when the secret is unset. Scheduled from .github/workflows/job-report-reminders.yml
 * rather than vercel.json — sub-daily crons need a paid Vercel plan, and a
 * vercel.json the plan can't honour fails the DEPLOY, not just the cron.
 *
 * Idempotent by design: reminder_sent_at is both the latch and part of the query
 * predicate, and it is stamped only after the message has actually landed. A
 * double-fire, a retry, or a mid-run timeout can therefore never double-notify or
 * silently swallow a reminder — the worst case is that it fires on the next tick.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceClient()
  const now = new Date()
  const staleBefore = new Date(now.getTime() - STALE_DAYS * 86400_000).toISOString()

  // Armed, expired, not yet told about, and not already dealt with. A job whose
  // clock ran off its end_date may never have been marked complete at all — that
  // is deliberate: a forgotten job is exactly what this should surface.
  const { data: jobs, error } = await db
    .from('jobs')
    .select('id, title, job_number, report_number, vessel_name, job_type, reminder_due_at, workflow_status')
    .is('reminder_sent_at', null)
    .not('reminder_due_at', 'is', null)
    .lte('reminder_due_at', now.toISOString())
    .gte('reminder_due_at', staleBefore)
    .not('workflow_status', 'in', '("invoice_ready","closed")')
    .order('reminder_due_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // The window rule lives in one place and is applied here rather than baked into
  // the stored due_at, so changing a job's delay just moves due_at.
  const due = (jobs ?? []).filter(j => isReminderDue(j.reminder_due_at, now))
  if (due.length === 0) {
    return NextResponse.json({ ok: true, candidates: jobs?.length ?? 0, due: 0, sent: 0 })
  }

  // Super-admin only — this is Andrew's report queue, not a team broadcast.
  const { data: recipients } = await db
    .from('profiles').select('id')
    .eq('is_super_admin', true).eq('is_active', true)
  if (!recipients?.length) {
    return NextResponse.json({ ok: true, due: due.length, sent: 0, note: 'no active super-admin' })
  }

  // PLAIN TEXT, not HTML. The inbox renders the body as `{detail.body}` inside a
  // whitespace-pre-wrap <p> (app/(dashboard)/inbox/page.tsx) — React escapes it, and
  // there is no dangerouslySetInnerHTML anywhere in the app. HTML here would show
  // the user literal <li> tags. The list preview also slices the first 120 chars,
  // so the summary line leads and the URLs come after.
  const label = (j: typeof due[number]) =>
    [j.report_number || j.job_number, j.title].filter(Boolean).join(' — ') || 'Untitled job'
  const line = (j: typeof due[number]) =>
    `• ${label(j)}${[j.vessel_name, j.job_type].filter(Boolean).length ? ` (${[j.vessel_name, j.job_type].filter(Boolean).join(' · ')})` : ''}\n` +
    `  ${APP_URL}/admin/jobs/${j.id}`

  const subject = due.length === 1
    ? `Report due: ${label(due[0])}`
    : `${due.length} reports are ready to write`

  // Identifiers are written into the body, not just linked, so the message still
  // reads coherently if the job is later deleted (messages has no FK to jobs).
  const body =
    `${due.length === 1 ? 'This report is' : `These ${due.length} reports are`} now ready to be written up:\n\n` +
    `${due.map(line).join('\n\n')}\n\n` +
    `You're seeing this because the report reminder came due. Change or switch off ` +
    `the delay on the job page, or set the default for a job type in Settings → Job Types.`

  // Insert the message, then fan out recipient rows — rolling the message back if
  // the fan-out fails, so an orphan message can never leave a job latched as
  // "sent" with nothing in anyone's inbox. Mirrors /api/messages/send.
  // sender_id is NULL: this is from the app, not from a person. Migration 162
  // drops the NOT NULL and lib/messages/api.ts renders a null sender as "Tayeng App".
  const { data: msg, error: msgErr } = await db.from('messages')
    .insert({ sender_id: null, subject, body })
    .select('id').single()
  if (msgErr || !msg) {
    return NextResponse.json({ error: msgErr?.message ?? 'Could not create message.' }, { status: 500 })
  }

  const { error: recErr } = await db.from('message_recipients')
    .insert(recipients.map(r => ({ message_id: msg.id, recipient_id: r.id })))
  if (recErr) {
    await db.from('messages').delete().eq('id', msg.id)
    return NextResponse.json({ error: recErr.message }, { status: 500 })
  }

  // Only NOW latch the jobs — the same "don't mark it done unless it actually
  // worked" rule the document-expiry cron uses. If this update fails the digest is
  // re-sent next tick; a duplicate nudge is a far better failure than a silent one.
  const { error: latchErr } = await db.from('jobs')
    .update({ reminder_sent_at: now.toISOString() })
    .in('id', due.map(j => j.id))

  return NextResponse.json({
    ok: !latchErr,
    due: due.length,
    sent: due.length,
    recipients: recipients.length,
    ...(latchErr ? { latchError: latchErr.message } : {}),
  })
}
