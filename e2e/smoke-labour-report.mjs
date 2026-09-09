/**
 * Smoke test — labour_shift_lines (migration 210) against the live database.
 *
 * THE ACCEPTANCE TEST FOR THE WHOLE LABOUR & OVERTIME REPORT LIVES HERE.
 *
 * The printed sheet must add up to the Finance → Overview panel it was printed from,
 * because Andrew pays surveyors off that screen and the office checks the sheet line by
 * line. That identity is arithmetic inside Postgres — five windowing predicates copied out
 * of metrics_labour — and vitest in this repo is pure-function only: it never opens a
 * database connection and covers no RLS policy anywhere. So nothing but this script can
 * prove any of it. Migration 126's footer wrote the same invariant down as a hand-run
 * query and nothing has ever enforced it; this is the place.
 *
 * It seeds one job per SHAPE that the RPC treats differently, then asserts:
 *
 *   1. RECONCILIATION — per surveyor, the shift lines sum to metrics_labour for the same
 *      window: regular hours, overtime hours, regular days, overtime days and km. Checked
 *      over the seeded window AND over (null, null), i.e. every row in the live database.
 *   2. NO SILENT UNDER-REPORT — a typed quantity with no shift log still produces a line;
 *      a row whose OT log falls entirely outside the window contributes nothing AND does
 *      not fall back to its typed overtime (the existence rule, mig 165:65-67).
 *   3. A DAY-BILLED JOB'S SHIFTS STILL PRINT — dated, timed, and worth zero.
 *   4. NO PAY COLUMN — asserted on the KEYS, so a future edit that adds one fails here.
 *   5. ROW SCOPE — signed in as a surveyor, every row returned is their own.
 *   6. OFFICE VISIBILITY IS UNCHANGED — an office user with jobs.monitor.view sees the
 *      same rows through the new RPC as through metrics_labour: it widens nothing.
 *
 * Run:  npm run smoke-labour   (after `gh run list --workflow=db-migrate.yml` confirms 210
 *                               actually applied — green CI is not proof)
 * Needs (from .env.local, loaded automatically, or real env vars in CI):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *
 * Exit code 0 = the report reconciles and leaks nothing. Non-zero = do not ship it.
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

const admin = createClient(URL, SR, { auth: { persistSession: false } })
const stamp = Date.now()
const password = 'Smoke!Test12345'
const surveyorEmail = `smoke-labour-s-${stamp}@tayeng-test.local`
const adminEmail = `smoke-labour-a-${stamp}@tayeng-test.local`
const officeEmail = `smoke-labour-o-${stamp}@tayeng-test.local`

// A window of its own, far from any real job, so the shape assertions are deterministic.
// The reconciliation check is then ALSO run unwindowed, where the live data lives.
const MONTH = '2099-03'
const FROM = `${MONTH}-01`
const TO = `${MONTH}-31`
const d = (n) => `${MONTH}-${String(n).padStart(2, '0')}`

let surveyorId, adminId, officeId, failures = 0
const jobIds = []
const cleanup = []
const ok = (s) => console.log(`  ✓ ${s}`)
const bad = (s) => { console.log(`  ✗ ${s}`); failures++ }
const eq = (actual, expected, label) =>
  actual === expected ? ok(label) : bad(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
/** A read that must return rows. 0 rows with no error is the silent-denial trap. */
const check = (r, label) =>
  (r.error || !r.data?.length) ? bad(`${label}: ${r.error?.message ?? '0 rows (silently denied)'}`) : ok(label)

const num = (v) => Number(v ?? 0)
const near = (a, b) => Math.abs(num(a) - num(b)) <= 0.005

/** Seed one job assigned to our surveyor. The mig-124 trigger mirrors assigned_to into
 *  job_surveyors, so the row we need already exists by the time this returns. */
async function seedJob(label, { unit = 'hours', date, regular = 0, overtime = 0 }) {
  const { data: job, error } = await admin.from('jobs').insert({
    title: `SMOKE LABOUR ${label} ${stamp} - delete me`,
    job_type: 'Cargo Survey',
    workflow_status: 'in_progress',
    labour_unit: unit,
    scheduled_date: date,
    assigned_to: surveyorId,
    created_by: adminId,
    surveyor_name: 'SMOKE Labour Surveyor',
    vessel_name: `SMOKE ${label}`,
  }).select('id').single()
  if (error) throw new Error(`seed job ${label}: ${error.message}`)
  jobIds.push(job.id)

  const { data: js, error: jse } = await admin.from('job_surveyors')
    .select('id').eq('job_id', job.id).eq('surveyor_id', surveyorId).single()
  if (jse) throw new Error(`seed job ${label}: job_surveyors row missing (${jse.message})`)

  // Typed quantities go on last: the log triggers (mig 157) overwrite regular_hours on an
  // hours job, so a typed value written first would be silently replaced.
  if (regular || overtime) {
    const { error: ue } = await admin.from('job_surveyors')
      .update({ regular_hours: regular, overtime_hours: overtime }).eq('id', js.id)
    if (ue) throw new Error(`seed job ${label}: typed quantities (${ue.message})`)
  }
  return js.id
}

const logRegular = (jsId, row) => admin.from('job_surveyor_regular').insert({ job_surveyor_id: jsId, ...row })
const logOvertime = (jsId, row) => admin.from('job_surveyor_overtime').insert({ job_surveyor_id: jsId, ...row })
const logKm = (jsId, row) => admin.from('job_surveyor_km').insert({ job_surveyor_id: jsId, ...row })

/** Fold the shift lines into the five numbers metrics_labour returns, per surveyor.
 *  Hours and days stay in separate fields — always (mig 148). */
function foldLines(rows) {
  const by = new Map()
  for (const r of rows) {
    const t = by.get(r.surveyor_id) ?? { regHours: 0, regDays: 0, otHours: 0, otDays: 0, km: 0 }
    const days = r.labour_unit === 'days'
    if (r.kind === 'regular') days ? (t.regDays += num(r.qty)) : (t.regHours += num(r.qty))
    else if (r.kind === 'overtime') days ? (t.otDays += num(r.qty)) : (t.otHours += num(r.qty))
    else t.km += num(r.km)
    by.set(r.surveyor_id, t)
  }
  return by
}

/** THE INVARIANT. Every surveyor on either side, compared field for field. */
async function assertReconciles(client, from, to, label) {
  const lines = await client.rpc('labour_shift_lines', { p_from: from, p_to: to })
  const panel = await client.rpc('metrics_labour', { p_from: from, p_to: to })
  if (lines.error) return bad(`${label}: labour_shift_lines errored — ${lines.error.message}`)
  if (panel.error) return bad(`${label}: metrics_labour errored — ${panel.error.message}`)

  const folded = foldLines(lines.data ?? [])
  const ids = new Set([...folded.keys(), ...(panel.data ?? []).map(p => p.surveyor_id)])
  const FIELDS = [
    ['regHours', 'regular_hours'], ['otHours', 'overtime_hours'],
    ['regDays', 'regular_days'], ['otDays', 'overtime_days'], ['km', 'km'],
  ]
  const drift = []
  for (const id of ids) {
    const mine = folded.get(id) ?? { regHours: 0, regDays: 0, otHours: 0, otDays: 0, km: 0 }
    const p = (panel.data ?? []).find(x => x.surveyor_id === id)
    for (const [k, col] of FIELDS) {
      if (!near(mine[k], p?.[col])) {
        drift.push(`${p?.name ?? id} ${col}: report ${num(mine[k])}, panel ${num(p?.[col])}`)
      }
    }
  }
  if (drift.length) bad(`${label}: ${drift.length} disagreement(s) — ${drift.slice(0, 6).join(' | ')}`)
  else ok(`${label}: ${ids.size} surveyor(s) reconcile exactly`)
  return lines.data ?? []
}

try {
  // ── Provision three people: a surveyor, an admin, an office user ──────────
  for (const [email, role, name, set] of [
    [surveyorEmail, 'surveyor', 'SMOKE Labour Surveyor', (id) => { surveyorId = id }],
    [adminEmail, 'admin', 'SMOKE Labour Admin', (id) => { adminId = id }],
    [officeEmail, 'office', 'SMOKE Labour Office', (id) => { officeId = id }],
  ]) {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (error) throw new Error(`createUser(${role}): ${error.message}`)
    set(data.user.id)
    const id = data.user.id
    cleanup.push(() => admin.auth.admin.deleteUser(id))
    await admin.from('profiles').update({ full_name: name, role, is_active: true }).eq('id', id)
  }

  // The office user's ONE permission. metrics_labour is visible to a holder of either
  // jobs.monitor.view or jobs.detail.view through the "Read job surveyors" policy
  // (mig 053), and the new RPC must see exactly the same rows — no more, no less.
  const { error: pe } = await admin.from('office_user_permissions')
    .upsert({ profile_id: officeId, permission_key: 'jobs.monitor.view', allowed: true, updated_by: adminId })
  if (pe) throw new Error('grant jobs.monitor.view: ' + pe.message)

  // Jobs cascade to job_surveyors, and job_surveyors cascades to all three logs, so one
  // delete per job removes everything this script wrote. Nothing here is append-only.
  cleanup.push(async () => {
    for (const id of jobIds) {
      const { error } = await admin.from('jobs').delete().eq('id', id)
      if (error) console.log(`  (cleanup warn: job ${id}: ${error.message})`)
    }
  })

  // ── The seven shapes ──────────────────────────────────────────────────────
  // S1 hours, an OT shift crossing midnight
  const s1 = await seedJob('S1', { date: d(3) })
  await logOvertime(s1, { entry_date: d(3), start_time: '19:00', end_time: '03:30', hours: 8.5, note: 'SMOKE overnight' })

  // S2 hours, typed overtime with NO log
  await seedJob('S2', { date: d(5), overtime: 6 })

  // S3 hours, a regular shift logged in the NEXT month (prints there, counts here)
  const s3 = await seedJob('S3', { date: d(9) })
  await logRegular(s3, { entry_date: '2099-04-02', start_time: '08:00', end_time: '17:00', hours: 9, note: 'SMOKE spillover' })

  // S4 hours, typed regular with NO log
  await seedJob('S4', { date: d(11), regular: 7.25 })

  // S5 day-billed: typed days, plus a shift log that is evidence only
  const s5 = await seedJob('S5', { unit: 'days', date: d(14), regular: 3, overtime: 1 })
  await logRegular(s5, { entry_date: d(14), start_time: '07:00', end_time: '19:00', hours: 12, note: 'SMOKE day-billed evidence' })

  // S6 hours, an OT log ENTIRELY outside the window, plus typed overtime that must NOT
  // resurface (metrics_labour's existence test, not a value test)
  const s6 = await seedJob('S6', { date: d(18), overtime: 4 })
  await logOvertime(s6, { entry_date: '2099-06-10', start_time: '18:00', end_time: '22:00', hours: 4, note: 'SMOKE out of window' })

  // S7 a km trip in a different month from its job
  const s7 = await seedJob('S7', { date: d(20) })
  await logKm(s7, { trip_date: '2099-04-04', km: 45, note: 'SMOKE trip' })

  console.log(`Seeded 7 job shapes for ${MONTH}. Acting as an admin:\n`)

  // ── As the admin ──────────────────────────────────────────────────────────
  const boss = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error: bse } = await boss.auth.signInWithPassword({ email: adminEmail, password })
  if (bse) throw new Error('admin sign-in: ' + bse.message)

  const windowed = await assertReconciles(boss, FROM, TO, `reconciliation over ${MONTH}`)
  // The real proof: every row in the database, not just the ones this script wrote.
  await assertReconciles(boss, null, null, 'reconciliation over ALL TIME (live data)')

  const mine = (windowed ?? []).filter(r => r.surveyor_id === surveyorId)
  check({ data: mine }, `the seeded surveyor has shift lines in ${MONTH}`)

  // 4 — no pay column, asserted on the keys
  const PAY_KEYS = ['pay_rate', 'overtime_rate', 'pay_currency', 'regular_pay', 'overtime_pay', 'rate', 'pay', 'amount']
  const keys = mine.length ? Object.keys(mine[0]) : []
  const leaked = keys.filter(k => PAY_KEYS.includes(k))
  if (!keys.length) bad('no rows to inspect for pay columns')
  else if (leaked.length) bad(`labour_shift_lines RETURNS A PAY COLUMN: ${leaked.join(', ')}`)
  else ok(`labour_shift_lines carries no pay column (${keys.length} columns, none of them money)`)

  // 2 — typed quantities still produce a line
  const typedLines = mine.filter(r => r.has_shift_log === false)
  if (typedLines.length >= 3) ok(`typed quantities with no shift log still print (${typedLines.length} lines)`)
  else bad(`typed quantities were dropped — expected at least 3 no-log lines, got ${typedLines.length}`)

  // S6 — an OT log outside the window discards the typed value entirely
  const s6Lines = mine.filter(r => r.job_surveyor_id === s6 && r.kind === 'overtime')
  eq(s6Lines.length, 0, 'a row whose OT log is out of window contributes NO overtime line (typed value not resurrected)')

  // 3 — a day-billed job's shifts print, dated and timed, worth nothing
  const s5Lines = mine.filter(r => r.job_surveyor_id === s5)
  const evidence = s5Lines.filter(r => r.evidence_only === true)
  if (evidence.length === 1 && evidence[0].start_time && near(evidence[0].qty, 0)) {
    ok("a day-billed job's logged shift prints with its date and times, carrying 0")
  } else {
    bad(`day-billed shift log: expected 1 dated evidence line worth 0, got ${JSON.stringify(evidence)}`)
  }
  const s5Typed = s5Lines.filter(r => r.has_shift_log === false)
  const s5Days = s5Typed.reduce((n, r) => n + (r.kind === 'regular' ? num(r.qty) : 0), 0)
  eq(near(s5Days, 3), true, 'the typed day count is still the whole payable quantity on a day-billed job')

  // The two dates, and the rule that separates them
  const s3Line = mine.find(r => r.job_surveyor_id === s3 && r.kind === 'regular' && r.has_shift_log)
  if (!s3Line) bad('a regular shift logged in the next month did not appear on its job\'s month')
  else {
    eq(String(s3Line.line_date).slice(0, 7), '2099-04', 'a spillover regular shift PRINTS on the day it was worked')
    eq(String(s3Line.attribution_date).slice(0, 7), MONTH, 'and is COUNTED on the job month, exactly as metrics_labour does')
  }
  const kmLine = mine.find(r => r.kind === 'km')
  eq(kmLine, undefined, 'a km trip driven in another month does NOT appear in this one (it counts on its trip date)')

  const overnight = mine.find(r => r.job_surveyor_id === s1 && r.kind === 'overtime')
  eq(String(overnight?.line_date ?? '').slice(0, 10), d(3), 'a shift crossing midnight counts wholly on its START day')

  // ── As the surveyor: row scope ────────────────────────────────────────────
  console.log('')
  const sb = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error: se } = await sb.auth.signInWithPassword({ email: surveyorEmail, password })
  if (se) throw new Error('surveyor sign-in: ' + se.message)

  const own = await sb.rpc('labour_shift_lines', { p_from: null, p_to: null })
  if (own.error) bad(`surveyor labour_shift_lines: ${own.error.message}`)
  else if (!own.data?.length) bad('a surveyor sees NONE of their own lines (silently denied)')
  else if (!own.data.every(r => r.surveyor_id === surveyorId)) {
    const others = new Set(own.data.filter(r => r.surveyor_id !== surveyorId).map(r => r.surveyor_id))
    bad(`a surveyor read ${others.size} OTHER surveyor(s)' shift lines`)
  } else ok(`a surveyor sees only their own lines (${own.data.length} rows, all theirs)`)

  // ── As the office user: the new RPC widens nothing ────────────────────────
  const off = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error: oe } = await off.auth.signInWithPassword({ email: officeEmail, password })
  if (oe) throw new Error('office sign-in: ' + oe.message)

  const offLines = await off.rpc('labour_shift_lines', { p_from: FROM, p_to: TO })
  const offPanel = await off.rpc('metrics_labour', { p_from: FROM, p_to: TO })
  if (offLines.error) bad(`office labour_shift_lines: ${offLines.error.message}`)
  else if (offPanel.error) bad(`office metrics_labour: ${offPanel.error.message}`)
  else {
    const linesIds = new Set((offLines.data ?? []).map(r => r.surveyor_id))
    const panelIds = new Set((offPanel.data ?? []).map(r => r.surveyor_id))
    const extra = [...linesIds].filter(id => !panelIds.has(id))
    if (extra.length) bad(`the new RPC shows an office user ${extra.length} surveyor(s) metrics_labour does not`)
    else ok(`an office user with jobs.monitor.view sees the same ${linesIds.size} surveyor(s) through both RPCs`)
    await assertReconciles(off, FROM, TO, 'the office user\'s own view reconciles too')
  }
} catch (err) {
  bad(`unexpected error: ${err.message}`)
} finally {
  for (const c of cleanup.reverse()) { try { await c() } catch (e) { console.log(`  (cleanup warn: ${e.message})`) } }
}

console.log(failures === 0
  ? '\n✓ LABOUR REPORT SMOKE PASS — the sheet adds up to the panel, and carries no pay.'
  : `\n✗ LABOUR REPORT SMOKE FAIL — ${failures} check(s) failed. Do not print a pay run from this.`)
process.exit(failures === 0 ? 0 : 1)
