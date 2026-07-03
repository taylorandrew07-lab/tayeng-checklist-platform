# Tayeng Checklist Platform — Design & Usability Audit

Merged from 13 parallel audits (10 area audits + 3 cross-cutting lenses). Two placeholder/test entries (`a.tsx`, `src/app/office/invoicing/page.tsx`) were schema probes and are excluded. Everything else is preserved below in the Top 10, the Delete List, Quick Wins, or the Per-Area Appendix.

---

## 1. Executive summary — the 5 systemic problems

**1. Save buttons fight your own autosave, everywhere.** The app auto-saves (debounced to the server, plus offline drafts) — that's a core product promise — yet nearly every editing surface still shows manual "Save" buttons on top of it, sometimes two or three at once. The template editor has four save paths; the checklist editor has two identical "Save Draft" buttons; the hours panel has a Save button its own code comment admits "just flushes everything now." This teaches users to distrust the autosave and is exactly the "random save buttons" clutter you flagged. Worse, some "Cancel"/"Leave without saving" controls don't actually undo anything — autosave already persisted the edit.

**2. Desktop-dense UI is shipped verbatim to surveyor phones.** The surveyor's most frequent field tasks — logging an overtime shift, a km trip, filling a checklist, assigning cargo photos — run on controls tuned for a mouse: sub-16px text inputs that trigger an iOS zoom-jolt on every field, sub-44px tap targets, and destructive/primary actions hidden behind `hover:` (invisible on touch). A single one-line CSS fix removes the zoom jolt app-wide; the rest need per-screen mobile layouts. This is your worst daily-pain cluster.

**3. Desktop width is wasted.** The most-used admin working surface (job detail) is capped at `max-w-4xl` (896px) on 1600px+ monitors; Settings and New Job are single narrow columns leaving two-thirds of the screen empty; the mobile-shaped Inbox list is stretched across `max-w-7xl` and then opens messages in a modal. The design system already says "generous desktop width" and content pages should be `7xl` — several pages didn't get the memo.

**4. Duplicated and dead controls accumulate.** A "Download PDF" button renders twice on the same job view; a whole tile-customization subsystem (~120 lines) rearranges five vanity tiles; a "Clear/Restore" toggle hides a recent-activity feed per-browser; an "Actions" card and an "Invoice" tab exist mainly to fill grid columns; two separate overtime reports compute payroll differently and can show different pay for the same month; half of the Analytics page is duplicated on the dashboard home.

**5. The shared design system exists but is bypassed.** You have `PageHeader`, `EmptyState`, `ui/Tabs`, `StatusPill`, and a skeleton loading standard — but most pages hand-roll their own headers, empty states, tab bars, and full-page spinners instead. The result is that the "same thing" looks and behaves slightly differently on most screens (banner vs toast feedback, two names for one concept, raw ISO dates in front of clients).

---

## 2. Top 10 highest-impact fixes (ranked)

**1. Kill the iOS input-zoom jolt app-wide.** `src/app/globals.css` — `.input-base` is `text-sm` (14px); iOS Safari auto-zooms on any focused input under 16px, and the viewport allows zoom. Every field tap on a phone jolts and must be pinched back out — dozens of times per inspection, on the app's most-used surface. Change `.input-base` to `text-base sm:text-sm` (16px phone, 14px desktop) and stop using `text-xs` on any mobile-reachable input (OT/km logs, cargo grids). **Effort: quick-win.** Also affects `JobOpsPanel.tsx`, `ReadingsGrid.tsx`, `JobChecklistEditor.tsx`.

**2. Reorder the surveyor job page: checklist first, admin chrome hidden.** `src/app/(dashboard)/surveyor/jobs/[id]/page.tsx` + `src/components/job/JobOpsPanel.tsx`. Today the surveyor's core task (the checklist) renders **last**, three screens down, below a read-only 9-step admin Workflow stepper (pure chrome for them, in billing vocabulary they don't use) and the hours/files ops panel. Hide the Workflow card when `!isAdmin`, put the checklist directly under the header, and collapse the ops panel (hours/OT/km/files) into an accordion or second tab below it. **Effort: medium.**

**3. Make the OT-shift and km-trip logs usable with one thumb.** `src/components/job/JobOpsPanel.tsx` (entry forms ~lines 260-303). These payroll-critical forms (surveyors log their own shifts since mig 124) are dense `text-xs`, ~26px-tall, fixed-width `flex-wrap` rows with 12px delete icons — served identically to desktop admins and field surveyors. Below `sm`, stack the date/time/location fields full-width at normal `.input-base` size with a 44px Add button and larger delete hit areas; keep the compact inline row from `sm:` up. **Effort: medium.** Also affects `surveyor/jobs/[id]/page.tsx` (same component).

**4. Delete the redundant Save buttons that fight autosave.** Three surfaces: `JobOpsPanel.tsx` (Save button over debounced autosave + a live Saved/Saving chip); `JobChecklistEditor.tsx` (two identical "Save Draft" buttons over server + offline autosave — remove the top one, keep one in the sticky bottom bar for flaky-wifi reassurance); `admin/templates/[id]/edit/page.tsx` + `templates/new/page.tsx` (header Save + bottom Save/Cancel row + sticky bar + autosave — commit to autosave, keep one status indicator). Replace each with a single quiet "Saving… / Saved 10:42 / Save failed — Retry" status. **Effort: quick-win each.**

**5. Stop the checklist and cargo photo-delete from silently destroying field data.** `src/components/job/JobChecklistEditor.tsx` (field photos ~1479, general ~1717) and `src/components/cargo/PhotoManager.tsx` (~285-289, 317-319). Delete buttons are `opacity-0 group-hover:opacity-100` — invisible on touch but still tappable, so a thumb in the photo's top-right corner permanently deletes it with no confirm. Make them `opacity-100 sm:opacity-0 sm:group-hover:opacity-100`, enlarge to ~40px, and add the `confirmDialog` already used for attachment deletes. Same fix for the repeatable-entry "Remove" button (`JobChecklistEditor.tsx` ~1615), which deletes a whole entry's answers/signatures/photos with no confirmation. **Effort: quick-win.**

**6. Rebuild the admin dashboard around the daily task.** `src/app/(dashboard)/admin/page.tsx` + `src/components/dashboard/InsightsSummary.tsx`. Today "New Job" (the most frequent admin action) is the **last** element on the page, the header's only action is "Customize" (a tile-preference toggle), and half of the Analytics page is duplicated inline, pushing Recent Jobs below two chart cards. Put a "New Job" primary button in the `PageHeader`; delete the tile-customization subsystem, the Clear/Restore feed toggle, and the `pendingApprovals` tile; keep only the 4-KPI row from `InsightsSummary` (drop its duplicate chart + billing cards); move Recent Jobs up under the attention card; add "Insights" to the sidebar nav and drop the subtitle "View insights" link. **Effort: medium.**

**7. Consolidate the two overtime/labour reports into one payroll truth.** `src/app/(dashboard)/admin/overtime/page.tsx`, `src/lib/jobs/overtime.ts`, `src/app/(dashboard)/admin/analytics/page.tsx`, `src/app/(dashboard)/admin/invoicing/page.tsx`. The Finance Overview labour table attributes OT/km to the **day worked** (correct for pay); `/admin/overtime` and the Analytics labour table bucket by the job's **scheduled date** and compute all-time — so two admin screens show per-surveyor "Pay" with different numbers and no window caption. Keep the Finance Overview table (day-worked), add the per-surveyor job breakdown that `/admin/overtime` uniquely offers, then delete the standalone overtime page and the Analytics labour table, repointing both Insights links at Finance → Overview. **Effort: medium.**

**8. Widen admin job detail and strip its filler card/tab.** `src/app/(dashboard)/admin/jobs/[id]/page.tsx`. The daily working surface is `max-w-4xl` (40%+ empty margin on desktop). Widen to `max-w-6xl/7xl` and lay it out as a true two-pane (ops panel in a right rail, details + checklist in the main column). While there: delete the duplicate "Download / Share PDF" in the sidebar Actions card, retire the Actions card (move "Mark as submitted" into the Workflow card, demote "View Template" to a text link), drop the top-level "Invoice" tab (place the compact invoice status card on the Overview), and move the header "Delete" behind an overflow menu. **Effort: quick-win (width + card removals), medium (two-pane).**

**9. Collapse the two competing cargo voyage lists into one.** `src/app/(dashboard)/admin/cargo/page.tsx`, `src/components/cargo/CargoOperationsView.tsx`, `src/components/cargo/CargoListView.tsx`. A voyage synced on this browser appears in **both** the cloud list and the "Voyages on this device" list, and the two rows open different pages with different powers (cloud → read-only + DRI report-number issuing; device → full edit, no report numbers). The primary "New Voyage" button lives in the device-scoped section, so new voyages land in a browser-local silo. Merge into one table with a sync/source badge routing every row to a single voyage page (editable when a local copy exists, read-only cloud + DRI builder otherwise). **Effort: large.**

**10. Stop advertising the disabled Client portal at signup.** `src/app/(auth)/signup/page.tsx`. The role picker still offers "Client — View job reports and results" while `CLIENT_PORTAL_ENABLED = false`, so a real customer can request an account, wait for admin approval, sign in, and hit the "Portal unavailable" dead-end — worst first impression, plus pointless approval work. Gate the Client option on the flag (picker collapses to Surveyor + Cargo Technician). **Effort: quick-win.**

---

## 3. THE DELETE LIST

Every control/feature recommended for removal. Where a rename or role-gate is the better move than a hard delete, it's noted.

- [ ] **Tile-customization subsystem** — Customize button, edit panel, reorder arrows, remove buttons, `moveTile`/`saveTiles`, `ui_prefs` persistence — `src/app/(dashboard)/admin/page.tsx`
- [ ] **"Pending approvals" optional tile** (duplicates the yellow banner above it) — `src/app/(dashboard)/admin/page.tsx`
- [ ] **Clear/Restore on Recent Jobs** — `CLEARED_AT_KEY`, `handleClear`/`handleUnclear`, both buttons — `src/app/(dashboard)/admin/page.tsx`
- [ ] **Catalog vanity-tile row** (or fold Templates/Users/Clients counts into one quiet text line) — `src/app/(dashboard)/admin/page.tsx`
- [ ] **Subtitle "View insights" link** (navigation doesn't belong in a subtitle; add Insights to sidebar instead) — `src/app/(dashboard)/admin/page.tsx`
- [ ] **Chart + billing-outstanding cards inside InsightsSummary** (keep only the 4-KPI row) — `src/components/dashboard/InsightsSummary.tsx`
- [ ] **Labour & overtime table on Analytics** — `src/app/(dashboard)/admin/analytics/page.tsx`
- [ ] **Entire standalone Overtime page** after folding its per-surveyor breakdown into Finance Overview — `src/app/(dashboard)/admin/overtime/page.tsx`
- [ ] **Duplicate "Download / Share PDF" button** in the sidebar Actions card — `src/app/(dashboard)/admin/jobs/[id]/page.tsx`
- [ ] **The whole Actions card** (move "Mark as submitted" to Workflow, "View Template" to a text link) — `src/app/(dashboard)/admin/jobs/[id]/page.tsx`
- [ ] **Top-level "Invoice" tab** (replace with a compact status card on Overview) — `src/app/(dashboard)/admin/jobs/[id]/page.tsx`
- [ ] **"Save" button in Surveyors & hours card** (autosave already covers it) — `src/components/job/JobOpsPanel.tsx`
- [ ] **Always-visible "Set status…" select** in Workflow card (move behind a kebab/"change…" link) — `src/components/job/JobOpsPanel.tsx`
- [ ] **Duplicate status pill** in the Workflow card header (stepper + page header already show it) — `src/components/job/JobOpsPanel.tsx`
- [ ] **Entire Workflow card for surveyors** (`!isAdmin`) — read-only chrome — `src/components/job/JobOpsPanel.tsx`
- [ ] **In-panel closed-job lock banner** for surveyors (page-level banner already says it) — `src/components/job/JobOpsPanel.tsx`
- [ ] **Header "Delete" button** on admin job detail — move to overflow menu / danger zone — `src/app/(dashboard)/admin/jobs/[id]/page.tsx`
- [ ] **Header Save + bottom Save/Cancel row + sticky bar** on template Edit (keep one autosave status) — `src/app/(dashboard)/admin/templates/[id]/edit/page.tsx`
- [ ] **Header Save + static bottom Save row** on template New (keep the sticky bar only) — `src/app/(dashboard)/admin/templates/new/page.tsx`
- [ ] **Misleading "Leave without saving" dialog** (it never reverts autosaved edits) — `src/app/(dashboard)/admin/templates/[id]/edit/page.tsx`
- [ ] **One of the two duplicate-template implementations** — delete the ~110-line direct-DB copy in the list and point Copy at the unreachable `?duplicate=` builder flow — `src/app/(dashboard)/admin/templates/page.tsx` + `templates/new/page.tsx`
- [ ] **"Archived" option in the template Status select** (bypasses the archive flow; leave archiving to the list action) — `src/app/(dashboard)/admin/templates/[id]/edit/page.tsx` + `new/page.tsx`
- [ ] **Top "Save Draft" button** in the checklist editor (keep one in the sticky bottom bar) — `src/components/job/JobChecklistEditor.tsx`
- [ ] **Unreachable photo-field branches** in FieldRenderer (lines ~308-316; never rendered, describes a dead layout) — `src/components/job/FieldRenderer.tsx`
- [ ] **Always-visible "Insert here" pills** between every repeatable entry (move to a per-entry menu / rearrange mode) — `src/components/job/JobChecklistEditor.tsx`
- [ ] **"Total" stat tile** on surveyor home (just Active + Submitted; not tappable) — `src/app/(dashboard)/surveyor/page.tsx`
- [ ] **Client role option at signup** while the portal flag is false — `src/app/(auth)/signup/page.tsx`
- [ ] **Permanent amber remember-me warning** on login (keep the single dynamic helper line) — `src/app/(auth)/login/page.tsx`
- [ ] **"Access" permission-badge column + redundant "View →" link column** on the client jobs table (row is already the link) — `src/app/(dashboard)/client/page.tsx`
- [ ] **Divergent number-link behavior** in the invoices ledger (number does two different things; make it always open one thing, leave PDF on the PDF button) — `src/components/invoicing/InvoicesTable.tsx`
- [ ] *(Rename, not delete)* **Header "Download PDF" on the cloud voyage view** → "Sensor report (PDF)" so it isn't confused with the DRI builder's identical button — `src/components/cargo/ClientCargoWorkspace.tsx`
- [ ] *(Consolidate, not delete)* **JobPdfButton** — unreachable variant (only the disabled portal imports it) while live pages hand-roll their own PDF handler; adopt it as the one PDF button or park it — `src/components/job/JobPdfButton.tsx`

---

## 4. Quick wins (not already in the Top 10)

Each is under ~an hour and independently shippable.

- **Add "Insights" to the admin sidebar** — the Analytics page is only reachable via a subtitle link; add nav item (near Finance). `src/components/layout/Sidebar.tsx`
- **Add a "Vessels" entry to the admin sidebar** — a declared top-level IA area with no nav item. `src/components/layout/Sidebar.tsx`
- **Rename "Add User"/"Add Client"** on the dashboard to "Team"/"Clients" (they link to list pages, not create flows) or deep-link them to the real create flows. `src/app/(dashboard)/admin/page.tsx`
- **Unify dashboard tile styling** — render catalog tiles with the shared `Kpi` component (gray) so colour stays reserved for state, not decorative purple/pink squares. `src/app/(dashboard)/admin/page.tsx` + `widgets.tsx`
- **Fix Recent Jobs terminology** — heading says "Recent Jobs" but empty state/tooltips say "checklists." Use "jobs" throughout. `src/app/(dashboard)/admin/page.tsx`
- **Rename the Settings page** — sidebar says "Settings," h1 says "Job Numbering Settings," but it also hosts Job Types + Photo cleanup. Use `PageHeader` "Settings" with a subtitle, and swap the `Loader2` spinner for a skeleton. `src/app/(dashboard)/admin/settings/page.tsx`
- **2-column the Settings page** (mirror Finance Settings) and move the permanent amber "deleted job numbers" banner inside the "Set Next Number" card as helper text. `src/app/(dashboard)/admin/settings/page.tsx`
- **Convert the Settings success banner to a toast** and cross-link the three numbering surfaces (job / report / invoice numbering). `src/app/(dashboard)/admin/settings/page.tsx` + `invoicing/page.tsx`
- **Wrap the Analytics tables in `overflow-x-auto`**, skip alternate month labels below `sm`, and show bar values on the max/last bars instead of hover-only. `src/app/(dashboard)/admin/analytics/page.tsx` + `widgets.tsx`
- **Wrap the Finance labour + overtime tables in `overflow-x-auto`** (or reuse the `InvoicesTable` stacked-card mobile pattern). `src/app/(dashboard)/admin/invoicing/page.tsx`
- **Give the jobs list a large "open" affordance** — make the vessel name (or report number) link to the job so opening isn't a precision click on a 28px icon. `src/app/(dashboard)/admin/jobs/page.tsx`
- **Move the column header row above the job-line list** in the invoice builder, and add qty/unit-price labels to `LineItemsEditor`. `src/components/invoicing/ConsolidatedInvoiceBuilder.tsx` + `LineItemsEditor.tsx`
- **Pair Ref + Attention on one row** in the invoice builder (match the edit modal). `src/components/invoicing/ConsolidatedInvoiceBuilder.tsx`
- **Widen the template builder** from `max-w-4xl` to `6xl/7xl`. `src/app/(dashboard)/admin/templates/[id]/edit/page.tsx` + `new/page.tsx`
- **Share the Template Details card** between New and Edit so New also exposes Colour + letterhead toggle. `templates/new/page.tsx`
- **Replace `window.prompt` for "Save set"** with the app's standard modal/inline input. `src/components/template-builder/FieldEditor.tsx`
- **Collapse the "Insert dynamic value" chip row** to a "+ dynamic value" link. `src/components/template-builder/FieldEditor.tsx`
- **Enlarge template-builder insert buttons/grips** to ≥44px hit areas. `src/components/template-builder/TemplateBuilder.tsx`
- **Persist the cargo workspace active tab** and default to Readings once setup is complete (not Setup every time). `src/components/cargo/VoyageWorkspace.tsx`
- **Give cargo readings-grid inputs 16px font + taller cells** on touch. `src/components/cargo/ReadingsGrid.tsx`
- **Split state from action on the cargo photo-confirm toggle** ("Set Confirmed" actually un-confirms). `src/components/cargo/PhotoManager.tsx`
- **Widen the cargo operations table to `max-w-7xl`**, add Cargo/Route + dates columns, and give it an `overflow-x-auto`/stacked-card mobile fallback. `src/components/cargo/CargoOperationsView.tsx`
- **Reorder surveyor home** — Active Jobs directly under the header, then attention card, then a collapsed "My work summary"; enlarge the period pills to ≥40px. `src/app/(dashboard)/surveyor/page.tsx`
- **Show `jobDate()` on surveyor job cards** so card dates match the bucket header. `src/app/(dashboard)/surveyor/page.tsx`
- **Drop the duplicate closed-job banner** on the surveyor route (keep page-level only). `src/app/(dashboard)/surveyor/jobs/[id]/page.tsx`
- **Constrain the interpolation calculator** — linear mode `max-w-md`, bilinear `max-w-4xl` (currently `7xl`). `src/components/tools/InterpolationCalculator.tsx`
- **Add `inputMode="decimal"` to number fields** so phones show the numeric keypad. `src/components/job/FieldRenderer.tsx`
- **Fix the signup "Cargo Technician" copy** — "Same as surveyor (different title)" is a leaked internal note; use user-facing wording. `src/app/(auth)/signup/page.tsx`
- **Use `formatDate()` for the client cargo list** instead of a raw ISO `slice(0,10)`. `src/app/(dashboard)/client/cargo/page.tsx`
- **Short/icon-only PDF label on mobile** on the client job header so the title isn't squeezed. `src/app/(dashboard)/client/jobs/[id]/page.tsx`
- **Cut the invoice-numbering help text to one sentence** with a format example. `src/app/(dashboard)/admin/invoicing/page.tsx`
- **Swap the BankAccountEditor button order** to primary-rightmost (currently Save-then-Cancel). `src/app/(dashboard)/admin/invoicing/page.tsx`
- **Give all repeatable-entry controls ≥44px** (insert pill, Remove, drag grip) and keep the Remove label visible on phones. `src/components/job/JobChecklistEditor.tsx`
- **Full-size Sync/Finalise buttons on mobile** (currently `text-xs py-1.5`). `src/components/cargo/VoyageWorkspace.tsx`
- **Bump surveyor timeframe pills + CSV button to ≥40px** on phones. `src/app/(dashboard)/surveyor/page.tsx`
- **Render the checklist PDF action once, in the top action bar** for any read-only state, instead of inside the green "submitted" banner and a second floating copy. `src/components/job/JobChecklistEditor.tsx`
- **Remove the hard-coded "M.V." prefix** in the checklist job-info banner (use the normalised name). `src/components/job/JobChecklistEditor.tsx`

---

## 5. Web vs mobile strategy

**Desktop (admin + office) — use the width, add density.** The recurring desktop failure is narrow single-column layouts on wide monitors. Concretely: widen job detail, the template builder, New Job, and the cargo operations table to the `max-w-7xl` standard the design system already declares; lay out Settings, New Job, and the invoice builder as 2-column forms (Finance Settings is the model to copy); render the Inbox as a master-detail two-pane on `lg:` (list left, reading pane right) instead of a mobile list-plus-modal; and make the daily job page a two-pane (ops rail + main column) rather than a long vertical stack. Density belongs here — dense editable tables, inline cell editing, KPI rows — because these users have a mouse and want speed.

**Surveyor phones — drop admin scaffolding, restructure around data entry.** The surveyor gets the admin ops panel verbatim; that's the root problem. Per surveyor screen: (a) checklist first, admin Workflow stepper hidden entirely; (b) OT/km logs rendered as stacked full-width 44px inputs (or a bottom-sheet "Add shift"), auto-expanded on overtime jobs since they *are* the job's data; (c) cargo photo assignment gets a tap-to-place fallback (tap photo → pick hold), not drag-only, with always-visible ≥44px action buttons; (d) cargo readings get a per-period vertical entry mode below `sm` instead of a 700px-wide spreadsheet; (e) all inputs 16px to kill the zoom jolt; (f) all destructive actions (photo delete, entry remove) visible on touch and confirmed. The billing-mode toggle surveyors can now flip should be a larger segmented control with a one-tap confirm, since a mis-tap changes how they're paid.

**Clients — read-mostly, and honest about what exists.** Until the portal flag flips: don't advertise it at signup. When it returns, strip admin metadata (the "Access" permission column), use `formatDate` everywhere, and lead with content, not chrome.

**Cross-cutting: commit to the design system.** Migrate hand-rolled headers/tabs/empty-states to `PageHeader`/`ui/Tabs`/`EmptyState`, replace full-page spinners with skeletons, and standardize feedback (toast for success, inline banner only for a blocking form error). This is what makes "the same thing look the same everywhere" true.

---

## 6. Per-area appendix (remaining findings, one line each)

**Admin home / dashboard**
- *(medium)* `src/app/(dashboard)/admin/analytics/page.tsx` — Top-clients (3-col) and Labour (5-col) tables lack `overflow-x-auto`; crush on phones → wrap in a scroll container (covered in Quick Wins).
- *(low)* `src/app/(dashboard)/admin/invoicing/page.tsx` — Two unrelated "numbering" surfaces with no cross-reference and dense help copy → one-line cross-links + trim (Quick Wins).

**Admin jobs**
- *(medium)* `src/app/(dashboard)/admin/jobs/[id]/page.tsx` — Three save models on one page (inline-instant, debounced autosave, Edit-mode toggle); make Job Details fields individually click-to-edit like the list, retire page-level Edit/Save/Cancel.
- *(medium)* `src/components/job/JobOpsPanel.tsx` — Files tab keeps its 2-col grid showing one half-width card with an empty right column; give `section==='files'` a full-width layout and render attachments as a table with kind/name/size/uploaded-date/uploader.
- *(medium)* `src/app/(dashboard)/admin/jobs/new/page.tsx` — Single `max-w-2xl` column of ~11 stacked blocks; widen to `max-w-4xl`, pair related fields 2-up, and pin the auto-title preview so it stops reflowing the form mid-entry.
- *(low)* `src/app/(dashboard)/admin/jobs/page.tsx` — Four stacked control rows push the first job row down; merge secondary filters + `JobsViewToolbar` into one wrapping row.
- *(low)* `src/app/(dashboard)/admin/jobs/page.tsx` — `min-w-[1180px]` editable table has no mobile card fallback (DESIGN.md mandates stacked cards); below `md` render read-only cards with tap-through.

**Admin templates**
- *(medium)* `src/components/template-builder/FieldEditor.tsx` — Calculated-field formulas show raw UUID tokens with no human-readable readback; render a label-substituted preview (or a token-chip editor).
- *(medium)* `src/components/cargo/CargoTemplatesPanel.tsx` — Cargo templates expose hard Delete to everyone while checklist templates use archive-first/super-admin-delete; mirror the archive pattern on the cargo tab.
- *(low)* `src/components/template-builder/FieldEditor.tsx` — Purple "Insert dynamic value into label" chip row shown at full prominence on every eligible field → collapse to a link (Quick Wins).

**Admin finance**
- *(medium)* `src/components/invoicing/ConsolidatedInvoiceBuilder.tsx` — Standalone-invoice mode is triggered implicitly by ticking nothing (and silently auto-creates a job); make it an explicit "Bill completed jobs / Standalone invoice" toggle.
- *(medium)* `src/components/invoicing/InvoicesTable.tsx` — Five ~26px icon-only ghost row-actions with meaning only in tooltips (invisible on touch), Delete next to Mark-sent; keep PDF/Edit as icons, move the rest into a labeled overflow menu.
- *(medium)* `src/components/invoicing/InvoiceEditModal.tsx` — Autosaves a financial document mid-keystroke with only a "Done" button and no Cancel/revert, while all other Finance surfaces use explicit Save; either adopt Save+Cancel or make autosave honest (rename to Close, add Undo, commit money/number fields on blur).
- *(medium)* `src/components/invoicing/ConsolidatedInvoiceBuilder.tsx` — Invoice-details card is a long single-column scroll; pair Ref+Attention and place Description beside Totals (Quick Wins).

**Cargo**
- *(medium)* `src/components/cargo/VoyageWorkspace.tsx` — "Finalise report" only passes `readOnly` to the 4 DRI tabs; Setup/Readings/Photos keep editing under a "finalised" client banner. Pass the lock to all editing surfaces.
- *(medium)* `src/components/cargo/DriWizard.tsx` / `SofLogger` — Hand-rolled `cell` inputs + 10px micro-labels diverge from `.input-base`/`.label-base` and wrap raggedly on phones; adopt the design-system sizing and a 2-col grid per row below `sm`.
- *(low)* `src/components/cargo/CargoOperationsView.tsx` — 5-col operations table has no `overflow-x-auto`/card fallback on phones → covered by the widen-and-fallback quick win.

**Surveyor**
- *(medium)* `src/components/documents/VesselFolderView.tsx` / `DocumentLibraryView.tsx` — Shared docs pages give surveyors library-management chrome (New Vessel, rename, "Delete folder + ALL documents", upload card) above the read task; role-gate curation to admin and lead the surveyor view with search + document list.
- *(low)* `src/app/(dashboard)/surveyor/page.tsx` — Job cards print `created_at` while buckets use `jobDate()` (Quick Wins); "Total" tile is dead (Delete List).

**Checklist runner**
- *(medium)* `src/components/job/JobChecklistEditor.tsx` — Submit opens the confirm dialog *before* validation; on failure it dumps all missing fields as one comma-joined string with no scroll/highlight. Validate on Submit tap, outline + auto-expand + scroll to the first missing field, show a count.
- *(low)* `src/app/(dashboard)/surveyor/jobs/[id]/page.tsx` + `JobChecklistEditor.tsx` — The job is restated 3+ times (page header, editor title bar, blue "Job info" banner) before question 1; add a `hideHeader` prop and drop the job-info banner on the surveyor route.

**Client / shared**
- *(medium)* `src/app/(dashboard)/inbox/page.tsx` — Archive/mark-read only exist inside the detail modal (~3 clicks per message, no bulk); add a row-level archive action and "Mark all as read."
- *(medium)* `src/app/(dashboard)/inbox/page.tsx` — Mobile-shaped list stretched to `max-w-7xl` then opened in a modal; two-pane master-detail on `lg:` (see Web/Mobile strategy).
- *(medium)* `src/components/calendar/CalendarView.tsx` — Clicking a day (even empty) opens a DayModal with no "Add event"/"Request leave" action, dead-ending the natural click-day-to-add flow; add a prefilled-date add button.
- *(low)* `src/app/(dashboard)/inbox/page.tsx` (+ calendar, profile, client home/cargo) — Full-page `Loader2` spinners + hand-rolled empty states instead of the mandated skeletons/`EmptyState`; sweep the five pages.

**Cross-cutting lens findings folded into the above (noted here so none are lost)**
- Design-system drift — `ui/Tabs` exists but admin job detail and PeopleTabs hand-roll tab markup; `PageHeader` used by only ~10 pages; `EmptyState` by only 2; ~41 pages use spinners over skeletons; Settings uses banners where the app uses toasts; inline Save/Cancel button order is inverted vs modals. Consolidation is the "commit to the design system" thread in Section 5. Files: `src/components/ui/Tabs`, `src/components/ui/PageHeader.tsx`, `src/components/ui/EmptyState.tsx`, `src/app/(dashboard)/admin/jobs/[id]/page.tsx`, `src/app/(dashboard)/admin/settings/page.tsx`, `src/app/(dashboard)/admin/invoicing/page.tsx`.
- Mobile lens — the no-card-fallback tables (`admin/jobs/page.tsx`, `personnel/page.tsx`), the app-wide 16px input fix (`globals.css`), and the hover-invisible destructive actions all map to Top-10 items #1, #3, #5 and the appendix rows above; `personnel/page.tsx` specifically needs a stacked-card layout below `md` (contact-directory data suits cards).