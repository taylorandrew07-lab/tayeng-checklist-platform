/**
 * Smoke test — the core admin→surveyor→submit flow, against the live database.
 *
 * This is the safety net for the workflow that keeps breaking in subtle ways
 * (silent RLS denials, etc.). It provisions a throwaway surveyor + an
 * admin-created job ASSIGNED to that surveyor, then signs in AS the surveyor and
 * performs every action a surveyor takes to finish a job: open it, answer fields,
 * sign, attach a photo, submit, and advance the workflow. It verifies each step
 * actually persisted (not a silent 0-row denial), then deletes all the test data.
 *
 * Run:  npm run smoke
 * Needs (from .env.local, loaded automatically, or real env vars in CI):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *
 * Exit code 0 = the surveyor flow works end-to-end. Non-zero = something blocks it.
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'

// --- Load .env.local if present (so `npm run smoke` works locally); in CI the
//     vars come straight from the environment and no file is needed. ---
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
const email = `smoke-surveyor-${Date.now()}@tayeng-test.local`
const password = 'Smoke!Test12345'

let userId, jobId, failures = 0
const cleanup = []
const ok = (s) => console.log(`  ✓ ${s}`)
const bad = (s) => { console.log(`  ✗ ${s}`); failures++ }
const check = (r, label) => (r.error || !r.data?.length) ? bad(`${label}: ${r.error?.message ?? '0 rows (silently denied)'}`) : ok(label)

try {
  // --- ADMIN: create an active surveyor + a job the admin assigns to them ---
  const { data: created, error: ce } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (ce) throw new Error('createUser: ' + ce.message)
  userId = created.user.id
  cleanup.push(() => admin.auth.admin.deleteUser(userId))
  await admin.from('profiles').update({ full_name: 'Smoke Surveyor', role: 'surveyor', is_active: true }).eq('id', userId)

  const { data: adminProf } = await admin.from('profiles').select('id').eq('role', 'admin').eq('is_active', true).limit(1).single()
  const { data: tmpls } = await admin.from('checklist_templates')
    .select('id, name, status, sections:template_sections(fields:template_fields(id, field_type))')
    .eq('status', 'active')
  const tmpl = (tmpls ?? []).find(x => (x.sections ?? []).some(s => (s.fields ?? []).length))
  if (!tmpl) throw new Error('no active template with fields to test against')
  const fields = tmpl.sections.flatMap(s => s.fields)
  const textF = fields.find(f => f.field_type === 'text')
  const numF = fields.find(f => f.field_type === 'number')
  const sigF = fields.find(f => f.field_type === 'signature')
  const photoF = fields.find(f => f.field_type === 'photo')

  const { data: job, error: je } = await admin.from('jobs').insert({
    template_id: tmpl.id, title: 'SMOKE TEST JOB - delete me',
    workflow_status: 'assigned', assigned_to: userId, created_by: adminProf?.id ?? userId, surveyor_name: 'Smoke Surveyor',
  }).select('id').single()
  if (je) throw new Error('admin insert job: ' + je.message)
  jobId = job.id
  cleanup.push(async () => {
    await admin.from('job_field_values').delete().eq('job_id', jobId)
    await admin.from('job_signatures').delete().eq('job_id', jobId)
    await admin.from('job_photos').delete().eq('job_id', jobId)
    await admin.from('jobs').delete().eq('id', jobId)
  })
  console.log(`Admin created & assigned a "${tmpl.name}" job to a surveyor. Acting as the surveyor:\n`)

  // --- SURVEYOR: complete the entire job ---
  const sb = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error: se } = await sb.auth.signInWithPassword({ email, password })
  if (se) throw new Error('surveyor signIn: ' + se.message)

  check(await sb.from('jobs').update({ workflow_status: 'in_progress', started_at: new Date().toISOString() }).eq('id', jobId).select('id'), 'open & start the job')

  const answers = []
  if (textF) answers.push({ job_id: jobId, field_id: textF.id, value: 'M.T. Smoke Vessel', value_array: null })
  if (numF) answers.push({ job_id: jobId, field_id: numF.id, value: '1234', value_array: null })
  // Repeatable sections (migration 094) moved the unique key to (job_id, field_id,
  // instance); instance defaults to 0. The upsert arbiter must match that constraint.
  if (answers.length) check(await sb.from('job_field_values').upsert(answers, { onConflict: 'job_id,field_id,instance' }).select('field_id'), `save ${answers.length} answer(s)`)

  if (sigF) check(await sb.from('job_signatures').upsert({ job_id: jobId, field_id: sigF.id, signature_data: 'data:image/png;base64,iVBORw0KGgo=', signed_at: new Date().toISOString() }, { onConflict: 'job_id,field_id,instance' }).select('id'), 'capture a signature')

  check(await sb.from('job_photos').insert({ job_id: jobId, field_id: photoF?.id ?? null, storage_path: `${jobId}/smoke.jpg`, filename: 'smoke.jpg', uploaded_by: userId }).select('id'), 'attach a photo')

  check(await sb.from('jobs').update({ submitted_at: new Date().toISOString() }).eq('id', jobId).select('id'), 'SUBMIT (set submitted_at)')

  check(await sb.from('jobs').update({ workflow_status: 'report_ready' }).eq('id', jobId)
    .not('workflow_status', 'in', '(report_ready,approved,invoiced,sent,paid,closed)').select('id'), 'advance workflow to report_ready')

  const { data: fin } = await admin.from('jobs').select('submitted_at, workflow_status').eq('id', jobId).single()
  if (!fin?.submitted_at || fin.workflow_status !== 'report_ready') bad(`final state wrong: ${JSON.stringify(fin)}`)
} catch (err) {
  bad(`unexpected error: ${err.message}`)
} finally {
  for (const c of cleanup.reverse()) { try { await c() } catch (e) { console.log(`  (cleanup warn: ${e.message})`) } }
}

console.log(failures === 0
  ? '\n✓ SMOKE PASS — a surveyor can complete & submit an admin-assigned job end-to-end.'
  : `\n✗ SMOKE FAIL — ${failures} step(s) blocked. The core surveyor flow is broken; investigate before shipping.`)
process.exit(failures === 0 ? 0 : 1)
