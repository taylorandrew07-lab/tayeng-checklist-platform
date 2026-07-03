# Tayeng Checklist Platform Design Audit

Date: 2026-07-03  
Scope: read-only design/usability audit of `src/app` pages plus imported components, after reading `PRODUCT.md` and `DESIGN.md`. No application files were modified.

## Executive Summary

1. Desktop admin/office screens often behave like enlarged mobile screens. Several dense workflows are centered at `max-w-2xl` to `max-w-4xl` or stacked vertically, so wide monitors do not get the split panes, sticky summaries, and dense tables the office actually needs.
2. Surveyor phone flows carry office/reporting UI into field tasks. The surveyor home shows work-summary filters and CSV export before jobs; job detail shows hours/files before checklist work; cargo readings/photos use spreadsheet and drag interactions that are painful in sunlight and one-handed use.
3. Save semantics are inconsistent. The app mixes autosave, manual Save, sticky Save, header Save, and confirm-on-submit patterns. Users see multiple Save controls even where the code comments say autosave is active.
4. Role information architecture has drift. Admin has live core areas that are not in the main nav; surveyor has no Jobs nav even though jobs are the main job; client UI remains visible in signup/messages/calendar/users while the client portal is deliberately off.
5. Touch affordances are the main mobile failure mode. The worst offenders are hover-only photo actions, tiny icon buttons, `text-[10px]`/`py-0.5` inline log controls, and horizontal tables that technically scroll but are still not field-friendly.

## Top 10 Highest-Impact Fixes

| Rank | Severity | Files | What the user sees | Recommendation | Effort |
|---:|---|---|---|---|---|
| 1 | High | `src/app/(dashboard)/surveyor/page.tsx`, `src/app/(dashboard)/surveyor/jobs/page.tsx`, `src/components/layout/Sidebar.tsx` | Surveyor nav says Dashboard, `/surveyor/jobs` redirects back to it, and the first screen mixes active jobs with work-summary filters and CSV export. | Make the first surveyor nav item `Jobs`, backed by a real `/surveyor/jobs` phone-first list with New Job, offline status, active/submitted jobs. Move work/pay summary and CSV to Profile or a desktop-only "My work" screen. | Medium |
| 2 | High | `src/components/job/JobChecklistEditor.tsx`, `src/components/job/FieldRenderer.tsx` | Checklist fill shows autosave plus duplicate Save Draft controls, a sticky action card, Preview/PDF paths, an always-visible "Additional Photos" area, and photo delete buttons that only appear on hover. | Use one mobile bottom action bar: save state, Save now, Submit. Remove the top Save Draft, collapse Additional Photos behind a secondary action, and make photo actions always visible/tap-sized. | Medium |
| 3 | High | `src/components/job/JobOpsPanel.tsx`, `src/app/(dashboard)/surveyor/jobs/[id]/page.tsx` | Surveyors log regular hours, OT shifts, and km in tiny inline rows with 10px labels, fixed-width date/time fields, and a Save button even though rows autosave. | Replace the inline micro-forms with full-width "Add shift" and "Add trip" forms on phone; keep dense inline editing only for desktop/admin. Remove the redundant Save button and rely on saved/unsaved status plus retry. | Medium |
| 4 | High | `src/components/cargo/VoyageWorkspace.tsx`, `src/components/cargo/ReadingsGrid.tsx`, `src/components/cargo/PhotoManager.tsx`, `src/components/cargo/DriWizard.tsx` | Cargo entry is a multi-tab workspace with horizontal reading tables, drag-to-assign photos, hover-only preview/replace/delete, and very dense DRI rows. | Build a phone mode: one hold/date/period at a time, large reading inputs, tap-to-assign photos, visible action menu, and a simplified DRI wizard. Keep spreadsheet mode for desktop. | Large |
| 5 | High | `src/components/documents/DocumentLibraryView.tsx`, `src/components/documents/VesselFolderView.tsx`, `src/app/(dashboard)/surveyor/documents/*` | Surveyors see admin document controls: New Vessel, Upload Documents, rename folder, delete folder, delete document. | Add a read-only surveyor mode for vessel reference documents. Surveyors should search/open/download only; admin should own create/upload/rename/delete. | Quick-win |
| 6 | Medium | `src/components/layout/Sidebar.tsx`, `src/app/(dashboard)/admin/*`, `src/app/(dashboard)/layout.tsx`, `src/app/(auth)/signup/page.tsx`, `src/components/messages/ComposeModal.tsx`, `src/components/calendar/CalendarView.tsx` | Admin nav omits Vessels, Vessel Documents, Insights/Analytics, Overtime, and Profile Requests; client-facing options still appear while `CLIENT_PORTAL_ENABLED=false`. | Rework nav by role: expose or deliberately nest all live admin areas, make surveyor jobs explicit, and hide all client account/messaging/calendar/signup entry points while the client portal is disabled. | Medium |
| 7 | Medium | `src/app/(dashboard)/admin/jobs/new/page.tsx`, `src/app/(dashboard)/admin/jobs/[id]/page.tsx`, `src/components/invoicing/ConsolidatedInvoiceBuilder.tsx`, `src/components/cargo/CargoOperationsView.tsx` | On wide screens, high-volume admin workflows sit in narrow centered columns or long vertical stacks. | Use `max-w-7xl` layouts with two-pane forms: main editor/table on the left, selected details/actions/totals on the right. Make job detail use wider overview/checklist/file regions. | Medium |
| 8 | Medium | `src/components/invoicing/ConsolidatedInvoiceBuilder.tsx`, `src/components/invoicing/LineItemsEditor.tsx`, `src/components/invoicing/TaxEditor.tsx`, `src/components/invoicing/InvoicesTable.tsx` | Invoice creation uses fixed grid columns such as `grid-cols-[1fr_3.5rem_6rem_5rem]`; invoice row actions are tiny icon-only buttons, including on mobile cards. | Keep dense grids for desktop, but switch mobile to expandable line cards and a single actions menu with 44px targets. | Medium |
| 9 | Medium | `src/app/(dashboard)/admin/clients/page.tsx`, `src/components/clients/ClientRates.tsx` | Admin client directory uses large logo cards across desktop; rates are a separate select/list experience. | Default desktop clients to a dense table with logo thumbnail, billing contact, active status, job count, and actions. Keep cards for mobile. Consider a split rates view: clients left, selected rate editor right. | Medium |
| 10 | Medium | `src/app/(dashboard)/admin/page.tsx`, `src/components/layout/Sidebar.tsx`, `src/app/(dashboard)/admin/jobs/[id]/page.tsx`, `src/components/cargo/DriReportBuilder.tsx` | The app has optional customization and duplicate/low-value controls: dashboard tile editor, menu reorder, Recent Jobs Clear/Restore, duplicate PDF download, Print preview. | Remove these production controls unless the owner explicitly wants personalization. Standardize actions to one primary place per screen. | Quick-win |

## THE DELETE LIST

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

- Medium, quick-win: `src/components/cargo/PhotoManager.tsx` - change confirmed button text from `Set Confirmed` to `Confirmed` or `Mark unconfirmed`.
- Medium, quick-win: `src/components/cargo/CargoOperationsView.tsx` - add `overflow-x-auto` around the table and consider `max-w-7xl` so admin cargo uses desktop width.
- Medium, quick-win: `src/app/(dashboard)/admin/vessels/page.tsx` - add an `overflow-x-auto` wrapper around the vessels table.
- Medium, quick-win: `src/app/(dashboard)/admin/overtime/page.tsx` and `src/app/(dashboard)/admin/analytics/page.tsx` - wrap tables in horizontal scroll containers for smaller screens.
- Medium, quick-win: `src/app/(dashboard)/office/invoicing/page.tsx` - add the same invoice search field admin has before the filter chips.
- Medium, quick-win: `src/components/ui/PageHeader.tsx` - let `actions` wrap or stack under the title on small screens; many page headers currently assume one short action.
- Medium, quick-win: `src/app/globals.css` - set a mobile `min-height: 44px` for standard `btn-primary`, `btn-secondary`, `btn-danger`, and common row actions; create an explicit compact desktop-only variant for dense tables.
- Low, quick-win: `src/components/admin/PeopleTabs.tsx` - add `overflow-x-auto` like the shared `Tabs` component to avoid clipped Team/Credentials/Approvals tabs on narrow screens.
- Low, quick-win: `src/components/documents/VesselFolderView.tsx` - make document row actions 44px on mobile and put destructive actions in an overflow menu.
- Low, quick-win: `src/components/job/JobPdfButton.tsx` - shorten the default label to `PDF` on tight contexts and reserve `Download / Share PDF` for menu text.

## Web vs Mobile Strategy

Admin desktop should be a dense operations console. Use the full width for tables, split-pane forms, persistent filters, and sticky summary/actions. Mobile admin can be serviceable, but it does not need to be the design center.

Office should mirror admin data structures but remove write actions deliberately. Avoid stale copied screens: if admin has search, date filters, or dense invoice/job scanning, office should usually keep those while dropping edit/delete/create.

Surveyor should be phone-first and task-first. First viewport: offline/sync status, New Job, active jobs. Checklist: current section, large answers, camera/photo controls, one sticky Submit path. Cargo: one hold/date/period entry flow, not a spreadsheet. Export, CSV, report generation, and payroll summaries should move out of the field-first path.

Client should be treated as disabled until the flag changes. While `CLIENT_PORTAL_ENABLED=false`, hide client signup, client user creation, client broadcast groups, and client calendar visibility. When restored, client screens should stay read-only with PDF/cargo viewing as the primary actions and no management chrome.

## Per-Area Appendix

### Auth And Client Portal

- High, quick-win: `src/app/(auth)/signup/page.tsx` offers Client signup even though `src/lib/features.ts` disables client login and `src/app/(dashboard)/layout.tsx` shows "Portal unavailable"; hide the option until launch.
- Medium, quick-win: `src/components/messages/ComposeModal.tsx` and `src/components/calendar/CalendarView.tsx` still expose client recipient/visibility groups; hide them while clients cannot use the portal.
- Low, no change: `src/app/(auth)/login/page.tsx`, `forgot-password/page.tsx`, `reset-password/page.tsx`, and `src/app/offline/page.tsx` are clear and focused.

### Navigation Shell

- High, medium: `src/components/layout/Sidebar.tsx` omits live admin areas (`/admin/vessels`, `/admin/documents`, `/admin/analytics`, `/admin/overtime`, `/admin/profile-requests`) from the main IA; add or deliberately nest them.
- High, quick-win: `src/app/(dashboard)/surveyor/jobs/page.tsx` is a redirect and `src/components/layout/Sidebar.tsx` has no Jobs item; make Jobs explicit for surveyors.
- Medium, quick-win: `src/components/layout/Header.tsx` hides global search below `sm`; acceptable for surveyors, but admin/office mobile loses a useful escape hatch.
- Medium, quick-win: `src/components/layout/Sidebar.tsx` menu customization adds low-value personalization to a utilitarian ops app; remove it.

### Admin Dashboard

- Medium, quick-win: `src/app/(dashboard)/admin/page.tsx` tile customization is more UI than value for a small operations team; remove it.
- Medium, quick-win: `src/app/(dashboard)/admin/page.tsx` Recent Jobs `Clear`/`Restore` reads like data manipulation but only affects the dashboard list; remove it.
- Low, medium: `src/app/(dashboard)/admin/page.tsx` quick actions duplicate nav destinations; keep only if usage data shows they help.

### Jobs And Checklist

- Medium, medium: `src/app/(dashboard)/admin/jobs/page.tsx` is strong for desktop but has a `min-w-[1180px]` table and no mobile card fallback; acceptable for admin desktop, but add a read-only stacked fallback for emergency mobile use.
- Medium, medium: `src/app/(dashboard)/admin/jobs/new/page.tsx` is `max-w-2xl` and mostly one column; use a wider two-column layout with assignment/billing details separated.
- Medium, medium: `src/app/(dashboard)/admin/jobs/[id]/page.tsx` is `max-w-4xl` and duplicates PDF actions; widen detail layout and keep one PDF action.
- Low, no change: `src/app/(dashboard)/office/jobs/page.tsx` is a good deliberate reduction of admin jobs, with desktop table plus mobile cards.
- High, medium: `src/app/(dashboard)/surveyor/jobs/[id]/page.tsx` puts the operations/hours panel before the checklist; make checklist the default focus and move hours/files below or behind tabs.
- High, medium: `src/components/job/JobChecklistEditor.tsx` has duplicate Save Draft controls plus autosave; simplify to one save/submit path.
- High, quick-win: `src/components/job/JobChecklistEditor.tsx` photo delete buttons use `opacity-0 group-hover:opacity-100`; make actions visible and touch-sized.
- High, medium: `src/components/job/JobOpsPanel.tsx` OT/km logging uses 10px labels and `py-0.5` fields; replace with mobile stacked forms.

### Templates

- Medium, quick-win: `src/app/(dashboard)/admin/templates/[id]/edit/page.tsx` autosaves but still shows top Save, footer Save, sticky Save, and leave-dialog Save; standardize to saved status plus one deliberate "Save now" if needed.
- Medium, medium: `src/components/template-builder/TemplateBuilder.tsx` is powerful but crowded with drag handles, insert buttons, collapse states, and tiny delete actions; keep as desktop-first and avoid promising mobile editing.
- Low, no change: `src/app/(dashboard)/admin/templates/page.tsx` and cargo templates are coherent; action buttons are compact but admin-facing.

### Cargo

- Medium, quick-win: `src/app/(dashboard)/admin/cargo/page.tsx` shows both company-wide synced voyages and device-local voyages; collapse or remove the local device list from the default admin page.
- Medium, quick-win: `src/components/cargo/CargoOperationsView.tsx` is capped at `max-w-4xl` and lacks horizontal scroll; widen and wrap the table.
- High, large: `src/components/cargo/ReadingsGrid.tsx` is a spreadsheet on a phone; build card/stepper entry for surveyors.
- High, medium: `src/components/cargo/PhotoManager.tsx` relies on drag correction and hover-only overlay actions; add tap assignment and visible controls.
- Medium, medium: `src/components/cargo/DriWizard.tsx` uses tiny repeatable rows and fixed widths; use larger stacked sections or treat DRI as office/desktop.
- Medium, quick-win: `src/components/cargo/DriReportBuilder.tsx` has PDF, .docx, and Print preview; remove Print preview.
- Low, no change: `src/components/cargo/ClientCargoWorkspace.tsx` is reasonable read-only scaffolding, but it is dormant while the portal is off.

### Finance

- Medium, medium: `src/components/invoicing/ConsolidatedInvoiceBuilder.tsx` is a long vertical create flow; use a two-pane desktop layout with selected jobs/lines left and invoice details/totals right.
- Medium, medium: `src/components/invoicing/LineItemsEditor.tsx` and `TaxEditor.tsx` use fixed grid columns; create mobile card rows.
- Medium, medium: `src/components/invoicing/InvoicesTable.tsx` uses tiny icon-only actions; replace mobile actions with a menu or larger buttons.
- Medium, quick-win: `src/app/(dashboard)/office/invoicing/page.tsx` lacks admin's invoice search; add it for parity.
- Low, no change: `src/components/invoicing/InvoiceEditModal.tsx` autosave plus Done is a clearer model than most other edit flows.

### Clients, Vessels, Documents

- Medium, medium: `src/app/(dashboard)/admin/clients/page.tsx` uses large cards for desktop client admin; switch to a dense desktop table and keep cards mobile.
- Medium, medium: `src/components/clients/ClientRates.tsx` starts with a client select and separate list; a desktop split view would reduce context switching.
- Medium, quick-win: `src/app/(dashboard)/admin/vessels/page.tsx` is live but not in nav and its table lacks `overflow-x-auto`; add nav and scroll wrapper.
- High, quick-win: `src/components/documents/DocumentLibraryView.tsx` and `VesselFolderView.tsx` expose management controls to surveyors; make surveyor documents read-only.
- Low, medium: `src/app/(dashboard)/office/documents/page.tsx` lists every surveyor as full credential cards; useful but long. Add search/collapse if the staff list grows.

### Team, Personnel, Profile

- Medium, medium: `src/app/(dashboard)/admin/users/page.tsx` still creates/approves client users while clients cannot log in; hide client user paths while the flag is off.
- Medium, no change: `src/app/(dashboard)/personnel/page.tsx` is intentionally spreadsheet-like for office/admin desktop; keep it desktop-first and avoid surfacing to surveyors.
- Low, quick-win: `src/components/personal-docs/PersonalDocsManager.tsx` and `CredentialsManager.tsx` have small edit/delete/open buttons; increase touch targets for profile use on phones.
- Low, no change: `src/app/(dashboard)/profile/page.tsx` has clear approval semantics and a useful offline warning.

### Calendar, Inbox, Tools

- Medium, medium: `src/components/calendar/CalendarView.tsx` month grid is tiny on phone (`min-h-[60px]`, 10px chips); switch surveyor mobile to agenda list by default.
- Low, no change: `src/app/(dashboard)/inbox/page.tsx` and `src/components/messages/ComposeModal.tsx` are simple and consistent, aside from the disabled-client role issue.
- Low, no change: `src/components/tools/InterpolationCalculator.tsx` is one of the better phone-first tools; the custom keypad is appropriate for field use.

### Settings, Analytics, Overtime

- Medium, medium: `src/app/(dashboard)/admin/settings/page.tsx` is hidden under super-admin-only Settings, but it also contains Job Types and Photo Retention; consider splitting common admin list maintenance from dangerous super-admin numbering.
- Medium, quick-win: `src/app/(dashboard)/admin/analytics/page.tsx` and `src/app/(dashboard)/admin/overtime/page.tsx` are not in nav and their tables are desktop-first; expose them under Insights and add scroll wrappers.
- Low, no change: `src/components/admin/PhotoRetentionPanel.tsx` uses clear warning copy and confirmation for destructive cleanup.
