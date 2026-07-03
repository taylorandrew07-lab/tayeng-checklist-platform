# Implementation Plan — Payroll Truth Consolidation (#3) + Surveyor Home / OT-km Mobile (#4)

All line numbers verified against the working tree on 2026-07-03. Next free migration confirmed **126** (`supabase/migrations/` runs 120→125; 125 is the live `metrics_labour`).

---

## 1. Payroll-math verdict

### Which attribution rule is correct for pay
**Day-worked is correct.** Overtime is paid in the month it was physically worked. This is codified in `supabase/migrations/125_metrics_labour_entry_dates.sql:1-13`:

> "mig 123 attributed EVERYTHING to the job's scheduled date, so a multi-day job starting 27 June put its 02 July OT shifts in June and July showed empty (Shane's case). Overtime must be paid in the month it was worked."

The live `metrics_labour` (mig 125) implements this:
- **Logged OT shifts** count on their own `entry_date` — `ot_log` CTE, `COALESCE(o.entry_date, b.job_date)` filtered to the window (`125:40-43`).
- **Km trips** count on their own `trip_date` — `km_by_s`, `COALESCE(k.trip_date, b.job_date)` (`125:68-69`).
- **Regular hours + typed-OT** (rows with no shift log) stay on the job's date `COALESCE(scheduled_date, created_at@POS)` (`125:33, 51-55`).
- **OT pay** = windowed `hours_in × overtime_rate` (`125:58`).

**Surface 1 (Finance → Overview)** is fed by this function via `metricsLabour(from,to)` (`src/lib/jobs/dashboard.ts:23-34`) and is windowed to the current month by default (`src/app/(dashboard)/admin/invoicing/page.tsx:76-93`). **Surface 1 is the payroll truth. Keep it.**

### Do the three surfaces actually disagree? Yes — confirmed, in windowed views.

| Surface | Fed by | Date rule | Window |
|---|---|---|---|
| **1** Finance Overview `admin/invoicing/page.tsx:180-211` | `metrics_labour(from,to)` | **day-worked** (entry_date / trip_date) | Month (default) / Year / All |
| **2** `admin/overtime/page.tsx` | `listOvertimeWork()` `src/lib/jobs/overtime.ts:20-36` | **job.scheduled_date** (whole job's stored `overtime_hours`, no created_at fallback) | Year (default recent) / Month |
| **3** Analytics `admin/analytics/page.tsx:105-140` | `metrics_labour()` **no args = all-time** `src/lib/jobs/analytics.ts:42-47` | none (lifetime) |

**Worked example (verified against the code paths):** a surveyor logs a shift on **2026-07-02** on a job scheduled **2026-06-28**.
- Surface 1 (July window): the shift's `entry_date=2026-07-02` passes `metrics_labour`'s `p_from='2026-07-01'` filter → **shows under July** (`125:40-43`).
- Surface 2 (`inYearMonth(l.date,…)` on `l.date = job.scheduled_date`, `overtime/page.tsx:40`): the whole job's OT buckets on `2026-06-28` → **shows under June**.
- Surface 3: no month split at all → appears only in the **all-time** total.

They also disagree on **axes**, not just dates:
- Surface 2's "OT pay" column is **overtime-only** (`overtime/page.tsx:105, payByCurrency`), while Surfaces 1 & 3 show **regular+overtime pay** combined (`metrics_labour` pay jsonb = `reg_pay + ot_pay`, `125:56-60`). Comparing them even at all-time is apples-to-oranges.
- Surface 2 lists only surveyors with `overtime_hours>0` (`overtime.ts:24 .gt('overtime_hours',0)`); Surfaces 1 & 3 include regular-only surveyors.
- Surface 1 shows km; 2 & 3 do not.

### Keep vs delete
- **KEEP** Surface 1 (Finance → Overview) unchanged as the payroll truth. Add the per-job breakdown that Surface 2 uniquely provides — **rebuilt on the day-worked rule**, not ported from `listOvertimeWork` (which would re-introduce the scheduled-date bug).
- **DELETE** Surface 2: the page `src/app/(dashboard)/admin/overtime/page.tsx` and its data lib `src/lib/jobs/overtime.ts` (confirmed sole importer — grep for `listOvertimeWork`/`jobs/overtime` returns only that page).
- **DELETE** Surface 3's labour table only (`analytics/page.tsx:105-140`); keep the rest of the Analytics page. Repoint its two links to Finance → Overview.

### ⚠️ Blockers to resolve BEFORE authoring the migration / deleting anything
These are open questions from the math investigation that change the numbers. Resolve with the user first:

1. **Breakdown shape.** Surface 2's breakdown is OT-only (date, job link, OT hrs, OT pay — `overtime/page.tsx:119-130`). Finance Overview also tracks regular hrs + km per surveyor. **Decision needed:** does the ported per-job breakdown show OT-only, or full labour (reg + OT + km + pay) per job? This determines the new function's columns. *Recommended: full labour per job, so the expand row detail reconciles to the surveyor's Finance total across all three hour types.*
2. **Authoritative OT pay per job.** `metrics_labour` uses **windowed** `hours_in × ot_rate` (`125:58`); `listOvertimeWork` uses the **stored, un-windowed** `job_surveyors.overtime_pay` generated column (`overtime.ts:23`). These diverge whenever a job's shifts straddle the window boundary. The breakdown MUST use the windowed value to match the header total. *Confirm the pay-run expects windowed.*
3. **Stored-vs-recomputed drift (all-time).** `metrics_labour` recomputes OT hours from the raw `job_surveyor_overtime` log; Surfaces 2/3 read the stored `job_surveyors.overtime_hours` column, which is kept in sync only by the client roll-up in `JobOpsPanel.tsx:180-197`. Any bulk/SQL insert into the OT log that skips that resync would make even the all-time numbers disagree. **Verify no import path writes OT rows without resyncing** before trusting the migration to be the single source — otherwise the migration is still correct-for-pay, but old data may need a one-time resync.
4. **Jobs-count quirk (display only).** `metrics_labour` counts jobs with `FILTER (WHERE job_in_win)` on `job_date` (`125:78`). A surveyor with OT hours logged in-window but whose job's `scheduled_date` falls outside the window contributes OT hours/pay but **0 to the job count** — so the number of breakdown rows can exceed the header "jobs" count. Confirm this is acceptable and does not read as a bug in the UI.

Do not delete Surface 2 until #1 and #2 are answered (they define the migration) and the breakdown is live in Finance.

---

## 2. Does consolidation need a new migration?

**Yes — one new migration (126).** `metrics_labour` aggregates `GROUP BY surveyor_id` and returns **per-surveyor totals only** (`125:76-92`); the client `SurveyorLabour` type has no jobs array and even discards the `jobs` count field (`dashboard.ts:10, 26-31`). So the per-job breakdown cannot come from the existing function output.

Options:
- **(Recommended) New migration `126_metrics_labour_by_job.sql`** exposing `metrics_labour`'s internal `rowvals` CTE at job grain. It reuses mig 125's exact CTEs (`base`, `ot_log`, `rowvals`) and only changes the final projection to `GROUP BY surveyor_id, job_id` + join job metadata. Because it shares the identical windowing predicates (`COALESCE(entry_date, job_date)`, `COALESCE(trip_date, job_date)`), the breakdown rows sum **exactly** to the `metrics_labour` header totals. Single source of truth, no drift.
- **(Not recommended) Client-side rebuild** from raw `job_surveyor_overtime` + `job_surveyor_km` queries. Technically possible (the log rows carry `entry_date`/`trip_date`), but it re-implements the SQL windowing in TypeScript and risks the expand-rows sum drifting from the header total. Reject unless a migration deploy is truly blocked.

Proposed signature:
```
metrics_labour_by_job(p_from date, p_to date)
RETURNS TABLE(surveyor_id uuid, job_id uuid, job_title text, vessel_name text,
              report_number text, job_date date,
              regular_hours numeric, overtime_hours numeric, km numeric, pay jsonb)
```
Grants identical to `metrics_labour` (`REVOKE … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated`, `125:97-98`). **Re-verify the free number with `ls supabase/migrations | grep ^12` at author time** — the runner silently skips a duplicate version.

---

## 3. Ordered plan — consolidate the labour surfaces (#3)

Sequenced so the app never breaks: add the migration → surface it in Finance → repoint inbound links → only then delete Surface 2 and Surface 3's table.

### Step 3.1 — Author migration 126 (day-worked, job grain)
- **File:** new `supabase/migrations/126_metrics_labour_by_job.sql`.
- **What:** copy the `base` / `ot_log` / `rowvals` CTEs verbatim from `125:22-63`. Add `job` metadata to `base` (`j.title`, `j.vessel_name`, `j.report_number`). Final `SELECT`: group `rowvals` by `(surveyor_id, job_id)`, sum `reg_hours`/`ot_hours`/`pay`, left-join `job_surveyor_km` windowed by `COALESCE(trip_date, job_date)` at `(surveyor_id, job_id)` grain, and `jsonb_object_agg` pay by currency. Keep `SET search_path = public`, `SECURITY INVOKER`, `STABLE`.
- **Verify:** run the mig-125 sanity query pattern — `SELECT * FROM metrics_labour_by_job('2026-07-01','2026-07-31')` should show Shane's 02/07 shift under July; and for any surveyor, `SUM` of the by-job rows must equal that surveyor's `metrics_labour('2026-07-01','2026-07-31')` row (reg, OT, km, pay). Push (auto-applies via the db-migrate action).

### Step 3.2 — Add the client fetch
- **File:** `src/lib/jobs/dashboard.ts`.
- **What:** add `interface SurveyorJobLabour { surveyor_id; job_id; job_title; vessel_name; report_number; job_date; regular_hours; overtime_hours; km; pay: {currency;total}[] }` and `metricsLabourByJob(from,to)` mirroring `metricsLabour` (`23-34`) but calling `metrics_labour_by_job`. Do **not** filter/sort away zero rows differently from the parent — keep rows whose surveyor appears in the table.
- **Verify:** `npx tsc --noEmit` clean.

### Step 3.3 — Make the Finance Overview labour rows expandable
- **File:** `src/app/(dashboard)/admin/invoicing/page.tsx` (`OverviewTab`, labour section `152-212`).
- **What:**
  - In the labour effect (`80-93`), alongside `metricsLabour`, call `metricsLabourByJob(from,to)` and store rows in a `Map<surveyor_id, SurveyorJobLabour[]>` state; add `const [openSurveyor, setOpenSurveyor] = useState<string|null>(null)`.
  - Add a trailing chevron `<th className="w-8" />` to the header row (`183-189`) and a chevron cell to each `<tr>` (`193-205`); make the row `cursor-pointer` calling `setOpenSurveyor`. Follow the exact expand pattern in `overtime/page.tsx:107-135` (Fragment + `{isOpen && <tr><td colSpan=…>}`), but render **date · job link (`/admin/jobs/{job_id}`, `M.V. {vessel}` / title + ` · {report_number}`) · reg hrs · OT hrs · km · pay** per the shape chosen in Blocker #1.
  - Keep the existing footer note (`209`) — it already documents the day-worked rule.
- **Verify:** `tsc` clean; on Finance → Overview, set month picker to a month with a boundary-straddling job, expand a surveyor: the per-job OT hours sum to the row's Overtime-hrs cell, and pay reconciles. Switch Month/Year/All and confirm the breakdown re-fetches with the header.

### Step 3.4 — Repoint Surface 3's inbound links to Finance → Overview
Do this **before** deleting `/admin/overtime`.
- **File:** `src/app/(dashboard)/admin/analytics/page.tsx`.
  - Line **33**: `<Kpi label="Overtime jobs" … href="/admin/overtime" />` → `href="/admin/invoicing"` (Finance Overview is the default tab). (Grep confirms these two are the ONLY inbound links to `/admin/overtime` anywhere in `src`.)
  - Line **109**: `<Link href="/admin/overtime">Overtime by month →</Link>` → point to `/admin/invoicing` and relabel e.g. `Labour & overtime →`.
- **Verify:** click both from Insights → land on Finance → Overview.

### Step 3.5 — Remove Surface 3's labour table
- **File:** `src/app/(dashboard)/admin/analytics/page.tsx`, delete the `{/* Labour & overtime */}` section (`105-140`). Keep the `Overtime jobs` KPI (`33`, already repointed) — it uses `data.kpis.otJobs`, independent of the labour table.
- **File:** `src/lib/jobs/analytics.ts` — the `Analytics.labour` field (`21`), `mapLabour` (`26-30`), the `metrics_labour` calls (`46`, `93`), and both `labour`/`overtimeHours` derivations (`72,81,156-159`) become dead. Remove `labour` from the interface and the two mappings; keep `overtimeHours` **only if** still displayed — after deleting the table it is unused, so remove it too (it was only shown in the deleted section header `analytics/page.tsx:108`). Drop the now-unneeded `metrics_labour` calls from both the fast path and `getAnalyticsClient`.
- **Verify:** `tsc` clean; Insights page renders pipeline/types/trend/billing/top-clients with no labour table and no console errors.

### Step 3.6 — Delete Surface 2 and its lib
Only after 3.3 is live and 3.4 is merged.
- **Delete file:** `src/app/(dashboard)/admin/overtime/page.tsx`.
- **Delete file:** `src/lib/jobs/overtime.ts` (sole importer was the page above — grep confirmed).
- **Verify:** `tsc` + `next build` clean (no dangling imports); navigating to `/admin/overtime` 404s; no remaining reference to `listOvertimeWork` (grep).

### Inbound-link / delete / risk inventory for #3
- **Links to repoint (2, both in `analytics/page.tsx`):** line 33, line 109. No sidebar/nav entry references `/admin/overtime` (grep-verified).
- **Files to delete (2):** `src/app/(dashboard)/admin/overtime/page.tsx`, `src/lib/jobs/overtime.ts`.
- **Files edited:** `analytics/page.tsx`, `src/lib/jobs/analytics.ts`, `src/lib/jobs/dashboard.ts`, `admin/invoicing/page.tsx`, new migration 126.
- **Payroll risk:** none to Surface 1's existing totals — `metrics_labour` and its window logic (`invoicing/page.tsx:80-93`) are untouched. The only new SQL (mig 126) is additive and read-only. The residual risk is Blocker #3 (stored-vs-log drift on legacy/bulk data) — verify before relying on all-time equality.

---

## 4. Surveyor home reorder + OT/km mobile (#4)

### 4A — Reorder `src/app/(dashboard)/surveyor/page.tsx` success branch (`202-316`)
All hooks and derived consts live above the single `return` (`17-172`); reordering only moves JSX subtrees — **no hook reordering**. If a collapse needs local state, add its `useState` at the top with the others (Rules-of-Hooks).

**Target order:** header → (unsynced + Active) → AttentionCard → collapsed "My work summary" → Submitted/Completed → empty state.

**Move-list (verified blocks):**
1. **Move** the unsynced-local block (`243-260`) to be the **first** child of the fragment (right after `<>` at `202`).
2. **Move** the Active Jobs block (`262-283`) immediately after it (keep unsynced-first).
3. **Move** `<AttentionCard items={docAttention} />` (`241`) after those two. It self-hides when empty (`AttentionCard.tsx` returns null on empty items), so placement is safe.
4. **Move** the work-summary card (`218-239`) to **after** AttentionCard, wrapped in a collapse: add `const [summaryOpen, setSummaryOpen] = useState(false)` at the top. Keep the totals strip (`233-238`) **always visible in the collapsed header** so `range.label · N jobs · reg/ot/km` stays glanceable; put the period pills + custom-date inputs + CSV (`220-232`) inside the `{summaryOpen && …}` body. The period pills / `range` / `inRange` are unchanged, so the Submitted list stays correctly filtered.
5. **Leave** Submitted/Completed (`285-306`) and empty state (`308-315`) where they are (now after the summary).

**Stats tiles row (`203-216`):** drop the **Total** tile (`212-215`, all-time `jobs.length`, redundant vs the period totals) and change `grid-cols-3` → `grid-cols-2` at `203`. Keep Active + Submitted tiles at the very top under the header. *(Decision to confirm: keep the 2-tile row vs drop entirely — they duplicate the section-header counts. Recommend keep, it's the at-a-glance summary.)*

**Coupling to flag before implementing:** collapsing the summary hides the period pills, which drive the Submitted/Completed filter (`submitted = submittedAll.filter(inRange)`, `133`; header label `287`). Keeping the collapsed **header totals visible + easy to expand** (recommended above) preserves discoverability. The alternative — decouple so period affects only the summary/CSV and Submitted shows all-time — is a **behavior change**; confirm with the user first.

**Card-date bug (recommend fixing in-scope):** rows print `formatDate(job.created_at)` (`274`, `297`) but the list is filtered/bucketed by `jobDate = scheduled_date ?? created_at` (`125-126`) and the CSV writes `jobDate(j)` (`147`). For back-dated / multi-day jobs the card date disagrees with both the filter and the CSV. Fix both lines to `formatDate(job.scheduled_date ?? job.created_at)`. This is a payroll-visible date correctness fix — flag it, then apply.

**Verify 4A:** `tsc` clean; on a phone viewport, home shows sync-pending + Active first, then attention, then a collapsed summary that still shows totals and expands to the period pills; Submitted list still narrows when a period is chosen; card dates match the CSV Date column.

### 4B — OT/km forms responsive layout, `src/components/job/JobOpsPanel.tsx`
These forms are gated only by `!locked` (`258`, `297`) and render identically for admin and surveyor (isAdmin gates only pay-rate/currency at `233-235` and the row-remove X at `208`). Both the admin job page and the surveyor job page mount this component, so **scope the mobile treatment with an unprefixed-then-`sm:` pattern** — the compact inline row must be preserved from `sm:` up so admin desktop does not regress. `.input-base` base is `text-sm` (`src/app/globals.css:75-77`), so reaching 16px on mobile requires an explicit `text-base`, not just dropping `text-xs`.

**Exact class changes:**

1. **OT form row wrappers** (`260` date/time row, `268` location/note row) and **km form wrapper** (`298`):
   `flex flex-wrap items-end gap-x-2 gap-y-1.5` → `flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-end gap-2 sm:gap-x-2 sm:gap-y-1.5`. For the km wrapper keep the leading `pt-1.5 border-t border-gray-200` (it doubles as the divider).

2. **Every field `<div>` wrapper** in these forms — add `w-full sm:w-auto` so it stretches when stacked.

3. **Every field input** — swap the compact override and width to be mobile-first:
   `input-base py-0.5 px-1.5 text-xs w-32` → `input-base w-full py-2.5 px-3 text-base sm:w-32 sm:py-0.5 sm:px-1.5 sm:text-xs` (analogously `sm:w-24` for the `w-24` time/distance inputs at `262,265,300`, `sm:w-36` for the `w-36` location at `269`). Lines: `261,262,264,265` (OT date/time), `269,270` (OT location/note), `299,300,301` (km date/distance/note).
   For the two note inputs (`270`, `301`) `flex-1 min-w-[80px]` → `w-full sm:flex-1 sm:min-w-[80px]` plus the same override swap.

4. **Inline `→` arrow** (`263`): add `hidden sm:inline` (it becomes a stray full-width row when stacked).

5. **`= {preview}h` span** (`266`): give it `w-full sm:w-auto text-sm sm:text-xs` so the live total stays visible on mobile on its own line (do not hide it).

6. **Add buttons** (`271` OT, `302` km): `btn-secondary py-1 px-2 text-xs` → `btn-secondary w-full justify-center py-2.5 text-base sm:w-auto sm:py-1 sm:px-2 sm:text-xs`.

7. **Entry-row delete X hit-area** (`254` OT, `293` km): `btn-ghost py-0.5 px-1` → `btn-ghost p-2 sm:py-0.5 sm:px-1` (grow the tap target on mobile; the `X h-3 w-3` icon and `onClick` binding stay unchanged).

**Do not touch** any `value`/`onChange`/`min`/`max`/`step`/`list` attributes, the `addEntry`/`addKm`/`removeEntry`/`removeKm` handlers, `shiftHours`/`preview` logic, or the `nStartDate…nKmNote` state — this is layout only. The `<datalist>` (`269`) is non-rendering and safe to leave inline when the field goes full-width.

*(Out-of-scope unless requested: the top numeric-hours grid `numCls` inputs at `203/213`, and the disclosure toggle buttons at `242/282` — the assignment scopes to the add-forms + entry-row deletes.)*

**Verify 4B:** `tsc` clean. On a narrow viewport (surveyor job page, open job), the OT "add shift" and km "add trip" forms stack one field per row, inputs are ~44px tall with 16px text (no iOS zoom-on-focus), and the Add button is full-width. On `sm`+ (admin desktop `admin/jobs/[id]` ops panel) the compact single-line inline row is **pixel-identical to before**. Add a shift and a trip on both pages to confirm handlers still fire and totals persist.

### Inbound-link / risk inventory for #4
- **No links to repoint, no files deleted.** Files edited: `src/app/(dashboard)/surveyor/page.tsx`, `src/components/job/JobOpsPanel.tsx`.
- **Risk:** the shared OT/km form change affects admin desktop too — the `sm:` breakpoint (not an `isAdmin` branch) is the only thing protecting the desktop compact layout; verify at `sm`+ explicitly. No payroll math is touched by either #4 change; the only figure affected is the surveyor-home **display date** (bug fix, brings the card into agreement with the CSV and the filter).