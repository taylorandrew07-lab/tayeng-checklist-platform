# CLAUDE.md — Taylor Engineering Checklist Platform

The internal operations platform for Taylor Engineering, a marine-survey firm in Trinidad.
Surveyors run vessel inspections from checklists on phones (offline, dockside, flaky wifi);
admins run jobs → reports → invoices behind them.

Next.js 16 (App Router, React 19, TS) · Supabase (Postgres/Auth/Storage/RLS) · Tailwind v3 ·
Vercel · Vitest. Offline-first PWA. Roles: `admin` / `surveyor` / `office` / `client`.

---

## Things that will burn you

- **The build must stay `next build --webpack`.** Next 16's default Turbopack build fails
  collecting route-group pages. Pinned in `package.json` and `vercel.json`. Don't "clean it up."
- **Never `eval`/`new Function` in client code.** The CSP forbids `unsafe-eval`; it fails
  *silently* into a caught exception. Calculated checklist fields broke this way once — the
  safe parser is `evaluateCalculation` in `lib/utils/index.ts`.
- **Never sum hours and days.** A job is billed by the hour *or* the day (`jobs.labour_unit`,
  mig 148). The RPCs return them as separate columns for that reason. All unit-aware wording
  lives in `lib/jobs/labourUnit.ts`.
- **`messages.body` is plain text.** The inbox renders `{detail.body}` inside
  `whitespace-pre-wrap`, so HTML shows up as literal tags. The HTML in `/api/messages/send`
  is for the *email* only.
- **RLS cannot hide columns.** A sensitive field on a broadly-readable table is readable by
  everyone who can read the row. Put it in an admin/owner-only sibling table instead —
  `client_billing` (mig 077), `staff_private` (mig 130).
- **A `LANGUAGE sql` function that reads a table created later in the same migration** aborts
  the whole file and rolls it back (buckets never created → "Bucket not found"). Add
  `SET check_function_bodies = off`.
- **Cross-role pages must be in `SHARED_ROUTES`** (`src/app/(dashboard)/layout.tsx:145`) or
  users get bounced to their own role's home.
- **An installed iPhone app cannot download. At all.** In an iOS PWA (`display: standalone`
  — which is what our surveyors run) there is no download manager, so
  `Content-Disposition: attachment` has no consumer, `<a download>` on a blob is inert, and
  navigating to a file renders it chrome-less with no share button. `navigator.share({files})`
  is the **only** way a file leaves the app — and it doubles as "save", because the iOS sheet's
  first row is Save to Files. Never label a control that opens a URL "Download". Ask
  `isIosStandalone()` (`lib/pdf/deliver.ts`); it is deliberately AND-ed with an iOS test because
  installed Android and desktop PWAs match `display-mode: standalone` too and download fine.
- **A file must exist before the gesture that shares it.** `navigator.share` and
  `showSaveFilePicker` need an unspent user gesture, so anything that awaits a render or a fetch
  and *then* shares has already lost it. That's why the job PDF is two taps on mobile:
  `fetchJobPdfFile()` then `shareFile()`. Delivery functions **throw** rather than return `void` —
  a silently-resolving delivery is how the iPhone bug hid for months.
- **Don't trust "it submitted" as proof it saved.** On flaky mobile the request may never
  land. The submit path is retry-and-verify for exactly this reason; keep new write paths
  verifying, and read `lib/offline/sync.ts` before touching any of it.
- **A draught survey is a VOYAGE, not a job.** Initial → Interim* → exactly one Final;
  the Final carries the report number *and* the whole bill, and the earlier legs are
  absorbed into its single invoice line (`jobs.billed_under_job_id`, mig 186). Never
  offer an Initial or an Interim as a billable line, and never derive an invoice's job
  set from its lines alone — absorbed legs sit on no line. Scope is Draught Survey only.
- **`listInvoiceableJobs` is a POOL, not a source of truth.** It filters by client,
  month (on the *start* date), status and `invoice_id IS NULL`. Any completeness
  question must be re-asked unfiltered — see `fetchVoyageContext`.
- **Retry is only safe on an idempotent write.** `submitJobWithRetry` works because
  `SET submitted_at = now()` twice is the same as once. **A stock movement is not** —
  a blind retry double-decrements, and on flaky mobile a lost *response* is the normal
  case. Any new non-idempotent write needs a client-generated key with a unique index
  (`inventory_movements.client_ref`, mig 190): one key per user *tap*, replayed on
  every attempt, so the database settles the race.
- **`RETURNS TABLE` output names are plpgsql variables for the whole body.** A bare
  column matching one is `42702 column reference "x" is ambiguous`, and it only fires
  on the branches that touch that table — mig 191 shipped with every stock path broken
  and every custody path working. Put `#variable_conflict use_column` at the top and
  alias your tables (mig 192).
- **A service-role client has no `auth.uid()`.** Any `SECURITY DEFINER` RPC gated on
  `is_active_staff()` correctly refuses it, so `/api/*` routes cannot seed through one.
  Write the row directly and let the trigger do its work.
- **An append-only table needs an escape hatch, or mistakes become permanent.**
  `inventory_movements` refuses DELETE even from the service role — right for history,
  but it also made a typo'd item undeletable *and* stopped the smoke test cleaning up
  after itself (SMOKE rows sat on the live page). Mig 193's answer: UPDATE stays
  impossible always; DELETE yields only inside `inventory_purge_item()`, which is
  admin-gated and says out loud how much history it will destroy.
- **A PostgREST *bulk* insert sends an explicit NULL for every key a row omits** — it
  does not fall back to the column DEFAULT. Mixed-shape batches fail on `NOT NULL`.

## Security model

Authorization is **Postgres RLS**, never `user_metadata` and never the UI. SQL helpers:
`get_my_role()`, `is_admin()`, `is_office()`, `is_super_admin()`, `is_active_staff()`,
`has_office_permission(key)`, `can_access_job()`, `job_is_open()`.

- `job_is_open()` is AND-ed into every surveyor-write policy — **invoicing** a job freezes all
  surveyor writes (hours/OT/km/answers/photos/uploads) and protects payable overtime (mig 117).
  Locked = `workflow_status IN ('invoiced','closed')` since mig 188. In app code always ask
  `isJobLocked()` (`lib/jobs/tracker.ts`) — a bare `=== 'closed'` is a bug, and a silent one.
- **Office** is a per-user permission system (`office_user_permissions` + a catalog), not a
  second admin. It has no write policies anywhere.
- `src/proxy.ts` only checks for the presence of a session cookie. It deliberately does *not*
  call `getUser()` — that rotated the refresh token on every protected navigation and raced
  the browser client, causing intermittent logouts. RLS is the real gate. Read the comment
  there before changing it.
- Service-role work happens **only** in `src/app/api/*` routes, which authorize the caller
  themselves first.

## Single-source seams — call these, don't re-implement

Each exists because the logic had already drifted across surfaces once.

| Concern | Module |
|---|---|
| Finishing a job (every role) | `lib/jobs/complete.ts` — `COMPLETE_LABEL` is *the* word |
| Job lifecycle + transitions | `lib/jobs/tracker.ts` — `WORKFLOW`, `advanceWorkflowTo` |
| Creating any job (incl. future AI/WhatsApp intake) | `lib/jobs/drafts.ts` — `createDraftJob(payload, source)` |
| Whether a job gets a report number | `lib/jobs/reportPolicy.ts` (mirrors the mig 136 trigger) |
| Hours vs days wording + metrics | `lib/jobs/labourUnit.ts` |
| Downloading/sharing any generated file | `lib/pdf/deliver.ts` — shares on mobile, saves on desktop, throws on failure |
| Getting a checklist report out (every role) | `components/job/JobPdfButton.tsx` — one control, one behaviour |
| Picking image files (incl. USB import) | `lib/files/pickImageFiles.ts` |
| Repeatable-entry ordering | `lib/checklist/entryOrder.ts` |
| Status badges | `components/job/StatusPill.tsx` |
| Which draught surveys are one voyage | `lib/jobs/voyage.ts` — imported by the invoice pool, the builder AND reconciliation |
| Pricing a voyage as one line | `lib/jobs/voyageBilling.ts` · completeness: `lib/jobs/voyageContext.ts` |
| Pricing ONE job | `lib/jobs/invoicing.ts` — `seedCharge()` |
| Which jobs an invoice bills | `lib/jobs/invoicing.ts` — `invoiceJobSets()` + `releaseSets()` |
| Changing inventory stock (every role) | `lib/inventory/movements.ts` — `recordMovement()`; the RPC is the only door |
| Pack ↔ unit display and entry | `lib/inventory/packs.ts` — `formatQty()` / `toBaseUnits()` |
| Feature flags | `lib/features.ts` — client portal and competition video are both OFF |

**Report numbers** are one global running series (`next_report_number()` = `max + 1` +
advisory lock, mig 158). The per-fiscal-year counter drifted and is retired — don't bring
one back.

**PDF renderers:** templates that outgrow the generic `JobPDF` get their **own** renderer
file selected by template id (`BorescopingReportPDF.tsx`). Promote a report by giving it its
own file, not by adding branches to the generic one.

## Offline

IndexedDB (`lib/offline/db.ts`) holds three stores: `drafts`, `photos`, `newjobcache`.
`syncDraft()` is idempotent and retry-safe: it refuses to overwrite a locked job or one whose
server answers changed under it, and won't clobber edits made on the device mid-sync.
Surveyor surfaces are offline-capable; the service worker stays **off** for office and client.

## Layout

```
src/
  app/(auth)/            login · signup · forgot/reset
  app/(dashboard)/       admin · surveyor · office · client · + shared (inbox, calendar,
                         profile, personnel, competition)
  app/api/               service-role routes: admin/*, messages/send, pdf/[jobId],
                         invoice-pdf|email, competition/judge, cron/*
  components/            job · template-builder · cargo · invoicing · personal-docs ·
                         competition · ui (shared primitives) · layout
  lib/                   jobs · checklist · cargo · offline · pdf · supabase · messages ·
                         email · office · types
  proxy.ts               auth gate (cookie presence only)
supabase/migrations/     all schema, RLS, triggers, storage buckets
e2e/                     smoke + audit scripts
```

## Working conventions

- **Commit and push to `main`** once verified — Vercel deploys, and the `db-migrate` Action
  applies new migrations on push.
- **Migrations:** next free number from `ls supabase/migrations | tail`; idempotent; still
  paste-runnable in the Supabase SQL Editor. After pushing one, **check it actually applied**
  — `gh run list --workflow=db-migrate.yml`. Green CI ≠ migration applied, and the runner
  silently skips a duplicate version number.
- **Gates:** `npx tsc --noEmit` (0 errors) · `npm run lint` (0 errors; some advisory
  React-Compiler warnings are expected) · `npm test` (50 vitest files) · `npm run build`.
  `npm run smoke` after anything touching RLS, the checklist editor, the submit path, or
  migrations; `npm run smoke-inventory` after anything touching inventory. **vitest is
  pure-function only — no RLS policy anywhere is covered by `npm test`.** The e2e scripts
  are the only proof the database behaves.
- **On audit findings: triage first.** Flag security-vs-functionality tradeoffs and get
  approval before changing anything.
- Risky auth/RLS changes → branch + Vercel preview before merging.

## Codebase map (graphify)

A graphify graph lives in `graphify-out/` (git-ignored, rebuilt by a post-commit hook).
Calibrated from an audit of graphify *on this repo*:

- **DO** use `graphify explain "<Symbol>"` for one symbol's neighborhood, and skim
  `graphify-out/GRAPH_REPORT.md` for fast orientation.
- **DON'T** use `graphify query` / `graphify path` for data-flow or "who reads/writes table X"
  — the graph is undirected and every traversal collapses into the `createClient()` hub.
  `grep` is faster and correct here.
- **NEVER** conclude code is dead from the graph. JSX usage and type-only imports produce no
  edge, so its orphan lists are ~100% false positives. Confirm with `grep`/Read before deleting.
- Keep it code-only and undirected; a `--directed` rebuild collapses to near-empty on this repo.

## The docs

These five are current — there are no other live docs. Everything else was deleted on
2026-07-31 as stale; **don't resurrect it from git history for "context."**

- `SETUP.md` — standing the app up from scratch (env, migrations, gates, deploy, roles).
- `PRODUCT.md` — what the app is, who uses it, the design principles.
- `DESIGN.md` — the visual system and shared primitives. Source of truth is `globals.css`.
- `docs/ux-consistency-audit-2026-07-23.md` — the current audit. **Nothing in it is done yet.**
- `docs/usage-analytics-plan.md`, `docs/ai-integration-plan.md` — proposals, **not started**.
  Any migration number written inside them is stale; take the next free one from disk.
