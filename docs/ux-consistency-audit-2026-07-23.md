# Tayeng — Whole‑App UX / Consistency Audit (2026‑07‑23)

_Read‑only senior UX/UI + engineering audit of the entire app, run before the usage‑tracking
phase. Method: 20 subagents (11 area finders + 4 cross‑cutting sweeps, then a deep gap‑fill of
cargo / surveyor / job‑components / clients / the Save‑button sweep), plus an adversarial critic
pass that verified findings against the code. Every finding is grounded in a real `file:line`._

**Headline:** Your *foundation* is genuinely consistent — the low‑level layer (`.btn-*`,
`.input-base`, `.card`, colour tokens, the single toast channel, and especially your
confirmation system) is excellent. `window.confirm`/`alert` appears **nowhere**; every
list‑level destructive action routes through the shared `confirmDialog` with proper
"cannot be undone" copy. The problem is **one level up**: the *composite* primitives
`DESIGN.md` says every page must use — **PageHeader (used on ~8 of ~54 pages), EmptyState
(2 pages), Tabs (3 of ~9 tab bars)** — are almost always hand‑rolled, so headers, empty
states, tab bars, and the **Save / Edit / Delete** actions have drifted screen‑by‑screen.
The cargo module (20 components) and every surveyor page bypass the composite primitives
entirely.

> **Recommendation:** before building analytics, do one focused **"primitive adoption +
> action standardization"** pass. It's mostly mechanical, touches nearly every screen, and is
> the single highest‑leverage way to make the app feel uniform. **Fix the 5 real bugs
> immediately, regardless** (see §1).

---

## 1. Real bugs — fix now (small, user‑facing)

| # | Bug | Where | Fix |
|---|-----|-------|-----|
| 1 | **Unconfirmed destructive offline deletes.** Cargo photo delete and reading‑type / point deletes fire the instant the trash is tapped — destroying offline‑only, not‑yet‑synced data. Every *list*-level cargo delete and the checklist photo delete *do* confirm, so the easiest‑to‑mistap deletes are the only unguarded ones. | `src/components/cargo/PhotoManager.tsx:185,288,319`; `src/components/cargo/ReadingTypeManager.tsx:46,318` | Route through `confirmDialog({danger:true})` (or an undo‑toast). |
| 2 | **Stale calendar legend** — doesn't match the grid colour map. | `src/components/calendar/CalendarView.tsx:51-58` vs `:32-37` | Drop the phantom teal `invoiced`; add slate `#94a3b8` **"closed"** (jobs render it); relabel green `#22c55e` from "approved" → **"Invoice ready"** (colour is right, label is stale post‑status‑collapse). |
| 3 | **Invoice edit modal has ZERO guards.** The create builder blocks a currency/bank mismatch; the edit path has no such code, so it can *save* a currency the create flow would refuse. | `src/components/invoicing/InvoiceEditModal.tsx` vs `ConsolidatedInvoiceBuilder.tsx:107,108,264-276` | Extract a shared `BankAccountPicker` carrying all three guards; use in create **and** edit. |
| 4 | **Surveyor New Job has no double‑booking check.** The admin twin live‑checks conflicts and shows a "Possible double‑booking" warning; the surveyor form lets you pick co‑surveyors + times with no check, though `checkSurveyorConflicts` already exists. | `src/app/(dashboard)/admin/jobs/new/page.tsx:107-121,348-362` vs `src/app/(dashboard)/surveyor/jobs/new/page.tsx:466-481` | Run the shared conflict check on the surveyor form and render the amber warning. |
| 5 | **Blank legacy status pill.** Hand‑inlined workflow pills skip `normalizeWorkflowStatus`, so a cached pre‑mig‑145 status renders as an empty badge. | `src/components/job/JobChecklistEditor.tsx:1346`; `src/components/job/JobOpsPanel.tsx:688` | Replace inline spans with `<WorkflowPill status={…}/>`. |

---

## 2. High‑severity themes (consistency & parity)

### 2.1 Save / Add / Create / Submit is placed & labelled differently on nearly every screen — *your #1 concern, now fully mapped*
The single "save/commit this record" action lands in **five distinct placements**:
- **modal footer** (clients / users create+edit — the clean case)
- **page‑header top‑right** (template *edit*, admin & surveyor job detail "Save")
- **sticky bottom‑4 bar** (template *new* "Save Template", checklist Save Draft/Submit)
- **non‑sticky bottom, `flex justify-end`** (admin & surveyor job *new*, profile)
- **left‑aligned bottom‑of‑card, no wrapper** (settings "Save Format", `settings:200`)

**Create‑vs‑edit twins are built to diverge:**
- Templates: *new* = sticky bottom "**Save Template**" (`templates/new/page.tsx:448`) vs *edit* = header top‑right "**Save**" (`templates/[id]/edit/page.tsx:391`).
- Jobs: admin "**Create Job**"/"Creating…" (`admin/jobs/new:445`) vs surveyor "**Start Job**"/"Start Checklist"/"Starting…" (`surveyor/jobs/new:500`) — *for the identical `createDraftJob` seam*.
- Clients: edit saves footer‑right (`clients/page:344`), a rate saves inline‑left **with** a Save icon (`ClientRates:200`), the detail colour **autosaves silently** on pick (`clients/[id]:32-38`).

**Verb flips within one flow:** Users trigger "Add member" (`users:369`) → submit "Create User" (`users:557`). Inline "Add a sub‑item" spans three button classes (`LineItemsEditor` btn‑ghost, vessels btn‑primary, JobOpsPanel/new‑job btn‑secondary). The Download/Generate‑report action has **three homes**. The ops‑panel's "Save" is a tiny amber **text link** ("Unsaved changes — save now", `JobOpsPanel:731`).

→ **Fix:** one Save model per surface type (see spec rule 2); unify the create verb across role twins; make trigger and submit verbs agree; one inline‑Add treatment; one Download‑report home. Extract a shared `TemplateBuilderSaveBar` and a shared new‑job submit so twins can't drift again.

### 2.2 PageHeader bypassed on ~46 of ~54 pages
Only 8 files import `PageHeader`; the rest rebuild title+subtitle+actions inline, so icon‑tile presence, subtitle spacing, icon colour, and action placement drift. **Two whole zones are 100% hand‑rolled:** the cargo module (`CargoListView:88`, `CargoOperationsView:67`, `VoyageWorkspace:170`, `ClientCargoWorkspace:79`, `client/cargo:24`, `office/cargo:27`) and every surveyor surface (`surveyor/page:263-271`, `jobs/new:291-297`, `jobs/[id]:190-215`). This is the root cause of the inconsistent Save/Edit placement above — no shared contract forces actions into one slot.

### 2.3 EmptyState bypassed everywhere — 30+ divergent hand‑rolled empties
Only 2 files import `EmptyState`. Elsewhere: `card p-8/p-10/p-12`, `text-gray-400` vs `text-gray-500`, icon/no‑icon, CTA/no‑CTA, bare `<p>No … yet</p>`. `PhotoManager:310` literally renders **"Nothing here."** — the exact anti‑pattern `DESIGN.md` names. Cargo never uses it once; neither do the surveyor surfaces.

### 2.4 Edit action inconsistent — three ways on the client surfaces alone
Icon (`Edit` square‑pencil vs `Pencil`), style (btn‑secondary / btn‑ghost / bare `text-brand` link), label ("Edit" / "Edit details" / "Edit Template"), and behaviour (modal / inline / navigate‑away) all drift. Worst case — clients: directory card = btn‑ghost + Pencil opening a modal; **detail header = a Link that navigates *away* to `/admin/clients?focus=<id>` then re‑pops the modal on the grid** (`clients/[id]:102`), losing scroll/context; ClientRates row = bare `text-brand` link. On mobile the detail Edit collapses to an **unlabelled Pencil with no `aria-label`**.

→ **Fix:** extract the Edit‑Client modal into a shared component and mount it on the detail page so Edit opens in place instead of round‑tripping through `?focus`.

### 2.5 Delete trigger fractured — four idioms on one job screen; `.btn-danger` never used on a real delete
The **same** destructive action renders four ways across the job editor + ops panel: red circular‑X overlay (`JobChecklistEditor:1619,1858`), "Remove" + Trash2 (`:1758`), btn‑ghost + Trash2 (`JobOpsPanel:851`), btn‑ghost + bare **X** (`:284,335,378,417`). X and Trash2 are used interchangeably for delete. `.btn-danger` is used **only** inside `ConfirmDialog.tsx:45` — dead as an action button. `BackGuard:63` overrides btn‑primary with `bg-red-600` **and lightens on hover** (the opposite of the standard darken).
> _Note (verified): `ClientRates:139` and `admin/invoicing:572` already share the byte‑identical target styling — their only defect is the **X glyph** (should be Trash2)._

### 2.6 Tables don't degrade to mobile cards — destructive row actions off‑screen on phones
A correct table→card pattern exists (client dashboard, office jobs, the **InvoicesTable exemplar**) but was **not** applied to: admin/users, vessels (list + detail), the admin jobs grid, the personnel "Credentials" page, the admin/invoicing **bank‑accounts** table (delete at `:572`), the client‑facing `ClientReadingsView`, and `CargoOperationsView` (6‑col company‑wide voyage table that only `overflow-x`‑scrolls, while its sibling `CargoListView` already stacks). The admin jobs grid has **worse** mobile UX than the near‑identical office jobs list (`sm:hidden` at `:182`) — the more‑privileged role gets the worse phone experience.

### 2.7 Status/role/cargo pills reimplemented inline; four primitives never built
`WorkflowPill`/`InvoiceStatusPill` exist and are used well, but: admin/jobs re‑declares byte‑identical `INV_PILL`/`INV_LABEL`; `admin/clients/[id]:239` hand‑rolls `invStatusClass()` duplicating `InvoiceStatusPill`; and `JobChecklistEditor`/`JobOpsPanel` inline the workflow pill (causing bug #5). **Four missing primitives:** `ClientStatusPill` (advertised in `DESIGN.md:23` but never exported; active/inactive inlined 3+ ways), `RolePill`, `TemplateStatusPill`, and `CargoStatusPill` (in‑progress/finalized inlined with **disagreeing colours** — amber vs sky — and **two spellings**, "Finalised" vs "Finalized").

### 2.8 Duplicated logic & markup that has already drifted
- Accessible `Toggle` lives only in `FieldEditor.tsx:36-41`; the template editors hand‑roll it as bare `div`‑onClick **9+ times** (a keyboard/a11y regression).
- The "Unsaved changes" leave‑dialog is **triplicated** as raw `fixed inset-0` overlays (`JobChecklistEditor:2037`, `templates/new:466`, `templates/[id]/edit:578`).
- `STAGE_OPTIONS`/`CARGO_JOB_TYPES`/`CARGO_SUGGESTIONS`/`TAP_BTN` + date helpers copy‑pasted across **three** job files and already diverged.
- Inside `JobOpsPanel`, the **overtime log (`:319-360`) and regular log (`:362-402`) are ~80‑line copy‑paste twins**.
- Three confirmation idioms coexist in the checklist editor; the Preview modal re‑implements the field‑render path instead of reusing `FieldRenderer` read‑only; two near‑identical cargo photo lightboxes.

---

## 3. Medium‑severity themes

- **Loading = spinners, not the mandated skeletons** — universal across every surveyor page (blank spinning screens on the weak field wifi they're designed for) and every cargo view (client‑facing).
- **Tabs primitive underused** — cargo hand‑rolls **four** tab styles; `ClientCargoWorkspace` + inbox omit the `bg-brand-50/60` active fill so their active tab looks different from the rest of the app.
- **Feedback split** between toast and inline banners for the same action class (jobs detail mixes both on one screen; settings uses a green banner where the app toasts).
- **Segmented/pick‑one controls fragmented** into 4+ visual languages (invoicing alone has three); booleans mix Toggle switches and plain checkboxes in one panel.
- **Over‑fetching / refetch‑everything on small mutations** — job detail refetches full lookup lists on every field save; `JobOpsPanel.reload()` re‑fetches all surveyors+attachments+activity+billable‑hours on *every* debounced autosave / km / shift change (heavy on flaky wifi); the surveyor dashboard ships the whole company‑wide open‑jobs table to a phone then filters client‑side; flipping one client `is_active` re‑downloads every job row.
- **Modal lacks dialog semantics** (`role=dialog`, `aria-modal`, focus trap/restore) — app‑wide; ~9 overlays bypass `ui/Modal`; the non‑portaled checklist Preview re‑introduces the clip‑in‑transformed‑ancestor bug Modal was built to fix; hover‑only thumbnail delete buttons are keyboard‑unreachable.
- **Touch targets < 44px** — worst on the field‑facing surfaces: cargo per‑photo controls are hover‑only **and** ~20px (unreachable on touch); the surveyor dashboard's most‑tapped controls (Add me / CSV / period pills / New Job) are all sub‑44px even though the New Job form is careful via `TAP_BTN`; in‑field checklist controls (Insert here / Collapse / Remove / Import) miss it too.
- **Dark mode is fully styled dead code** — `darkMode:'class'` + extensive `dark:` variants exist, but `<html>` never gets a `dark` class, there's no theme code, and the shell is hardcoded light. Finish it or strip it.
- **Sign‑out has two implementations** — the Sidebar confirms + wipes localStorage/IndexedDB/SW caches; the gate‑screen "Sign out" only calls `supabase.auth.signOut()` (leaves cached data on a shared device).
- **Nav parity asymmetric + global search desktop‑only** — `GlobalSearch` is `hidden sm:flex` + Cmd/Ctrl+K only, so mobile‑first surveyors **can't search at all**; surveyor‑only Profile nav item with a wrong `FileText` icon; missing Vessel Documents links; an empty `office/documents` dead dir.

---

## 4. Low‑severity themes
- Inconsistent terminology (Team/member/user; surveyor "Open/Completed" vs pills "Closed"; office "Ongoing" vs "In progress"); stale "Back to checklists" aria‑label; the cargo "Set Confirmed" label reads backwards when already confirmed.
- Count badges styled three ways in the shared layer (yellow vs amber).
- Dates rendered three ways (`formatDate()` exists but is bypassed by `PersonalDocsManager`, `CredentialsManager`, `VesselFolderView`, profile‑requests).
- Assorted slips: raw `ℹ`/`⚠` glyphs, native `<input type=color>` instead of `ColorSwatchPicker`, no shared `StatCard`/`AuthBrand`/`ClientLogo`/`RecentJobsList`, `animate-rise` applied inconsistently even between role twins, undocumented `z-[60]` toast exception.

---

## 5. The Standardization Spec — hold every PR to these

1. **Page headers.** Every page uses `<PageHeader icon title subtitle actions/>`. Add one optional `back` slot for detail pages. The primary page action always lives in the `actions` slot, right‑aligned. Migrate the whole cargo module + every surveyor page.
2. **Save / Submit / Add** *(the #1 rule — pin placement AND verb)*:
   - **Modal edits** → primary in the modal footer, right‑aligned, spinner + "Saving…"; Cancel (btn‑secondary) to its left. Never auto‑save in a modal. (This is already the app's cleanest surface — converge toward it.)
   - **Full‑page create OR edit** → identical chrome for both twins; primary submit in **one sticky bottom action bar** that appears when dirty; Cancel immediately left. Never a bare header‑right save or a left‑aligned bottom‑of‑card save. Auto‑save must show a "Saving…/Saved" status line and no flickering manual button.
   - **Verb:** same verb for a create twin across roles ("Create Job" on both admin + surveyor, "Save Template" on both). Pick one create/edit pair app‑wide ("Add X"/"Create X" for create, "Save changes" for edit) and make trigger + submit agree.
   - **Inline "Add a row"** → one treatment everywhere. **Download/Generate report** → one home (PageHeader actions).
   - Button style always `.btn-primary` + Save icon; never re‑pad ad hoc (add a documented `.btn-sm`).
3. **Edit.** One icon (Pencil), one class (`.btn-secondary`), one label ("Edit", always visible or aria‑labelled), one behaviour (inline or modal — same surface from every entry point). No bare `text-brand` Edit links; no reaching edit via `?focus` navigation.
4. **Delete + confirm.** Keep the confirm layer. Build **one shared `RowDeleteButton`** = `Trash2`, `gray-400`→`red-600` hover (one red shade app‑wide), optional label, `deleting` spinner, keyboard‑reachable, confirm wired. X = dismiss **only**; circle‑X overlay = image thumbnails only. `.btn-danger` for header‑level deletes and BackGuard logout. **Every** destructive action confirms — including cargo photo / reading‑type deletes.
5. **Empty states.** Every page‑level empty and not‑found uses `<EmptyState/>`; use its action slot for CTAs.
6. **Loading.** `.skeleton` placeholders shaped like the content. No mid‑content spinners (auth‑gate is the one documented exception).
7. **Tabs.** All tab bars use `<Tabs>` (active = `border-brand-600 text-brand-700 bg-brand-50/60`). A genuinely distinct stepper may stay bespoke if documented.
8. **Badges/pills.** One pill per domain; no inline colour maps. Build `ClientStatusPill`, `RolePill`, `TemplateStatusPill`, `CargoStatusPill` (one colour map, one spelling); add a generic `<Badge tone=…>`.
9. **Feedback.** Page‑level create/save/delete → toast; inline banners only for in‑form/in‑modal validation. Never mix on one page.
10. **Mobile parity.** Every data table with row actions ships a stacked‑card fallback at **one** breakpoint via a shared `ResponsiveTable`/`DataList` (model: `InvoicesTable`). Row actions reachable without horizontal scroll. Every control ≥44px on mobile. Feature parity too (surveyor New Job runs the same conflict check as admin).
11. **Toggles / segmented controls.** Promote the accessible `Toggle` to `ui/Toggle`; ban `div`‑onClick toggles. One shared `<SegmentedControl>` for pick‑one pills.
12. **Shared constants/logic.** Business taxonomy + date helpers live in one module (`lib/jobs/newJobConfig.ts`) and are imported. Extract one `UnsavedChangesDialog`, `BankAccountPicker`, `<TimeLog kind>`, `PhotoLightbox`, `ClientLogo`, `Avatar`, `ExpiryPill`. Reuse `FieldRenderer` read‑only for Preview. All dates through `formatDate()`.
13. **Modals + confirm idiom.** Every overlay uses `ui/Modal` (portal, Esc, scroll‑lock). Add `role=dialog`/`aria-modal`/`aria-labelledby` + focus trap/restore once. Standardise on the imperative `confirmDialog()` for yes/no; reserve declarative `<ConfirmDialog>` for rich bodies only. Overlays `z-50`; document the toast `z-[60]` exception.

---

## 6. Quick wins (small, high‑signal)
1. Fix the 5 real bugs (§1).
2. Fix the create‑verb twin drift: surveyor New Job → "Create Job" (match admin); make the Users modal trigger + submit agree.
3. Replace hand‑inlined workflow pills with `<WorkflowPill/>` (also fixes bug #5).
4. Build the 4 missing pills; delete inline copies + `INV_PILL`/`invStatusClass`.
5. Swap X → Trash2 on ClientRates / bank‑account / line‑item deletes (styling already matches).
6. Promote `Toggle` to `ui/Toggle`; replace the 9+ hand‑rolled toggles.
7. Move job taxonomy + date helpers into `lib/jobs/newJobConfig.ts`.
8. Extract one `UnsavedChangesDialog`.
9. Make cargo photo controls tap‑visible + ≥44px; add `group-focus-within:opacity-100` to hover‑only delete buttons.
10. `<PageHeader icon={Receipt} title="Finance"/>` on office invoicing (one‑liner); route BackGuard logout through `.btn-danger`.
11. Fix the "Back to checklists" aria‑label → "Back to jobs"; add `aria-label="Edit client"`.
12. Add `animate-rise` to the surveyor New Job wrapper.
13. Extract one `signOut()` helper; resolve the empty `office/documents` dir + wrong nav icon.

---

## 7. What's genuinely good (preserve these)
- **Confirmation is fully consolidated** at the list level (0 `window.confirm` hits) — the model to extend to the granular deletes.
- The **low‑level token/primitive layer** matches `DESIGN.md` and is near‑universally adopted; toasts single‑sourced.
- The **hardcoded‑hex ban is clean** — hex confined to PDFs/charts/canvas/PWA meta.
- A **correct table→card mobile pattern already ships** (`InvoicesTable` — the exemplar for the future `ResponsiveTable`).
- **`admin/templates` list page is the model design‑system citizen** (PageHeader + Tabs + EmptyState + shared btn‑* + confirmDialog, degrades cleanly).
- The **modal‑footer save pattern** (clients/users) is the cleanest save surface — the convergence target for full‑page forms.
- **Several surveyor routes are thin wrappers** over shared components — role parity by construction.
- The **checklist submit flow is unusually resilient** (`submitJobWithRetry` retries + verifies `submitted_at`; missing‑field errors are tap‑to‑scroll buttons via `jumpToField`). Consider promoting `jumpToField`‑style "tap to fix" into a shared helper.
- The **cargo offline engine** (IndexedDB sync, multi‑point readings, colour rules, finalise gate) is solid — issues are confined to the UI‑consistency layer, not the data engine.

---

### Suggested sequencing
1. **Bug‑fix batch** (§1) — ship immediately.
2. **Primitive foundation** — build `RowDeleteButton`, `ResponsiveTable`, `ui/Toggle`, `SegmentedControl`, the 4 pills, `UnsavedChangesDialog`, `BankAccountPicker`, add `back` slot to PageHeader + dialog semantics to Modal. (Enables everything else.)
3. **Adoption sweep** — migrate cargo + surveyor first (they diverge most), then the rest, screen by screen against §5. Update `DESIGN.md` (Tabs is now shared; document the Save/verb rule, `.btn-sm`, and the z‑index exception).
4. **Then** instrument for the analytics phase — see `docs/usage-analytics-plan.md`.
