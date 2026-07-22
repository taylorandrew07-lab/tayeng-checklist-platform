/**
 * Analytics parity check — proves migration 107's metrics_analytics() RPC returns
 * the SAME numbers the old in-browser computation produced, over the LIVE data.
 *
 * It runs the RPC and, separately, replicates the original getAnalyticsClient math
 * (KPIs / by-type / top-clients) from the raw rows, then compares field-by-field.
 * thisMonth uses the company TZ (America/Port_of_Spain) on both sides to match the RPC.
 *
 * Run:  node e2e/analytics-parity.mjs      (needs the same .env.local as the smoke test)
 * Exit 0 = numbers match. Non-zero = a discrepancy to look at.
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
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !SR) { console.error('✗ Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(2) }

const db = createClient(URL, SR, { auth: { persistSession: false } })
let fails = 0
const eq = (label, a, b) => {
  const A = JSON.stringify(a), B = JSON.stringify(b)
  if (A === B) { console.log(`  ✓ ${label}: ${A}`) }
  else { console.log(`  ✗ ${label}\n      RPC: ${A}\n      JS : ${B}`); fails++ }
}

const monthTT = (iso, dateOnly) => dateOnly
  ? iso.slice(0, 7)
  : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Port_of_Spain', year: 'numeric', month: '2-digit' }).format(new Date(iso))

const run = async () => {
  const [{ data: rpc, error: rpcErr }, { data: jobs }, { data: invoices }] = await Promise.all([
    db.rpc('metrics_analytics', { p_months_back: 12 }),
    db.from('jobs').select('id, job_type, client_id, workflow_status, is_overtime, scheduled_date, created_at, client:clients(name)'),
    db.from('invoices').select('job_id, client_id, status, total, currency'),
  ])
  if (rpcErr || !rpc) { console.error('✗ RPC failed:', rpcErr?.message ?? 'no data'); process.exit(1) }

  const allJobs = jobs ?? [], allInv = invoices ?? []
  const today = new Date().toISOString().slice(0, 10)
  const curMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Port_of_Spain', year: 'numeric', month: '2-digit' }).format(new Date())
  const invByJob = new Set(allInv.filter(i => i.job_id).map(i => i.job_id))

  // ── JS replication of the comparable fields ──
  const js = {
    totalJobs: allJobs.length,
    openJobs: allJobs.filter(j => j.workflow_status !== 'closed').length,
    thisMonth: allJobs.filter(j => monthTT(j.scheduled_date ?? j.created_at, !!j.scheduled_date) === curMonth).length,
    awaitingInvoice: allJobs.filter(j => j.workflow_status === 'invoice_ready' && !invByJob.has(j.id)).length,
    otJobs: allJobs.filter(j => j.is_overtime).length,
  }
  const typeCount = new Map()
  for (const j of allJobs) { const t = j.job_type || 'Unspecified'; typeCount.set(t, (typeCount.get(t) ?? 0) + 1) }
  const jsByType = [...typeCount.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))

  const jc = new Map(), rev = new Map()
  for (const j of allJobs) if (j.client_id) jc.set(j.client_id, (jc.get(j.client_id) ?? 0) + 1)
  for (const i of allInv) { if (i.status === 'void' || !i.client_id) continue; const m = rev.get(i.client_id) ?? new Map(); m.set(i.currency, (m.get(i.currency) ?? 0) + Number(i.total ?? 0)); rev.set(i.client_id, m) }
  const jsTop = [...jc.entries()].map(([id, jobs]) => ({ id, jobs, rev: Object.fromEntries([...(rev.get(id)?.entries() ?? [])].sort()) })).sort((a, b) => b.jobs - a.jobs)

  // ── Compare ──
  console.log(`Comparing over ${allJobs.length} jobs / ${allInv.length} invoices …\n`)
  const k = rpc.kpis ?? {}
  eq('totalJobs', k.totalJobs, js.totalJobs)
  eq('openJobs', k.openJobs, js.openJobs)
  eq('thisMonth', k.thisMonth, js.thisMonth)
  eq('awaitingInvoice', k.awaitingInvoice, js.awaitingInvoice)
  eq('otJobs', k.otJobs, js.otJobs)

  const rpcByType = [...(rpc.byType ?? [])].sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
  eq('byType', rpcByType, jsByType)

  const rpcTop = [...(rpc.topClients ?? [])].map(c => ({ id: c.client_id, jobs: c.jobs, rev: Object.fromEntries((c.revenue ?? []).map(r => [r.currency, Number(r.amount)]).sort()) })).sort((a, b) => b.jobs - a.jobs)
  eq('topClients (jobs+revenue)', rpcTop, jsTop)

  console.log(fails === 0 ? '\n✓ PARITY OK — the Analytics RPC matches the old computation.' : `\n✗ ${fails} field(s) differ — investigate above.`)
  process.exit(fails === 0 ? 0 : 1)
}
run().catch(e => { console.error('✗ error:', e.message); process.exit(1) })
