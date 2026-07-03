# Claude Handoff: Tayeng Checklist Platform Design Audit

Copy/paste this whole file into Claude.

## Task For Claude

You are working in the Tayeng Checklist Platform repo, a marine-survey operations web app for Taylor Engineering (Trinidad). Stack: Next.js App Router, Tailwind, Supabase. One responsive web app serves all roles. There is no separate native app.

Read `PRODUCT.md`, `DESIGN.md`, and the files referenced below before changing code. Use the existing design system and component patterns. Do not rewrite business logic unless required to remove or relocate UI safely.

Primary goal: implement the highest-impact design cleanup from the Codex audit, with special attention to desktop width for admin/office and phone-first workflows for surveyors.

Important constraints:

- Admin and office staff use wide desktop screens for dense data work.
- Surveyors use phones in the field: one thumb, sunlight, flaky wifi, sometimes offline.
- Clients are currently disabled by `CLIENT_PORTAL_ENABLED=false`.
- Before deleting UI, re-check the code for role gates, offline paths, and second callers.
- Keep changes scoped. Prefer shared component props over duplicated role-specific forks.
- After changes, run the existing validation commands and verify key screens at desktop and mobile widths.

## Recommended Implementation Order

1. Remove disabled-client UI everywhere while `CLIENT_PORTAL_ENABLED=false`.
2. Make surveyor document routes read-only.
3. Remove random/duplicated production controls from dashboard, sidebar, jobs, and DRI report builder.
4. Fix surveyor navigation so Jobs is explicit and the first screen is phone-first.
5. Simplify checklist save/photo actions for mobile.
6. Improve hours/OT/km logging touch layout.
7. Add quick responsive fixes: table scroll wrappers, wrapping page-header actions, mobile button target sizing.
8. Use desktop width better on admin job, cargo, invoice, clients, and vessel screens.

## Highest-Impact Fixes

### 1. Surveyor Jobs IA

Files:

- `src/app/(dashboard)/surveyor/page.tsx`
- `src/app/(dashboard)/surveyor/jobs/page.tsx`
- `src/components/layout/Sidebar.tsx`

Problem: Surveyor nav says Dashboard, `/surveyor/jobs` redirects back to it, and the first screen mixes active jobs with work-summary filters and CSV export.

Recommendation: Make the first surveyor nav item `Jobs`, backed by a real `/surveyor/jobs` phone-first list with New Job, offline status, active/submitted jobs. Move work/pay summary and CSV to Profile or a desktop-only "My work" screen.

Effort: medium.

### 2. Checklist Mobile Save And Photos

Files:

- `src/components/job/JobChecklistEditor.tsx`
- `src/components/job/FieldRenderer.tsx`

Problem: Checklist fill shows autosave plus duplicate Save Draft controls, a sticky action card, Preview/PDF paths, an always-visible Additional Photos area, and photo delete buttons that only appear on hover.

Recommendation: Use one mobile bottom action bar: save state, Save now, Submit. Remove the top Save Draft, collapse Additional Photos behind a secondary action, and make photo actions always visible/tap-sized.

Effort: medium.

### 3. Hours, OT, And KM Logging

Files:

- `src/components/job/JobOpsPanel.tsx`
- `src/app/(dashboard)/surveyor/jobs/[id]/page.tsx`

Problem: Surveyors log regular hours, OT shifts, and km in tiny inline rows with 10px labels, fixed-width date/time fields, and a Save button even though rows autosave.

Recommendation: Replace inline micro-forms with full-width Add shift and Add trip forms on phone; keep dense inline editing only for desktop/admin. Remove the redundant Save button and rely on saved/unsaved status plus retry.

Effort: medium.

### 4. Cargo Phone Entry

Files:

- `src/components/cargo/VoyageWorkspace.tsx`
- `src/components/cargo/ReadingsGrid.tsx`
- `src/components/cargo/PhotoManager.tsx`
- `src/components/cargo/DriWizard.tsx`

Problem: Cargo entry is a multi-tab workspace with horizontal reading tables, drag-to-assign photos, hover-only preview/replace/delete, and dense DRI rows.

Recommendation: Build a phone mode: one hold/date/period at a time, large reading inputs, tap-to-assign photos, visible action menu, and simplified DRI wizard. Keep spreadsheet mode for desktop.

Effort: large.

### 5. Surveyor Documents Read-Only

Files:

- `src/components/documents/DocumentLibraryView.tsx`
- `src/components/documents/VesselFolderView.tsx`
- `src/app/(dashboard)/surveyor/documents/*`

Problem: Surveyors see admin document controls: New Vessel, Upload Documents, rename folder, delete folder, delete document.

Recommendation: Add a read-only surveyor mode for vessel reference documents. Surveyors should search/open/download only; admin should own create/upload/rename/delete.

Effort: quick-win.

### 6. Navigation And Disabled Client Cleanup

Files:

- `src/components/layout/Sidebar.tsx`
- `src/app/(dashboard)/admin/*`
- `src/app/(dashboard)/layout.tsx`
- `src/app/(auth)/signup/page.tsx`
- `src/components/messages/ComposeModal.tsx`
- `src/components/calendar/CalendarView.tsx`
- `src/app/(dashboard)/admin/users/page.tsx`

Problem: Admin nav omits live core areas; client-facing options still appear while `CLIENT_PORTAL_ENABLED=false`.

Recommendation: Rework nav by role: expose or deliberately nest all live admin areas, make surveyor jobs explicit, and hide all client account/messaging/calendar/signup entry points while the client portal is disabled.

Effort: medium.

### 7. Desktop Width For Admin Workflows

Files:

- `src/app/(dashboard)/admin/jobs/new/page.tsx`
- `src/app/(dashboard)/admin/jobs/[id]/page.tsx`
- `src/components/invoicing/ConsolidatedInvoiceBuilder.tsx`
- `src/components/cargo/CargoOperationsView.tsx`

Problem: On wide screens, high-volume admin workflows sit in narrow centered columns or long vertical stacks.

Recommendation: Use `max-w-7xl` layouts with two-pane forms: main editor/table on the left, selected details/actions/totals on the right. Make job detail use wider overview/checklist/file regions.

Effort: medium.

### 8. Finance Mobile Actions

Files:

- `src/components/invoicing/ConsolidatedInvoiceBuilder.tsx`
- `src/components/invoicing/LineItemsEditor.tsx`
- `src/components/invoicing/TaxEditor.tsx`
- `src/components/invoicing/InvoicesTable.tsx`

Problem: Invoice creation uses fixed grid columns such as `grid-cols-[1fr_3.5rem_6rem_5rem]`; invoice row actions are tiny icon-only buttons, including on mobile cards.

Recommendation: Keep dense grids for desktop, but switch mobile to expandable line cards and a single actions menu with 44px targets.

Effort: medium.

### 9. Admin Clients Desktop Density

Files:

- `src/app/(dashboard)/admin/clients/page.tsx`
- `src/components/clients/ClientRates.tsx`

Problem: Admin client directory uses large logo cards across desktop; rates are a separate select/list experience.

Recommendation: Default desktop clients to a dense table with logo thumbnail, billing contact, active status, job count, and actions. Keep cards for mobile. Consider a split rates view: clients left, selected rate editor right.

Effort: medium.

### 10. Random Customization And Duplicate UI

Files:

- `src/app/(dashboard)/admin/page.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/app/(dashboard)/admin/jobs/[id]/page.tsx`
- `src/components/cargo/DriReportBuilder.tsx`

Problem: The app has optional customization and duplicate/low-value controls: dashboard tile editor, menu reorder, Recent Jobs Clear/Restore, duplicate PDF download, Print preview.

Recommendation: Remove these production controls unless the owner explicitly wants personalization. Standardize actions to one primary place per screen.

Effort: quick-win.

## Delete List

- [ ] `src/components/layout/Sidebar.tsx`, `src/components/layout/SidebarReorder.tsx`: remove `Customize menu`, drag reorder, Done, and Cancel from the production sidebar.
- [ ] `src/app/(dashboard)/admin/page.tsx`: remove the dashboard tile customization panel and its add/remove/move controls.
- [ ] `src/app/(dashboard)/admin/page.tsx`: remove Recent Jobs `Clear` and `Restore`; they only hide a local dashboard list and read like data actions.
- [ ] `src/app/(dashboard)/surveyor/page.tsx`: remove/move the `CSV` export button from the surveyor landing page.
- [ ] `src/app/(dashboard)/surveyor/page.tsx`: remove/move the work-summary period chips and custom date fields from the field landing page.
- [ ] `src/components/job/JobChecklistEditor.tsx`: remove the top action-bar `Save Draft`; keep one bottom Save now/Submit area plus autosave status.
- [ ] `src/components/job/JobChecklistEditor.tsx`: remove the always-visible `Additional Photos` section from the default checklist flow; replace with a collapsed secondary action.
- [ ] `src/components/job/JobChecklistEditor.tsx`: remove hover-only photo delete overlays; replace with always-visible tap-sized actions.
- [ ] `src/components/job/JobOpsPanel.tsx`: remove the manual `Save` button in `Surveyors & hours`; the panel already autosaves and shows saved/unsaved status.
- [ ] `src/app/(dashboard)/admin/jobs/[id]/page.tsx`: remove the duplicate `Download / Share PDF` from the Overview Actions card; keep the header PDF action.
- [ ] `src/components/documents/DocumentLibraryView.tsx`: remove `New Vessel`/Create controls from surveyor document routes.
- [ ] `src/components/documents/VesselFolderView.tsx`: remove `Upload Documents`, rename, delete folder, and delete document controls from surveyor document routes.
- [ ] `src/components/cargo/DriReportBuilder.tsx`: remove `Print preview`; PDF/.docx exports plus the live preview cover the output path.
- [ ] `src/app/(dashboard)/admin/cargo/page.tsx`: remove the embedded device-local `CargoListView` from the default admin Cargo page, or collapse it under "My device drafts".
- [ ] `src/app/(auth)/signup/page.tsx`: hide `Client` self-signup while `CLIENT_PORTAL_ENABLED=false`.
- [ ] `src/components/messages/ComposeModal.tsx`: hide `All clients` broadcast while `CLIENT_PORTAL_ENABLED=false`.
- [ ] `src/components/calendar/CalendarView.tsx`: hide `Clients` event-visibility role while `CLIENT_PORTAL_ENABLED=false`.
- [ ] `src/app/(dashboard)/admin/users/page.tsx`: hide or disable creating/approving `client` users while `CLIENT_PORTAL_ENABLED=false`.
- [ ] `src/app/(dashboard)/admin/templates/[id]/edit/page.tsx`: remove duplicate manual Save buttons/sticky Save from the autosaving edit screen; keep a single saved status and a deliberate "Save now" only if needed.

## Quick Wins

- `src/components/cargo/PhotoManager.tsx`: change confirmed button text from `Set Confirmed` to `Confirmed` or `Mark unconfirmed`.
- `src/components/cargo/CargoOperationsView.tsx`: add `overflow-x-auto` around the table and consider `max-w-7xl` so admin cargo uses desktop width.
- `src/app/(dashboard)/admin/vessels/page.tsx`: add an `overflow-x-auto` wrapper around the vessels table.
- `src/app/(dashboard)/admin/overtime/page.tsx` and `src/app/(dashboard)/admin/analytics/page.tsx`: wrap tables in horizontal scroll containers for smaller screens.
- `src/app/(dashboard)/office/invoicing/page.tsx`: add the same invoice search field admin has before the filter chips.
- `src/components/ui/PageHeader.tsx`: let `actions` wrap or stack under the title on small screens.
- `src/app/globals.css`: set a mobile `min-height: 44px` for standard `btn-primary`, `btn-secondary`, `btn-danger`, and common row actions; create an explicit compact desktop-only variant for dense tables.
- `src/components/admin/PeopleTabs.tsx`: add `overflow-x-auto` like the shared `Tabs` component to avoid clipped Team/Credentials/Approvals tabs on narrow screens.
- `src/components/documents/VesselFolderView.tsx`: make document row actions 44px on mobile and put destructive actions in an overflow menu.
- `src/components/job/JobPdfButton.tsx`: shorten the default label to `PDF` on tight contexts and reserve `Download / Share PDF` for menu text.

## Role Strategy

Admin desktop: dense operations console. Use full width for tables, split-pane forms, persistent filters, and sticky summary/actions. Mobile admin only needs emergency usability.

Office: mirror admin data structures but remove write actions deliberately. If admin has search, date filters, or dense invoice/job scanning, office should usually keep those while dropping edit/delete/create.

Surveyor: phone-first and task-first. First viewport should show offline/sync status, New Job, active jobs. Checklist should emphasize current section, large answers, camera/photo controls, and one sticky Submit path. Cargo should be one hold/date/period entry flow, not a spreadsheet.

Client: keep disabled until the feature flag changes. Hide signup, client user creation, client broadcast groups, and client calendar visibility while `CLIENT_PORTAL_ENABLED=false`.

## Validation Checklist

- Run lint/type/build commands already used by the project.
- Verify desktop width around 1440px for admin jobs, clients, invoices, cargo, vessels.
- Verify mobile width around 390px for surveyor home/jobs, checklist fill, hours/OT/km, cargo readings/photos, documents.
- Check touch targets are at least about 44px on surveyor-facing controls.
- Check no client entry point remains visible while `CLIENT_PORTAL_ENABLED=false`.
- Check every removed button either has no replacement need or has one clear remaining path.

