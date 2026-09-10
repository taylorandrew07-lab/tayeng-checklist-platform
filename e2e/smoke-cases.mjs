/**
 * Smoke test — P&I cases, against the live database.
 *
 * Everything a case does that matters lives in RLS policies, CHECK constraints, GENERATED
 * columns and two RPCs, and `npm test` covers NONE of that — vitest is pure-function only.
 * So this is the only proof the database behaves. It is what caught the migration-207 bug
 * in the model this one replaces.
 *
 * What it pins:
 *   1. An attendee is an app user OR a typed name — never both, never neither, and a
 *      blank string is not a name.
 *   2. Time is whole minutes: six ten-minute blocks are exactly 60, not 1.02 hours.
 *   3. A tap is idempotent on retry but not on a second tap — that is the whole point of
 *      the client_ref: two taps mean two chunks, one tap replayed means one. It lands in
 *      FEES AND COSTS (mig 220) and prices itself from the case's standing rate.
 *   4. The money is computed by the database — all three attendance bases, and a timed fee.
 *   5. A claim carries ONE currency, never claims an unpriced item, and leaves anything
 *      dated after its cutoff outstanding.
 *   6. Undoing a claim is a plain delete and releases everything it covered.
 *   7. A surveyor can read none of it.
 *
 * Run:  npm run smoke-cases
 * Needs (from .env.local, loaded automatically, or real env vars in CI):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *
 * Every row it creates is prefixed SMOKE and deleted at the end.
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'

const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !ANON || !SR) {
  console.error('✗ Missing env: need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(2)
}

// `admin` is the SERVICE ROLE: it bypasses RLS and is used for setup and teardown only.
// It is NOT an administrator — a service-role connection has no auth.uid(), so is_admin()
// is false for it and every admin gate correctly refuses it. The real work runs as `boss`,
// a signed-in admin, which is what the app itself does.
const admin = createClient(URL, SR, { auth: { persistSession: false } })
const stamp = Date.now()
const surveyorEmail = `smoke-case-surveyor-${stamp}@tayeng-test.local`
const adminEmail = `smoke-case-admin-${stamp}@tayeng-test.local`
const password = 'Smoke!Test12345'

let surveyorId, adminId, caseId, failures = 0
const cleanup = []
const ok = (s) => console.log(`  ✓ ${s}`)
const bad = (s) => { console.log(`  ✗ ${s}`); failures++ }
/** A 0-row write is an RLS refusal, which PostgREST reports as success. */
const wrote = (r, label) => (r.error || !r.data?.length) ? bad(`${label}: ${r.error?.message ?? '0 rows (silently denied)'}`) : ok(label)
const denied = (r, label) => (!r.error && r.data?.length) ? bad(`${label}: the write SUCCEEDED and should not have`) : ok(label)
const eq = (actual, expected, label) =>
  actual === expected ? ok(label) : bad(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)

try {
  const { data: sUser, error: se } = await admin.auth.admin.createUser({ email: surveyorEmail, password, email_confirm: true })
  if (se) throw new Error('createUser(surveyor): ' + se.message)
  surveyorId = sUser.user.id
  cleanup.push(() => admin.auth.admin.deleteUser(surveyorId))
  await admin.from('profiles').update({ full_name: 'SMOKE Case Surveyor', role: 'surveyor', is_active: true }).eq('id', surveyorId)

  const { data: aUser, error: ae } = await admin.auth.admin.createUser({ email: adminEmail, password, email_confirm: true })
  if (ae) throw new Error('createUser(admin): ' + ae.message)
  adminId = aUser.user.id
  cleanup.push(() => admin.auth.admin.deleteUser(adminId))
  await admin.from('profiles').update({ full_name: 'SMOKE Case Admin', role: 'admin', is_active: true }).eq('id', adminId)

  const boss = createClient(URL, ANON, { auth: { persistSession: false } })
  if ((await boss.auth.signInWithPassword({ email: adminEmail, password })).error) throw new Error('admin sign-in failed')
  const surveyor = createClient(URL, ANON, { auth: { persistSession: false } })
  if ((await surveyor.auth.signInWithPassword({ email: surveyorEmail, password })).error) throw new Error('surveyor sign-in failed')

  // ── A case is its own thing ────────────────────────────────────────────────
  const { data: c, error: ce } = await boss.from('cases').insert({
    title: 'SMOKE CASE - delete me', case_type: 'Collision',
    our_vessel: 'SMOKE Ship', other_party: 'SMOKE Other', principal: 'SMOKE Club',
  }).select('id, status, opened_on').single()
  if (ce) throw new Error('create case: ' + ce.message)
  caseId = c.id
  cleanup.push(() => admin.from('cases').delete().eq('id', caseId))
  ok('an admin can open a case')
  eq(c.status, 'open', "a new case is 'open'")
  eq(c.opened_on != null, true, 'opened_on is stamped')

  // ── WHO: an app user OR a typed name ───────────────────────────────────────
  const mk = (row) => boss.from('case_attendances').insert({ case_id: caseId, ...row }).select('id, charge_amount')

  wrote(await mk({ attendee_profile_id: adminId, minutes: 60, attended_on: '2026-01-10' }),
    'an attendance by one of our own people')
  wrote(await mk({ attendee_name: 'Acme Salvage Ltd', minutes: 120, attended_on: '2026-01-12' }),
    'an attendance by a CONTRACTOR, typed by name — impossible in the old model')

  denied(await mk({ attendee_profile_id: adminId, attendee_name: 'Both', minutes: 10 }),
    'both an app user and a name is rejected')
  denied(await mk({ minutes: 10 }), 'neither is rejected')
  denied(await mk({ attendee_name: '   ', minutes: 10 }), 'a blank name is not an attendee')

  // ── Minutes, not decimal hours — and the blocks land in FEES (mig 220) ─────
  for (let i = 0; i < 6; i++) {
    const r = await boss.rpc('case_add_quick_charge', { p_case: caseId, p_kind: 'call', p_client_ref: crypto.randomUUID() })
    if (r.error) { bad('quick block: ' + r.error.message); break }
  }
  const { data: quick } = await admin.from('case_charges')
    .select('minutes, kind').eq('case_id', caseId).eq('minutes', 10)
  eq(quick.reduce((s, r) => s + r.minutes, 0), 60, 'six ten-minute taps are exactly 60 minutes, not 1.02 hours')
  eq(quick.every(r => r.kind === 'Phone call'), true, 'a tap files a FEE, not an attendance')
  const { count: strayAtt } = await admin.from('case_attendances')
    .select('id', { count: 'exact', head: true }).eq('case_id', caseId).not('client_ref', 'is', null)
  eq(strayAtt, 0, 'and nothing quick is left in attendances')

  // The retry rule: same key replays, a new key is a new chunk.
  const ref = crypto.randomUUID()
  const first = await boss.rpc('case_add_quick_charge', { p_case: caseId, p_kind: 'email', p_client_ref: ref })
  const retry = await boss.rpc('case_add_quick_charge', { p_case: caseId, p_kind: 'email', p_client_ref: ref })
  eq(first.data, retry.data, 'a retried tap replays the same row instead of double-logging')
  const second = await boss.rpc('case_add_quick_charge', { p_case: caseId, p_kind: 'email', p_client_ref: crypto.randomUUID() })
  eq(second.data !== first.data, true, 'a genuine second tap makes a second chunk')

  // A tap prices itself from the case's standing rate, so the rate is typed once.
  await boss.from('cases').update({ rate_defaults: { 'phone call': { rate: 120, currency: 'USD' } } }).eq('id', caseId)
  const priced = await boss.rpc('case_add_quick_charge', { p_case: caseId, p_kind: 'call', p_client_ref: crypto.randomUUID() })
  const { data: pricedRow } = await admin.from('case_charges')
    .select('unit_amount, amount').eq('id', priced.data).single()
  eq(Number(pricedRow.unit_amount), 120, 'a tap takes the case rate for that kind of work')
  eq(Number(pricedRow.amount), 20, 'ten minutes at 120/h is 20.00, computed by the database')
  await boss.from('cases').update({ rate_defaults: {} }).eq('id', caseId)

  // ── The database computes the money ────────────────────────────────────────
  const { data: hourly } = await boss.from('case_attendances')
    .insert({ case_id: caseId, attendee_profile_id: adminId, minutes: 90, attended_on: '2026-01-15',
              rate_type: 'hourly', rate_amount: 200, currency: 'USD' }).select('charge_amount').single()
  eq(Number(hourly.charge_amount), 300, 'hourly: 90 minutes at 200/h = 300.00')

  const { data: daily } = await boss.from('case_attendances')
    .insert({ case_id: caseId, attendee_name: 'Acme Salvage Ltd', minutes: 480, attended_on: '2026-01-16',
              rate_type: 'daily', rate_amount: 900, days: 2, currency: 'USD' }).select('charge_amount').single()
  eq(Number(daily.charge_amount), 1800, 'daily: 2 days at 900 = 1800.00')

  const { data: fixed } = await boss.from('case_attendances')
    .insert({ case_id: caseId, attendee_name: 'Acme Salvage Ltd', minutes: 0, attended_on: '2026-01-17',
              rate_type: 'fixed', rate_amount: 450, currency: 'USD' }).select('charge_amount').single()
  eq(Number(fixed.charge_amount), 450, 'fixed fee: 450.00 regardless of time')

  // Something in ANOTHER currency, to prove a claim cannot pick up both.
  await boss.from('case_attendances').insert({
    case_id: caseId, attendee_profile_id: adminId, minutes: 60, attended_on: '2026-01-18',
    rate_type: 'hourly', rate_amount: 700, currency: 'TTD' })

  // A fee rides on the same claim.
  const feeRes = await boss.from('case_charges').insert({
    case_id: caseId, kind: 'correspondency', description: 'SMOKE correspondency fee',
    incurred_on: '2026-01-05', qty: 1, unit_amount: 250, currency: 'USD' }).select('id')
  wrote(feeRes, 'an admin can add a fee')
  const feeId = feeRes.data?.[0]?.id

  // A fee that IS time: the rate is per hour and the database does the division.
  const { data: timed } = await boss.from('case_charges').insert({
    case_id: caseId, kind: 'Phone call', description: '', incurred_on: '2026-01-21',
    minutes: 30, qty: 1, unit_amount: 200, currency: 'USD' }).select('amount').single()
  eq(Number(timed.amount), 100, 'a timed fee: 30 minutes at 200/h = 100.00')

  // The same thing with no rate yet. It must be LOGGED and left alone by the claim.
  const { data: noRate } = await boss.from('case_charges').insert({
    case_id: caseId, kind: 'Email', description: '', incurred_on: '2026-01-22',
    minutes: 10, qty: 1, unit_amount: 0, currency: 'USD' }).select('id').single()

  // ── The claim ──────────────────────────────────────────────────────────────
  const { data: claim, error: cle } = await boss.rpc('case_claim_items', {
    p_case: caseId, p_currency: 'USD', p_cutoff: '2026-01-31', p_reference: null, p_note: null })
  if (cle) bad('case_claim_items: ' + cle.message)
  else {
    eq(claim.currency, 'USD', 'the claim carries the currency it was asked for')
    eq(claim.attendances, 3, 'it claims exactly the three PRICED USD attendances')
    eq(claim.charges, 2, 'and the two priced fees alongside them')
    eq(Number(claim.total), 2900, 'the total is 300 + 1800 + 450 + 250 + 100')
  }

  const { count: unpriced } = await admin.from('case_attendances')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', caseId).is('claim_id', null).is('rate_amount', null)
  eq(unpriced > 0, true, 'unpriced attendances are left behind — never billed at zero')

  const { data: noRateAfter } = await admin.from('case_charges')
    .select('claim_id').eq('id', noRate.id).single()
  eq(noRateAfter.claim_id, null, 'a timed fee with no rate stays outstanding — ten minutes is never claimed at nothing')

  const { data: ttd } = await admin.from('case_attendances')
    .select('claim_id').eq('case_id', caseId).eq('currency', 'TTD').single()
  eq(ttd.claim_id, null, 'TTD work stays outstanding — one claim carries one currency')

  // An entry added LATE but dated inside the claimed period must not vanish into it.
  const { data: late } = await boss.from('case_attendances').insert({
    case_id: caseId, attendee_profile_id: adminId, minutes: 30, attended_on: '2026-01-20',
    rate_type: 'hourly', rate_amount: 200, currency: 'USD' }).select('claim_id').single()
  eq(late.claim_id, null, 'an attendance added late but dated inside the claimed period stays outstanding')

  // ── Undo is a plain delete ─────────────────────────────────────────────────
  const { data: theClaim } = await admin.from('case_claims').select('id').eq('case_id', caseId).single()
  await boss.from('case_claims').delete().eq('id', theClaim.id)
  const { count: stillClaimed } = await admin.from('case_attendances')
    .select('id', { count: 'exact', head: true }).eq('case_id', caseId).not('claim_id', 'is', null)
  eq(stillClaimed, 0, 'deleting the claim releases every attendance it covered')
  const { data: feeAfter } = await admin.from('case_charges').select('claim_id').eq('id', feeId).single()
  eq(feeAfter.claim_id, null, 'and the fee too')

  // ── A surveyor sees none of it ─────────────────────────────────────────────
  for (const t of ['cases', 'case_attendances', 'case_charges', 'case_claims', 'case_documents']) {
    const r = await surveyor.from(t).select('id')
    eq((r.data ?? []).length, 0, `a surveyor reads nothing from ${t}`)
  }
  denied(await surveyor.from('case_attendances')
    .insert({ case_id: caseId, attendee_profile_id: surveyorId, minutes: 10 }).select('id'),
    'and cannot log against a case')

} catch (e) {
  bad(`FATAL: ${e.message}`)
} finally {
  for (const fn of cleanup.reverse()) { try { await fn() } catch { /* best effort */ } }
}

console.log(
  failures === 0
    ? '\n✓ SMOKE PASS — a case records our people and contractors, in minutes, and claims one currency at a time.'
    : `\n✗ SMOKE FAIL — ${failures} check(s) failed.`,
)
process.exit(failures === 0 ? 0 : 1)
