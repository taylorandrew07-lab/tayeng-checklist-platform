import { NextResponse } from 'next/server'
import { format, parseISO } from 'date-fns'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { sendEmail, escapeHtml, safeSubject } from '@/lib/email/send'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tayeng-checklist-platform.vercel.app'

type Placement = 'winner' | 'runner_up'

interface JudgeBody { month?: string; winnerId?: string | null; runnerUpId?: string | null }

function monthLabel(month: string): string {
  try { return format(parseISO(month), 'MMMM yyyy') } catch { return month }
}

/**
 * Lock a month's results. This is the ONLY place the entry→entrant link is read
 * and an identity is revealed: it runs as the service role so a blind-judging
 * admin never has to (and can't, via RLS) see who submitted what until they've
 * committed their picks. Stamps winner_name onto the chosen (now public) rows
 * and notifies the winner + runner-up in-app and by email.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await supabase.from('profiles')
    .select('role, is_super_admin, is_active, full_name').eq('id', user.id).single()
  if (!me?.is_active || !(me.role === 'admin' || me.is_super_admin === true)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body: JudgeBody = await request.json().catch(() => ({}))
  const month = (body.month ?? '').toString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'A valid month is required.' }, { status: 400 })
  }
  const winnerId = body.winnerId || null
  const runnerUpId = body.runnerUpId || null
  if (winnerId && runnerUpId && winnerId === runnerUpId) {
    return NextResponse.json({ error: 'The winner and runner-up must be different photos.' }, { status: 400 })
  }

  const db = createServiceClient()

  // Reset any previous placements for this month before applying the new picks,
  // so re-judging is idempotent and never leaves a stale winner behind.
  await db.from('competition_entries')
    .update({ placement: null, winner_name: null, placed_at: null })
    .eq('month', month).not('placement', 'is', null)

  const picks: { entryId: string; placement: Placement }[] = []
  if (winnerId) picks.push({ entryId: winnerId, placement: 'winner' })
  if (runnerUpId) picks.push({ entryId: runnerUpId, placement: 'runner_up' })

  const notified: { placement: Placement; name: string; recipientId: string; email: string | null }[] = []
  const now = new Date().toISOString()

  for (const pick of picks) {
    // Confirm the entry is in this month.
    const { data: entry } = await db.from('competition_entries')
      .select('id, month').eq('id', pick.entryId).single()
    if (!entry || entry.month !== month) {
      return NextResponse.json({ error: 'A selected photo is not part of this month.' }, { status: 400 })
    }
    // Reveal: read the owner link (service role only) → entrant profile.
    const { data: link } = await db.from('competition_entry_owners')
      .select('entrant_id').eq('entry_id', pick.entryId).single()
    let name = 'Unknown'
    let recipientId: string | null = null
    let email: string | null = null
    if (link?.entrant_id) {
      recipientId = link.entrant_id
      const { data: prof } = await db.from('profiles')
        .select('full_name, email').eq('id', link.entrant_id).single()
      if (prof) { name = prof.full_name ?? 'Unknown'; email = prof.email ?? null }
    }
    const { error: upErr } = await db.from('competition_entries')
      .update({ placement: pick.placement, winner_name: name, placed_at: now })
      .eq('id', pick.entryId)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 })
    if (recipientId) notified.push({ placement: pick.placement, name, recipientId, email })
  }

  // Close the round when a winner exists (freezes entrant edits); reopen if the
  // picks were cleared. Upsert so a round row is created on demand.
  await db.from('competition_rounds').upsert({
    month,
    status: winnerId ? 'closed' : 'open',
    closed_at: winnerId ? now : null,
    created_by: user.id,
  }, { onConflict: 'month' })

  // Notify winner + runner-up (in-app inbox + best-effort email). One message
  // per recipient; failures never fail the judging call.
  const label = monthLabel(month)
  for (const n of notified) {
    const isWinner = n.placement === 'winner'
    const subject = isWinner
      ? `🏆 You won the ${label} photo competition!`
      : `You're the runner-up in the ${label} photo competition`
    const line = isWinner
      ? `Congratulations ${n.name} — your photo was chosen as the WINNER for ${label}. It's now featured on the competition winners wall.`
      : `Great shot, ${n.name}! Your photo was picked as the RUNNER-UP for ${label}, and it's featured on the winners wall.`
    try {
      const { data: msg } = await db.from('messages')
        .insert({ sender_id: user.id, subject, body: line }).select('id').single()
      if (msg) await db.from('message_recipients').insert({ message_id: msg.id, recipient_id: n.recipientId })
    } catch { /* inbox notify is best-effort */ }
    if (n.email) {
      const html = `
        <p>${escapeHtml(line)}</p>
        <p><a href="${APP_URL}/competition">See the winners wall →</a></p>
      `
      await sendEmail({ to: [n.email], subject: safeSubject(subject), html }).catch(() => {})
    }
  }

  return NextResponse.json({ ok: true, placed: notified.length })
}
