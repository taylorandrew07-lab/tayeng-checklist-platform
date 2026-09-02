# Root-Cause Hardening Loop — converge the linked checklist defects to one fix

You run on a repeating loop with ONE mission: find and fix the COMMON ORIGIN behind three linked production defects, then stop. Do one safe step per run, log evidence, and converge. Do not churn — when the mission is complete, verify no regressions and stop.

## The three linked defects (likely one root cause)
1. Dynamic question labels render a raw {uuid} + duplicated text (see docs/PROMPT-dynamic-label-bug.md).
2. Surveyors' Submit silently does nothing — job never reaches 'submitted' (docs/PROMPT-submit-download-broken.md).
3. PDF report download fails (403 / inline-open) (docs/PROMPT-pdf-share-mobile.md + submit-download doc).

## Working hypothesis (prove or disprove with evidence)
- ORIGIN A — Template re-save regenerates field UUIDs: the bulk-upsert template save assigns NEW ids to existing fields on re-save, orphaning (a) {uuid} label tokens, (b) conditional_logic.field_id refs, (c) FieldOption.useFieldId refs. This breaks dynamic labels AND can make hidden required fields evaluate as visible+missing (blocking submit).
- ORIGIN B — Job assignment doesn't set jobs.assigned_to: jobs assigned to a surveyor by NAME (surveyor_name) leave assigned_to null/different. The editor (JobChecklistEditor.tsx:710-714) lets the creator edit anyway, but the jobs UPDATE RLS (migration 002: assigned_to = auth.uid()) and the PDF route (api/pdf/[jobId]/route.ts:35: job.assigned_to === user.id) both require assigned_to = the surveyor. So edit looks fine but submit (silent 0-row denial) and download (403) fail.
Net: app-level "can edit" diverges from DB/route "can write/read". Consolidating fix = make field ids stable across saves AND make the UI, RLS, and PDF route agree on who may act.

## Memory + human handoff: docs/ROOT-CAUSE-HARDENING.md (create if missing)
Sections: `## Plan` (the checklist below with status per step), `## Evidence` (code findings file:line + SQL results), `## NEEDS FROM HUMAN` (exact SQL to run / decisions), `## Done` (commits), `## Proposed migrations` (for human to hand-run).
EVERY run: read this file first, plus HANDOFF.md and the three PROMPT-*.md docs. Continue the plan; never repeat a completed step.

## The convergence plan (work the lowest-numbered OPEN step you can make progress on)
S1. AUDIT template-save id stability (read-only). In the TemplateBuilder save path (the bulk-upsert logic), determine whether re-saving an EXISTING template preserves each field's `id` or regenerates it. Record exact file:line and verdict in `## Evidence`. (Code reading only — no change yet.)
S2. AUDIT assignment path (read-only). Find where jobs are created/assigned (admin + surveyor flows) and whether jobs.assigned_to is set to the surveyor's profile id when a surveyor_name is linked (surveyor_names.profile_id). Record file:line + verdict.
S3. WRITE the exact diagnostic SQL into `## NEEDS FROM HUMAN` (token id exists? assigned_to vs surveyor id? live pg_policies on jobs? get_my_role() body?) and STOP that thread until the human pastes results into `## Evidence`. Use results when present.
S4. LOW-RISK CODE FIX — loud failures: make the submit update use `.select('id')` and treat 0 rows as a clear user error (no fake "submitted" navigation). Same 0-row guard on the status->'in_progress' update. Gate + commit.
S5. LOW-RISK CODE FIX — label resolver: fix JobChecklistEditor.tsx resolveLabel so the `!val` branch never returns the whole `label` (kills the duplication). Keep PDF/client resolvers consistent. Gate + commit.
S6. PROPOSE (do not apply) — field-id stability: if S1 shows ids regenerate, write the fix (preserve existing field ids on update) + a SAFE data-repair to re-point orphaned {uuid}/conditional_logic/useFieldId refs, into `## Proposed migrations`. This is a RISK RAIL — propose + stop.
S7. PROPOSE or LOW-RISK — auth alignment: once S2/S3 confirm origin B, choose with the human: (a) assignment always sets assigned_to (data/flow fix + backfill — propose), or (b) broaden surveyor jobs SELECT/UPDATE policy AND the PDF route surveyor check to also allow created_by = auth.uid() (RLS change = propose; route change = low-risk code, mirror the predicate). Make UI, RLS, and route IDENTICAL.
S8. VERIFY: confirm submit + download now work for a self-created job and an admin/name-assigned job. Note residual risks. When S1-S7 are Done/Proposed and S8 passes, write "ROOT-CAUSE PASS COMPLETE" in `## Plan` and stop taking new work.

## Conventions & RISK RAILS
- Read HANDOFF.md. Build is `next build --webpack`. Gates before any commit: `npx tsc --noEmit`, `npm run lint` (0 errors), `npm test`, `npm run build`. Fail -> revert + log.
- Push to main only after gates pass. One concern per commit. No PR unless asked.
- NEVER apply migrations or change RLS/SECURITY DEFINER/auth/proxy/offline-sync/template-save id logic on your own — write a proposal in `## Proposed migrations` and STOP. Verify live DB via pg_policies/pg_proc; never trust the applied-migrations list (migration 032 proved it wrong).
- UI tightening to match RLS is low-risk and OK; loosening security is always a proposal.

## Each run output (3-6 lines)
Which step you advanced, what you changed/committed (hash) or proposed, gate results, and what you now NEED from the human. If complete: say so and stop.
