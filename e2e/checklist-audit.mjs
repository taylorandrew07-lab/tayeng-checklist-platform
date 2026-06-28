/**
 * Checklist & report usage audit (read-only, against the LIVE database).
 * Surfaces "double entries between the setup and the data" and structural issues:
 *   - fields that re-capture job-level metadata (vessel / client / surveyor / date)
 *     → the surveyor types what the job already knows, and it can print twice
 *   - duplicate field labels within a template
 *   - duplicate item numbers
 *   - calc-formula / conditional-logic references to fields that don't exist
 *   - job_field_values / job_photos that are orphaned or belong to a DIFFERENT
 *     template than the job (stale data from a setup change)
 *   - submitted jobs with no captured data
 *
 * Run:  node e2e/checklist-audit.mjs    (needs the same .env.local as the smoke test)
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'

const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, SR = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !SR) { console.error('✗ Missing env'); process.exit(2) }
const db = createClient(URL, SR, { auth: { persistSession: false } })

// Labels that mirror data the JOB already carries (so a field for them = double entry).
// Descriptor fields ("Vessel IMO/Type/Port…") are NOT names, so excluded.
const NON_NAME = /(type|imo|flag|owner|call ?sign|grt|nrt|dwt|length|beam|draft|draught|year|built|class|port|registry|number|no\.|gross|net|tonnage|loa)/i
const META = [
  { key: 'vessel_name', label: 'job.vessel_name', test: l => /vessel/i.test(l) && !NON_NAME.test(l) && !/bunker/i.test(l) },
  { key: 'client',      label: 'job.client',      test: l => /^client\b|client name|commissioning (company|party)/i.test(l) },
  { key: 'surveyor',    label: 'job.surveyor',    test: l => /\bsurveyor\b|attended by|inspected by/i.test(l) },
  { key: 'date',        label: 'job.scheduled_date', test: l => /date of survey|survey date|^date$|date of inspection|conducted on/i.test(l) },
]
const norm = s => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

const main = async () => {
  const [tpls, secs, flds, jobs, vals, photos] = await Promise.all([
    db.from('checklist_templates').select('id, name, status'),
    db.from('template_sections').select('id, template_id, title, is_repeatable, order_index'),
    db.from('template_fields').select('id, template_id, section_id, label, field_type, item_number, calculation_formula, conditional_logic, show_in_header'),
    db.from('jobs').select('id, template_id, report_number, title, submitted_at'),
    db.from('job_field_values').select('job_id, field_id'),
    db.from('job_photos').select('job_id, field_id'),
  ]).then(rs => rs.map(r => r.data ?? []))

  const fieldsByTpl = new Map(), fieldById = new Map()
  for (const f of flds) { fieldById.set(f.id, f); (fieldsByTpl.get(f.template_id) ?? fieldsByTpl.set(f.template_id, []).get(f.template_id)).push(f) }
  const allFieldIds = new Set(flds.map(f => f.id))
  const jobById = new Map(jobs.map(j => [j.id, j]))

  console.log(`\n=== TEMPLATES (${tpls.length}) ===`)
  for (const t of tpls.sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || a.name.localeCompare(b.name))) {
    const tf = fieldsByTpl.get(t.id) ?? []
    const jobCount = jobs.filter(j => j.template_id === t.id).length
    console.log(`\n• ${t.name}  [${t.status}]  — ${tf.length} fields, ${jobCount} jobs`)

    // Double-entry: fields re-capturing job metadata
    const meta = tf.filter(f => ['text', 'client_select', 'date'].includes(f.field_type) && META.some(m => m.test(f.label)))
    for (const f of meta) {
      const m = META.find(x => x.test(f.label))
      console.log(`    ⚠ DOUBLE-ENTRY: "${f.label}" duplicates ${m.label}${f.show_in_header ? ' (show_in_header)' : ''}`)
    }
    // Duplicate labels within the template
    const byLabel = new Map(); for (const f of tf) byLabel.set(norm(f.label), (byLabel.get(norm(f.label)) ?? 0) + 1)
    for (const [lbl, n] of byLabel) if (n > 1 && lbl) console.log(`    ⚠ DUPLICATE field label ×${n}: "${lbl}"`)
    // Duplicate item numbers
    const byNum = new Map(); for (const f of tf) if (f.item_number) byNum.set(f.item_number, (byNum.get(f.item_number) ?? 0) + 1)
    for (const [n, c] of byNum) if (c > 1) console.log(`    ⚠ DUPLICATE item_number ×${c}: "${n}"`)
    // Broken calc / conditional references
    const ownIds = new Set(tf.map(f => f.id))
    for (const f of tf) {
      if (f.calculation_formula) for (const id of [...f.calculation_formula.matchAll(/\{([^}]+)\}/g)].map(m => m[1])) if (!ownIds.has(id)) console.log(`    ⚠ "${f.label}" calc references missing field ${id}`)
      const cl = f.conditional_logic
      const conds = cl && typeof cl === 'object' ? (cl.conditions ?? []) : []
      for (const c of conds) if (c.field_id && !ownIds.has(c.field_id)) console.log(`    ⚠ "${f.label}" condition references missing field ${c.field_id}`)
    }
    if (tf.length === 0 && t.status === 'active') console.log('    ⚠ active template has NO fields')
  }

  // ── Data integrity across jobs ──
  console.log(`\n=== DATA (${vals.length} values, ${photos.length} photos across ${jobs.length} jobs) ===`)
  let orphanVals = 0, crossVals = 0, orphanPhotos = 0, crossPhotos = 0
  const crossExamples = []
  for (const v of vals) {
    if (!v.field_id) continue
    const f = fieldById.get(v.field_id), job = jobById.get(v.job_id)
    if (!f) { orphanVals++; continue }
    if (job && job.template_id && f.template_id !== job.template_id) { crossVals++; if (crossExamples.length < 5) crossExamples.push(`value field "${f.label}" (tpl ${f.template_id?.slice(0,8)}) on job ${job.report_number ?? v.job_id.slice(0,8)} (tpl ${job.template_id.slice(0,8)})`) }
  }
  for (const p of photos) {
    if (!p.field_id) continue
    const f = fieldById.get(p.field_id), job = jobById.get(p.job_id)
    if (!f) { orphanPhotos++; continue }
    if (job && job.template_id && f.template_id !== job.template_id) crossPhotos++
  }
  console.log(`  orphaned values (field deleted): ${orphanVals}`)
  console.log(`  cross-template values (field belongs to a different template than the job): ${crossVals}`)
  crossExamples.forEach(e => console.log(`      e.g. ${e}`))
  console.log(`  orphaned photos: ${orphanPhotos}   cross-template photos: ${crossPhotos}`)

  // Submitted jobs with zero captured values
  const valJobIds = new Set(vals.map(v => v.job_id))
  const emptySubmitted = jobs.filter(j => j.submitted_at && j.template_id && !valJobIds.has(j.id))
  console.log(`  submitted jobs with NO field values: ${emptySubmitted.length}${emptySubmitted.length ? ' → ' + emptySubmitted.slice(0,8).map(j => j.report_number ?? j.id.slice(0,8)).join(', ') : ''}`)

  console.log('\n(audit complete — ⚠ lines are candidates to review, not necessarily wrong)')
}
main().catch(e => { console.error('✗', e.message); process.exit(1) })
