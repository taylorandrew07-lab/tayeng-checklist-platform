# Diagnose & Fix — Checklist won't submit; PDF won't download (mobile + Windows)

Tayeng App (Next.js 16 App Router + React 19 + TS + Supabase). Read HANDOFF.md. Migrations are HAND-RUN by the user — write idempotent numbered SQL; never apply it. NOTE: migration 032 proved the "which migrations are live" tracking is UNRELIABLE. Verify live DB state with pg_policies / pg_proc; do not trust HANDOFF's applied list.

## Symptoms (production)
- Surveyors click Submit and the checklist does not submit (mobile AND Windows).
- PDF reports won't download (mobile opens inline; Windows reportedly failing too).

## STEP 0 — Capture the exact failure first (do not skip)
For a REAL affected job + surveyor:
- Does Submit show an error toast, or silently navigate away with the job still "in progress"?
- Console + Network tab on submit: the `PATCH /rest/v1/jobs?id=...` response (status, body, row count).
- For download: the `GET /api/pdf/<jobId>` HTTP status (200 vs 401/403); is the body a PDF or a JSON error?

## PRIMARY HYPOTHESIS — `assigned_to` mismatch breaks BOTH features
Submit and download both require the job's `assigned_to` to equal the surveyor's user id:
- Submit RLS (migration 002, "Surveyors can update own jobs"): USING/WITH CHECK = get_my_role()='surveyor' AND assigned_to = auth.uid(). A failing USING clause = SILENT 0-row update, NO error.
- PDF route (src/app/api/pdf/[jobId]/route.ts:35): surveyor canAccess = job.assigned_to === user.id; also requires profile.is_active===true (line 24).
- BUT the editor (src/components/job/JobChecklistEditor.tsx:710-714) also lets the CREATOR of an unassigned job edit — looser than RLS — so the job looks editable yet can't be submitted/downloaded.

Confirm with read-only SQL (user runs in Supabase; replace ids):
1. select id, status, created_by, assigned_to, surveyor_name from jobs where id = '<JOB_ID>';  -- assigned_to == surveyor id? NULL/different => confirmed
2. select id, role, is_active from profiles where id = '<SURVEYOR_ID>';  -- role='surveyor', is_active=true?
3. select polname, qual, with_check from pg_policies where tablename='jobs';
4. select prosrc from pg_proc where proname='get_my_role';
5. select tgname from pg_trigger where tgrelid='public.jobs'::regclass;  -- enforce_surveyor_job_update (020) allows surveyor status -> in_progress/submitted

## FIX 1 — Make silent failures LOUD (safe, ship regardless of root cause)
In handleSubmit (~line 563), make the update RETURN rows and treat 0 rows as an error:
  const { data, error } = await withTimeout(
    supabase.from('jobs').update({ status:'submitted', submitted_at:new Date().toISOString() }).eq('id', jobId).select('id'),
    10_000, 'Submitting checklist')
  if (error) { ...existing... }
  if (!data || data.length === 0) { setSubmitError("Submit was blocked — this job may not be assigned to you. Contact an admin."); setSaveError(same); return }
Apply the same 0-row guard to the status->'in_progress' update (~line 370). This turns invisible RLS denials into clear messages and stops the false "submitted" navigation.

## FIX 2 — Resolve the assigned_to / permission mismatch (CONFIRM approach before migrating)
If SQL confirms jobs assigned by name without assigned_to, choose ONE (ask me first):
- (a) Data/flow fix: assignment ALWAYS sets jobs.assigned_to to the surveyor's profile id (when surveyor_names.profile_id is linked). Backfill affected jobs. Keep RLS strict.
- (b) Policy fix: broaden surveyor jobs SELECT/UPDATE policies AND the PDF route surveyor check to also allow created_by = auth.uid(), matching the editor. Security-review it.
Make the editor's "can edit" rule and the DB's "can update"/"can download" rules IDENTICAL so this can't recur.

## FIX 3 — Download on mobile + Windows
- Apply the Web Share / blob-download helper from docs/PROMPT-pdf-share-mobile.md: replace every window.open('/api/pdf/...') and the client <a href target=_blank> with fetch -> Blob -> share-or-download. Fixes mobile inline-open AND surfaces 401/403 as a real error instead of a JSON page.
- Confirm /api/pdf/<jobId> returns 200 for an active surveyor on a job that passes FIX 2; if still 403, give the route's surveyor branch the same predicate as FIX 2.

## STEP — Rule out the validation path
Verify a blocked submit isn't "Required fields not completed". If it is, it's tied to the field-id/conditional-logic regression in docs/PROMPT-dynamic-label-bug.md (orphaned {uuid} field ids make hidden required fields evaluate visible+missing). Fix that root cause; don't suppress the message.

## Deliverables
- Step-0 findings + SQL results confirming/denying the assigned_to hypothesis.
- FIX 1 shipped (loud failures). FIX 2 approach proposed for sign-off (+ hand-run migration if needed). FIX 3 download fix. Validation path confirmed.
- Test matrix: submit + download as a surveyor on iPhone Safari + Android Chrome + Windows Chrome/Edge, for (i) a self-created job and (ii) an admin-assigned job. Both must work.
- Gates: npx tsc --noEmit, npm run lint (0 errors), npm test, npm run build. No PR unless asked; don't run migrations/data fixes without my go-ahead.
