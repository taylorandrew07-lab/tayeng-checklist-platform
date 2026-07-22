# P0 — `jobs.status` → `workflow_status` unification (dependency map)

> **SUPERSEDED (migration 145).** This document describes the 9-stage lifecycle
> (`new → assigned → in_progress → report_ready → approved → invoiced → sent →
> paid → closed`). That has since been collapsed to **four** stages:
> `in_progress → report_ready → invoice_ready → closed`, where `closed` is stamped
> by **creating an invoice** and is what locks surveyor edits. Deleting the invoice
> reverts the job to `invoice_ready`. Payment is no longer tracked on the job.
> Kept for the historical dependency map only — the stage names below are stale.

Goal: make **`workflow_status`** the single visible job lifecycle and retire the
legacy checklist **`status`** column, without breaking RLS, triggers, the
calendar, offline sync, or the client PDF gate.

Rollout is **expand → contract**, three steps:

- **P0a (additive, done — migration `054`)** — a trigger keeps `workflow_status`
  in sync with `status` monotonically + a one-time backfill. Nothing reads/drops
  differently yet. Safe to run anytime, independent of the app deploy.
- **P0b-code (this wave + follow-ups)** — every app read of `jobs.status` moves to
  `workflow_status`; writes that exist only to drive status become redundant
  (the trigger derives it). Ship and bake in while the column still exists.
- **P0b-db (last, destructive)** — rewrite the SQL objects below onto
  `workflow_status`, then `DROP COLUMN status`. Run only after the code above is
  live, a backup/PITR is verified, and `job_id,status` is snapshotted.

> The legacy values are: `draft · assigned · in_progress · submitted · completed ·
> client_visible · archived`. Mapping to workflow: in_progress→`in_progress`;
> submitted/completed/client_visible→`report_ready`; draft/assigned→(no advance,
> stays `new`/`assigned`); archived→handled at drop time (see calendar RPC).

---

## A. Writers of `jobs.status` (app code)

| Where | What it writes | P0b action |
| --- | --- | --- |
| `src/lib/offline/sync.ts:54` (offline create) | `status:'in_progress'` on the upsert | Keep (checklist fact). Trigger 054 now derives `workflow_status='in_progress'` — no client workflow write needed. |
| `src/lib/offline/sync.ts:168` (offline submit) | `status:'submitted', submitted_at` | Keep `submitted_at` as the lock/submitted fact. Trigger 054 derives `workflow_status='report_ready'`. |
| `src/components/job/JobChecklistEditor.tsx` (online submit) | sets `status` + calls `advanceWorkflowTo('report_ready')` | Once column drops, drop the `status` write; keep `submitted_at` + `advanceWorkflowTo`. |
| `src/app/(dashboard)/admin/jobs/[id]/page.tsx` (edit form `editForm.status`) | admin can set `status` | Replace the legacy-status dropdown with the workflow control (P2 job-detail rework). |

## B. Readers / gates on `jobs.status`

| Where | Use | P0b action |
| --- | --- | --- |
| `src/lib/offline/sync.ts:8,79` (`LOCKED` list) | refuse to overwrite a submitted/locked job | Re-base lock on `submitted_at` (presence) rather than `status` membership. |
| `src/app/api/pdf/[jobId]/route.ts` | client PDF gating on `status IN (submitted/completed/client_visible)` | Gate on `client_job_permissions.can_view_pdf` + `submitted_at`/workflow, **not** a `client_visible` stage. |
| `src/app/(dashboard)/admin/jobs/[id]/page.tsx:212` | "Download PDF" shown for submitted/completed/client_visible | Switch to workflow ≥ `report_ready`. |
| `src/lib/jobs/tracker.ts` (`TrackerRow.status`, listJobTrackerRows) | carries `status` alongside `workflow_status` | Drop the `status` field from the row once nothing reads it. |
| Dashboards: `surveyor/page.tsx`, `office/page.tsx`, `admin/page.tsx`, `client/page.tsx` | status-based counts/labels | Move counts onto `workflow_status` (overlaps P1 metrics merge). |
| `src/lib/utils/index.ts` (`getJobStatusLabel/Color`), `src/components/job/StatusPill.tsx` | legacy status → label/colour | Keep for history if needed; prefer `WORKFLOW`/`WorkflowPill`. |
| `src/lib/types/database.ts` | `Job.status` type | Remove after column drop; regenerate types. |

## C. Database objects referencing `jobs.status` (rewrite in P0b-db)

| Object | File | Rewrite |
| --- | --- | --- |
| Surveyor INSERT RLS (`status IN ('draft','assigned','in_progress')`) | `053_rls_initplan.sql:134` | Re-express on `workflow_status` (`new/assigned/in_progress`) or drop the status clause. |
| `enforce_surveyor_job_update` (status forward-only to in_progress/submitted) | `020_security_hardening_2.sql:35` | Already also guards via `enforce_job_admin_columns` on `workflow_status` (049). Drop the `status` clause. |
| `get_calendar_jobs` (`j.status::text <> 'archived'`) | `040_calendar_jobs_fallback.sql:18,24` | Return/filter on `workflow_status`; decide archived handling (no `archived` stage exists — likely `<> 'closed'` or a soft-archive flag). |
| `jobs_sync_workflow` trigger (added in 054) | `054_workflow_status_sync.sql` | Remove once `status` is gone (its whole job is bridging the two). |

## D. P0b drop (destructive — last)

```sql
-- only after: code live reading workflow_status, backup/PITR verified,
-- and a snapshot of job_id,status saved in a non-exposed schema.
ALTER TABLE public.jobs DROP COLUMN status;     -- no CASCADE
-- + drop jobs_sync_workflow trigger & helpers if no longer needed
-- + regenerate TypeScript types
```

> Before P0b, re-run a fresh `rg "\.status\b"` over `src/` scoped to job contexts —
> this table is the known set as of migration 054, not a substitute for that sweep.
