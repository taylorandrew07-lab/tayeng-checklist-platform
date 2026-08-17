import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { REMINDER_BUCKETS, crossedBuckets, tightestBucket, daysUntil, trinidadToday } from '@/lib/inventory/calibration'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tayeng-checklist-platform.vercel.app'

/** Never cache or statically evaluate a cron endpoint. */
export const dynamic = 'force-dynamic'

/** The widest rung of the ladder — nothing beyond this is worth fetching. */
const HORIZON_DAYS = Math.max(...REMINDER_BUCKETS)

/** Ignore dates that went past this long ago, so a backfill of ancient records
 *  can't dump a wall of overdue equipment into the inbox on first run. */
const STALE_DAYS = 120

/**
 * Calibration and expiry reminders (migration 190).
 *
 * ONE route for both signals: they share the latch table and the digest format,
 * and two near-identical routes is drift waiting to happen.
 *
 * THE LATCH. inventory_reminders is keyed (item_id, reason, due_date, days_out),
 * so a row is written per rung crossed. Because due_date is part of the key,
 * changing an item's calibration date orphans the old rows (harmless history —
 * we did warn about the old date) and the new date has no rows, so the whole
 * ladder re-arms automatically. No reset logic, no cleanup job.
 *
 * CROSSED, NOT EQUALLED. Buckets fire on `days <= bucket`, never `days ===
 * bucket`. With an equality test a cron that misses a day — an outage, a deploy,
 * a slow queue — SKIPS that reminder rather than sending it late. See
 * crossedBuckets() in lib/inventory/calibration.ts, which is unit-tested.
 *
 * Secured by CRON_SECRET exactly like the other two crons, and fails closed when
 * the secret is unset. Scheduled from .github/workflows/inventory-reminders.yml
 * rather than vercel.json: vercel.json already carries one cron, the Hobby plan
 * allows two, and a schedule the plan cannot honour fails the DEPLOY — not just
 * the cron. A GitHub Action costs nothing and has a working precedent here.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceClient()
  const now = new Date()
  // Trinidad's calendar day, not the UTC runner's. Without this the 7-day rung
  // fires a day early roughly one run in six.
  const today = trinidadToday(now)
  const horizon = shiftDate(today, HORIZON_DAYS)
  const stale = shiftDate(today, -STALE_DAYS)

  const { data: items, error } = await db
    .from('inventory_items')
    .select('id, kind, name, serial_number, manufacturer, model, calibration_due, service_status, is_active')
    .eq('is_active', true)
    .neq('service_status', 'retired')
    .not('calibration_due', 'is', null)
    .gte('calibration_due', stale)
    .lte('calibration_due', horizon)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: stock, error: stockErr } = await db
    .from('inventory_stock')
    .select('item_id, qty_units, expiry_date, item:inventory_items!inner(id, name, is_active)')
    .not('expiry_date', 'is', null)
    .gte('expiry_date', stale)
    .lte('expiry_date', horizon)
    .gt('qty_units', 0)
  if (stockErr) return NextResponse.json({ error: stockErr.message }, { status: 500 })

  type Candidate = { itemId: string; label: string; detail: string; reason: 'calibration' | 'expiry'; due: string }
  const candidates: Candidate[] = []

  for (const it of items ?? []) {
    candidates.push({
      itemId: it.id,
      label: it.name,
      detail: [it.manufacturer, it.model, it.serial_number && `s/n ${it.serial_number}`].filter(Boolean).join(', '),
      reason: 'calibration',
      due: it.calibration_due as string,
    })
  }
  // One row per item per date: two locations holding the same batch date should
  // not produce two identical lines in the digest.
  const seenExpiry = new Set<string>()
  for (const s of (stock ?? []) as unknown as {
    item_id: string; expiry_date: string; item: { name: string; is_active: boolean } | null
  }[]) {
    if (!s.item?.is_active) continue
    const key = `${s.item_id}|${s.expiry_date}`
    if (seenExpiry.has(key)) continue
    seenExpiry.add(key)
    candidates.push({
      itemId: s.item_id, label: s.item.name, detail: '', reason: 'expiry', due: s.expiry_date,
    })
  }

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, candidates: 0, due: 0, sent: 0 })
  }

  const { data: latched } = await db
    .from('inventory_reminders')
    .select('item_id, reason, due_date, days_out')
    .in('item_id', [...new Set(candidates.map(c => c.itemId))])

  const sent = new Set(
    (latched ?? []).map(r => `${r.item_id}|${r.reason}|${r.due_date}|${r.days_out}`),
  )

  // Latch EVERY rung crossed, but write the message about the tightest one only.
  // So an item entered 20 days from due sends once (about 30) rather than twice,
  // and does not nag about 60 tomorrow.
  const due = candidates
    .map(c => {
      const fresh = crossedBuckets(c.due, now).filter(b => !sent.has(`${c.itemId}|${c.reason}|${c.due}|${b}`))
      return { ...c, buckets: fresh, bucket: tightestBucket(c.due, now), days: daysUntil(c.due, now) }
    })
    .filter(c => c.buckets.length > 0)
    .sort((a, b) => a.due.localeCompare(b.due))

  if (due.length === 0) {
    return NextResponse.json({ ok: true, candidates: candidates.length, due: 0, sent: 0 })
  }

  // Every active admin — this is a team signal, not one person's queue.
  const { data: recipients } = await db
    .from('profiles').select('id')
    .eq('is_active', true)
    .or('role.eq.admin,is_super_admin.eq.true')
  if (!recipients?.length) {
    return NextResponse.json({ ok: true, due: due.length, sent: 0, note: 'no active admin' })
  }

  // PLAIN TEXT. The inbox renders the body as {detail.body} inside a
  // whitespace-pre-wrap block, so HTML would show as literal tags. The list
  // preview slices the first 120 characters, so the summary line leads.
  const when = (days: number | null) =>
    days === null ? '' : days < 0 ? `OVERDUE by ${Math.abs(days)} days`
      : days === 0 ? 'due today' : `in ${days} days`

  const line = (c: typeof due[number]) =>
    `• ${c.label}${c.detail ? ` (${c.detail})` : ''} — ${c.reason === 'calibration' ? 'calibration due' : 'expires'} ${c.due}, ${when(c.days)}\n` +
    `  ${APP_URL}/inventory`

  const subject = due.length === 1
    ? `${due[0].reason === 'calibration' ? 'Calibration' : 'Expiry'} ${when(due[0].days)}: ${due[0].label}`
    : `${due.length} inventory items need attention`

  // Identifiers go in the body, not only in the link, so the message still reads
  // coherently if the item is later archived.
  const body =
    `${due.length === 1 ? 'This item needs' : `These ${due.length} items need`} attention:\n\n` +
    `${due.map(line).join('\n\n')}\n\n` +
    `You're seeing this because a calibration or expiry date came due. ` +
    `Update the date on the item to reset its reminders.`

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

  // Only NOW latch. If this fails the digest re-sends next tick — a duplicate
  // nudge is a far better failure than a silent miss.
  const rows = due.flatMap(c => c.buckets.map(b => ({
    item_id: c.itemId, reason: c.reason, due_date: c.due, days_out: b,
    sent_at: now.toISOString(), message_id: msg.id,
  })))
  const { error: latchErr } = await db.from('inventory_reminders')
    .upsert(rows, { onConflict: 'item_id,reason,due_date,days_out', ignoreDuplicates: true })

  return NextResponse.json({
    ok: !latchErr,
    candidates: candidates.length,
    due: due.length,
    sent: due.length,
    latched: rows.length,
    recipients: recipients.length,
    ...(latchErr ? { latchError: latchErr.message } : {}),
  })
}

/** Shift a YYYY-MM-DD by whole days without dragging a timezone into it. */
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
