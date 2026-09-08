/**
 * Smoke test — P&I cases, against the live database.
 *
 * Everything a case does that matters lives in RLS policies, triggers and RPCs, and
 * `npm test` covers NONE of that — vitest is pure-function only. So this is the only
 * proof that the guards actually hold. It exercises the two things that would be
 * expensive to get wrong:
 *
 *   1. A LIVE case never freezes. Migration 204 exempted it from the invoicing
 *      write-lock in the database; a surveyor must be able to log an attendance on a
 *      case whatever its workflow status, and must be refused the moment it concludes.
 *   2. Money is tracked per ATTENDANCE (mig 206). Billing stamps exactly the entries
 *      up to a cutoff, later work stays outstanding, and a surveyor can neither set
 *      nor clear that stamp.
 *
 * Run:  npm run smoke-cases
 * Needs (from .env.local, loaded automatically, or real env vars in CI):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *
 * Exit code 0 = cases behave. Non-zero = something a case depends on is broken.
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

// `admin` is the SERVICE ROLE: it bypasses RLS and is used for setup and teardown.
// It is NOT an administrator — a service-role connection has no auth.uid(), so
// is_admin() is false for it and every admin-gated guard correctly refuses it. That
// is why the admin-gated parts below run as `boss`, a real signed-in admin, which is
// also what the app itself does (the billing UI runs in an admin's browser).
const admin = createClient(URL, SR, { auth: { persistSession: false } })
const stamp = Date.now()
const email = `smoke-case-${stamp}@tayeng-test.local`
const adminEmail = `smoke-caseadmin-${stamp}@tayeng-test.local`
const password = 'Smoke!Test12345'

let userId, adminId, caseId, jsId, invoiceId, failures = 0
const cleanup = []
const ok = (s) => console.log(`  ✓ ${s}`)
const bad = (s) => { console.log(`  ✗ ${s}`); failures++ }
/** A 0-row write is an RLS refusal, which PostgREST reports as success. */
const wrote = (r, label) => (r.error || !r.data?.length) ? bad(`${label}: ${r.error?.message ?? '0 rows (silently denied)'}`) : ok(label)
const denied = (r, label) => (!r.error && r.data?.length) ? bad(`${label}: the write SUCCEEDED and should not have`) : ok(label)
const eq = (actual, expected, label) =>
  actual === expected ? ok(label) : bad(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)

try {
  // ── Setup: an active surveyor, and a case owned by an admin ───────────────
  const { data: created, error: ce } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (ce) throw new Error('createUser: ' + ce.message)
  userId = created.user.id
  cleanup.push(() => admin.auth.admin.deleteUser(userId))
  await admin.from('profiles').update({ full_name: 'SMOKE Case Surveyor', role: 'surveyor', is_active: true }).eq('id', userId)

  const { data: bossUser, error: be0 } = await admin.auth.admin.createUser({ email: adminEmail, password, email_confirm: true })
  if (be0) throw new Error('createUser(admin): ' + be0.message)
  adminId = bossUser.user.id
  cleanup.push(() => admin.auth.admin.deleteUser(adminId))
  await admin.from('profiles').update({ full_name: 'SMOKE Case Admin', role: 'admin', is_active: true }).eq('id', adminId)

  const boss = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error: bse } = await boss.auth.signInWithPassword({ email: adminEmail, password })
  if (bse) throw new Error('admin sign-in: ' + bse.message)

  const adminProf = { id: adminId }

  const { data: caseType } = await admin.from('job_types').select('name, is_case').eq('name', 'P&I Case').maybeSingle()
  eq(caseType?.is_case, true, "the 'P&I Case' job type is marked as a case type (mig 204)")

  const { data: job, error: je } = await admin.from('jobs').insert({
    title: 'SMOKE CASE - delete me', job_type: 'P&I Case', workflow_status: 'in_progress',
    assigned_to: userId, created_by: adminProf?.id ?? userId, surveyor_name: 'SMOKE Case Surveyor',
  }).select('id, is_case, case_status, case_opened_on, report_not_required').single()
  if (je) throw new Error('admin insert case: ' + je.message)
  caseId = job.id
  cleanup.push(async () => {
    const { data: js } = await admin.from('job_surveyors').select('id').eq('job_id', caseId)
    for (const r of js ?? []) {
      await admin.from('job_surveyor_regular').delete().eq('job_surveyor_id', r.id)
      await admin.from('job_surveyor_overtime').delete().eq('job_surveyor_id', r.id)
    }
    await admin.from('case_charges').delete().eq('job_id', caseId)
    if (invoiceId) {
      await admin.from('invoice_line_items').delete().eq('invoice_id', invoiceId)
      await admin.from('invoices').delete().eq('id', invoiceId)
    }
    await admin.from('jobs').delete().eq('id', caseId)
  })

  console.log('Admin opened a P&I case and assigned a surveyor.\n')

  // ── The insert trigger derives the case from its type (mig 204 §3) ────────
  eq(job.is_case, true, 'is_case derived from the job type')
  eq(job.case_status, 'open', "case_status defaults to 'open'")
  eq(job.case_opened_on != null, true, 'case_opened_on is stamped')

  // ── A case MAY carry a report number (mig 205 §1) ─────────────────────────
  // 204 forced report_not_required true, which made this impossible. It must not.
  const rr = await boss.from('jobs').update({ report_not_required: false }).eq('id', caseId).select('id, report_not_required')
  wrote(rr, 'a case can be marked as REQUIRING a report')
  eq(rr.data?.[0]?.report_not_required, false, 'and the flag is not forced back true')

  // ── The surveyor's attendance survives billing ────────────────────────────
  const surveyor = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error: se } = await surveyor.auth.signInWithPassword({ email, password })
  if (se) throw new Error('surveyor sign-in: ' + se.message)

  const { data: jsRow } = await admin.from('job_surveyors').select('id').eq('job_id', caseId).eq('surveyor_id', userId).single()
  jsId = jsRow.id

  const logOne = (date, hours) => surveyor.from('job_surveyor_regular')
    .insert({ job_surveyor_id: jsId, entry_date: date, hours, location: 'SMOKE', note: 'SMOKE attendance' })
    .select('id, billed_invoice_id')

  wrote(await logOne('2026-01-10', 4), 'surveyor logs an attendance on an open case')

  // THE POINT OF MIGRATION 204: invoicing normally freezes every surveyor write.
  wrote(await boss.from('jobs').update({ workflow_status: 'invoiced' }).eq('id', caseId).select('id'), 'admin marks the case invoiced')
  wrote(await logOne('2026-01-20', 6), 'surveyor still logs an attendance while the case is INVOICED')

  wrote(await boss.from('jobs').update({ workflow_status: 'closed' }).eq('id', caseId).select('id'), 'admin marks the case closed')
  wrote(await logOne('2026-02-05', 5), 'surveyor still logs an attendance while the case is CLOSED')

  // ...and the exemption switches off the moment the case concludes.
  wrote(await boss.from('jobs').update({ case_status: 'concluded' }).eq('id', caseId).select('id'), 'admin concludes the case')
  denied(await logOne('2026-02-10', 3), 'a CONCLUDED case refuses the surveyor, like any billed job')
  await boss.from('jobs').update({ case_status: 'open', workflow_status: 'in_progress' }).eq('id', caseId)

  // ── A live case is never billed as a job line (mig 205 §4) ────────────────
  const { data: anyClient } = await admin.from('clients').select('id').limit(1).maybeSingle()
  const { data: inv, error: ie } = await admin.from('invoices')
    .insert({ client_id: anyClient?.id ?? null, status: 'active', currency: 'TTD', subtotal: 0, tax_total: 0, total: 0, notes: 'SMOKE - delete me' })
    .select('id').single()
  if (ie) throw new Error('create invoice: ' + ie.message)
  invoiceId = inv.id

  const asLine = await boss.rpc('bill_jobs_onto_invoice', { p_invoice_id: invoiceId, p_line_job_ids: [caseId], p_absorbed: {} })
  asLine.error ? ok('bill_jobs_onto_invoice REFUSES a live case') : bad('bill_jobs_onto_invoice billed a live case as a job line')

  // ── Billing by attendance, with a cutoff (mig 208) ───────────────────────
  const outstanding = async () => {
    const { data } = await admin.from('job_surveyor_regular').select('hours, billed_invoice_id').eq('job_surveyor_id', jsId)
    return (data ?? []).filter(r => !r.billed_invoice_id).reduce((s, r) => s + Number(r.hours), 0)
  }
  eq(await outstanding(), 15, 'all 15 hours start outstanding')

  // An hour NOBODY HAS PRICED must not be billed. Billing it would charge the client
  // zero and mark the hours paid, which is unrecoverable without noticing.
  const nothingYet = await boss.rpc('bill_case_items', { p_case: caseId, p_invoice: invoiceId, p_cutoff: '2026-01-31' })
  if (nothingYet.error) bad('bill_case_items: ' + nothingYet.error.message)
  else eq(nothingYet.data?.total, 0, 'an unpriced attendance is never billed')

  // Price the two January entries: one in the invoice's currency (TTD), one in USD, to
  // prove a single invoice cannot pick up both.
  const { data: janRows } = await admin.from('job_surveyor_regular')
    .select('id, entry_date').eq('job_surveyor_id', jsId).lte('entry_date', '2026-01-31').order('entry_date')
  const [jan10, jan20] = janRows ?? []
  wrote(await boss.from('job_attendance_billing')
    .insert({ regular_entry_id: jan10.id, description: 'Call-out attendance', charge_rate: 100, charge_currency: 'TTD' })
    .select('id'), 'admin prices one attendance in TTD')
  wrote(await boss.from('job_attendance_billing')
    .insert({ regular_entry_id: jan20.id, description: 'Expert witness testimony', charge_rate: 150, charge_currency: 'USD' })
    .select('id'), 'admin prices another, on the SAME surveyor, at a different rate in USD')

  // A correspondency fee rides on the same invoice, in the same currency.
  const { error: ccErr } = await boss.from('case_charges').insert({
    job_id: caseId, kind: 'correspondency', description: 'SMOKE correspondency fee',
    incurred_on: '2026-01-05', qty: 1, unit_amount: 750, currency: 'TTD',
  })
  if (ccErr) bad('insert case charge: ' + ccErr.message)
  else ok('admin adds a one-time correspondency fee')

  const { data: billed, error: be2 } = await boss.rpc('bill_case_items', {
    p_case: caseId, p_invoice: invoiceId, p_cutoff: '2026-01-31',
  })
  if (be2) bad('bill_case_items: ' + be2.message)
  else {
    eq(billed?.currency, 'TTD', 'the run takes its currency from the invoice')
    eq(billed?.regular, 1, 'only the TTD attendance is billed — the USD one is left alone')
    eq(billed?.charges, 1, 'the correspondency fee is billed alongside the hours')
  }

  const { data: usdLeft } = await admin.from('job_surveyor_regular').select('billed_invoice_id').eq('id', jan20.id).single()
  eq(usdLeft.billed_invoice_id, null, 'USD work stays outstanding for its own invoice — currencies never mix')
  eq(await outstanding(), 11, 'February and the USD entry remain outstanding')

  // A late entry DATED inside the billed period is still outstanding — not lost.
  await admin.from('job_surveyor_regular')
    .insert({ job_surveyor_id: jsId, entry_date: '2026-01-15', hours: 2, location: 'SMOKE', note: 'SMOKE late entry' })
  eq(await outstanding(), 13, 'an attendance added late but dated inside the billed period stays outstanding')

  // ── The surveyor cannot rewrite what has been billed (mig 206 §2) ─────────
  const { data: billedRow } = await admin.from('job_surveyor_regular')
    .select('id').eq('job_surveyor_id', jsId).not('billed_invoice_id', 'is', null).limit(1).single()
  await surveyor.from('job_surveyor_regular').update({ billed_invoice_id: null }).eq('id', billedRow.id)
  const { data: afterClear } = await admin.from('job_surveyor_regular').select('billed_invoice_id').eq('id', billedRow.id).single()
  eq(afterClear.billed_invoice_id, invoiceId, 'a surveyor cannot clear the billed stamp and have paid hours re-billed')

  // ── Rates are invisible to the surveyor (mig 208) ─────────────────────────
  const peek = await surveyor.from('job_attendance_billing').select('charge_rate')
  eq((peek.data ?? []).length, 0, 'a surveyor cannot read what the client is charged for their hour')
  const peekCharges = await surveyor.from('case_charges').select('unit_amount').eq('job_id', caseId)
  eq((peekCharges.data ?? []).length, 0, 'a surveyor cannot read the case fees either')

  // ── VOIDING releases hours AND fees ───────────────────────────────────────
  const voidRes = await boss.rpc('unbill_case_items', { p_invoice: invoiceId })
  if (voidRes.error) bad('unbill_case_items: ' + voidRes.error.message)
  else {
    eq(voidRes.data?.charges, 1, 'voiding releases the correspondency fee, not just the hours')
    eq(await outstanding(), 17, 'voiding returns the billed hours to outstanding')
  }
  await boss.rpc('bill_case_items', { p_case: caseId, p_invoice: invoiceId, p_cutoff: '2026-01-31' })

  // ── Deleting the invoice releases exactly its entries ─────────────────────
  await admin.from('invoice_line_items').delete().eq('invoice_id', invoiceId)
  const del = await admin.from('invoices').delete().eq('id', invoiceId)
  if (del.error) bad('deleting the invoice: ' + del.error.message)
  invoiceId = null
  eq(await outstanding(), 17, 'deleting the invoice returns its attendances to outstanding')

} catch (e) {
  bad(`FATAL: ${e.message}`)
} finally {
  for (const fn of cleanup.reverse()) { try { await fn() } catch { /* best effort */ } }
}

console.log(
  failures === 0
    ? '\n✓ SMOKE PASS — a P&I case stays writable while live, and bills by attendance.'
    : `\n✗ SMOKE FAIL — ${failures} check(s) failed.`,
)
process.exit(failures === 0 ? 0 : 1)
