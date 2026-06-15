# Diagnose & Fix — Dynamic question labels showing raw {uuid} + duplicated text

Tayeng App (Next.js 16 App Router + React 19 + TS + Supabase). Read HANDOFF.md. Migrations are hand-run by the user; never apply them. Build is `next build --webpack`.

## Symptom
In the surveyor checklist editor, some question labels render like:
"Initial manual sounding of Initial manual sounding of {0c9d0759-be2e-4b57-8878-201925b7791b}"
The text is DUPLICATED and a raw {uuid} token is shown. The token is a dynamic-label placeholder that should resolve to the selected "Method of Delivery" (road tanker / wagon / bunker vessel / shore tank).

## Confirmed root cause #1 (code bug — fix this)
Three copies of the label-token resolver exist:
- src/lib/pdf/JobPDF.tsx (resolvePdfLabel, ~line 205): `if (!val) return ''`  CORRECT
- src/app/(dashboard)/client/jobs/[id]/page.tsx (resolveLabel, ~line 13): `if (!val) return ''`  CORRECT
- src/components/job/JobChecklistEditor.tsx (resolveLabel, ~line 735): `if (!val) return label.match(/\{[0-9a-f-]{36}\}/gi)?.length === 1 ? label : ''`  BUG
The editor version returns the ENTIRE `label` from inside the `.replace()` callback when the referenced field is empty, concatenating the whole label back in -> duplicated text + leftover raw token.

Fix: in JobChecklistEditor's resolveLabel, the `!val` branch must NOT return `label`. Pick ONE consistent behaviour:
- Option A (match PDF/client): return '' (clean but leaves a dangling "... of ").
- Option B (recommended for editor): resolve to a placeholder from the SOURCE field's label, e.g. allFieldsFlat.find(f => f.id === fieldId) and return `[${srcField.label}]` (reads "Initial manual sounding of [Method of Delivery]" until selected); fall back to '' if not found.
Never return the full `label` from inside .replace. Leave the dropdown / useFieldId resolution paths unchanged.

## Investigate root cause #2 (data / template-save — confirm before concluding)
Determine WHY the value is empty. Read-only checks (user pastes into Supabase SQL editor; do NOT write migrations):
1. `select id, label, field_type from template_fields where id = '0c9d0759-be2e-4b57-8878-201925b7791b';`
   - Returns the Method-of-Delivery dropdown -> token VALID; problem is only code bug #1 (value not selected yet).
   - Returns NOTHING -> token ORPHANED: the field UUID changed (likely a template re-save regenerated ids). This is the real "what changed recently".
2. `select id, label from template_fields where label ilike '%{0c9d0759-be2e-4b57-8878-201925b7791b}%';`
3. `select id, label, options from template_fields where template_id = '<TEMPLATE_ID>' and field_type = 'dropdown';`  (find the road tanker/wagon/bunker/shore tank dropdown's current id)
4. `select field_id, value from job_field_values where job_id = '<JOB_ID>' and field_id = '0c9d0759-be2e-4b57-8878-201925b7791b';`

If #2 confirmed (orphaned token), ALSO:
- Audit the template-save path (TemplateBuilder save -> bulk-upsert logic). Confirm whether re-saving an existing template PRESERVES each field's id or regenerates it. Regenerating ids orphans (a) {uuid} label tokens, (b) conditional_logic.field_id refs, (c) useFieldId option refs. Report exactly where ids are (re)generated. Propose preserving existing field ids on update, but do NOT implement the save change until I confirm (high risk).
- Provide a SAFE data-repair plan to re-point orphaned {old_uuid} tokens in labels to the current delivery-method field id. Present as SQL for me to run; do not run it.

## Deliverables
- Fix code bug #1 in JobChecklistEditor resolveLabel (low risk, ship it).
- A short written diagnosis: is root cause #2 present? Back it with query results, plus recommended fix + repair plan for my approval.
- Gates: npx tsc --noEmit, npm run lint (0 errors), npm test, npm run build. No PR unless asked. Do not run migrations or data repairs without my go-ahead.
