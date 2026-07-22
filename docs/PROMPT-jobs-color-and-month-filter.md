# Build Prompt — Jobs: color-coding (by client / job type) + month/year filter

Tayeng App (Next.js 16 App Router + React 19 + TS + Tailwind + Supabase). Read HANDOFF.md.
Migrations are HAND-RUN by the user — write idempotent numbered .sql (use the next UNUSED number; check supabase/migrations/), never apply them. Build is `next build --webpack`. Gates before commit: `npx tsc --noEmit`, `npm run lint` (0 errors), `npm test`, `npm run build`. No PR unless asked.

## Goal
In the Jobs section, let the user (1) color-code job rows by CLIENT or by JOB TYPE (template), with adaptable, user-chosen colors from a curated palette (NOT hard-coded per job), and (2) filter the jobs list by month and/or year (e.g. "All of 2026" or "June 2026").

## Reuse what exists
- Color aesthetic: copy the light-tint-bg + dark-text style from src/lib/cargo/colors.ts (e.g. GREEN {bg:'#dcfce7',fg:'#166534'}). Keep colors soft and readable.
- Jobs list: src/app/(dashboard)/admin/jobs/page.tsx (table). Also apply to src/app/(dashboard)/surveyor/jobs/page.tsx and src/app/(dashboard)/office/jobs/page.tsx, and the dashboard "recent jobs" lists if easy.
- Status badge helper pattern: getJobStatusColor in src/lib/utils. Existing per-user view prefs: profiles.ui_prefs (migration 024); simple per-device prefs use localStorage (see admin dashboard CLEARED_AT_KEY).
- Types: src/lib/types/database.ts (Client, ChecklistTemplate). Clients already have logo_path; add color similarly.

## Part 1 — Curated, adaptable color palette (shared)
Create src/lib/jobs/colors.ts:
- Export a curated palette array of ~12 options, each { key, label, bg, fg } with a LIGHT bg hex + readable DARK fg hex (e.g. slate, gray, rose, orange, amber, yellow, emerald, teal, sky, indigo, violet, pink). One place, easy to extend = "adaptable, not hard-coded".
- Export resolveColor(key: string | null): { bg, fg } | null and a default/neutral fallback.
- Store a palette KEY (e.g. 'teal') on the entity, NOT raw hex, so the look stays curated and can evolve centrally. (If the user wants fully custom hex later, that's a follow-up.)

## Part 2 — Assign colors to clients and templates (migration + UI)
- Migration (next unused number): add nullable `color TEXT` to public.clients AND to public.checklist_templates. Idempotent (ADD COLUMN IF NOT EXISTS). No RLS change needed (existing admin policies already allow managing these rows) — but VERIFY the existing UPDATE policies cover the new column; note if a migration tweak is needed.
- Add the columns to the Client and ChecklistTemplate interfaces.
- UI to pick a color:
  - Client form (src/app/(dashboard)/admin/clients/page.tsx): a swatch picker showing the palette; saves clients.color.
  - Template builder/editor (src/components/template-builder/* or src/app/(dashboard)/admin/templates/[id]/edit): a swatch picker; saves checklist_templates.color.
  - Swatch picker = small reusable component rendering the palette as clickable chips (selected state + a "None" option).

## Part 3 — Color-mode toggle on the jobs list
- Add a control near the page header: "Color by: None | Client | Job Type" (segmented buttons or a small dropdown).
- Persist the choice per user (localStorage key e.g. `jobsColorMode`; or profiles.ui_prefs if you prefer cross-device — match the existing ui_prefs merge pattern).
- The jobs query already joins template(name) and client(name); ALSO select template:checklist_templates(name,color) and client:clients(name,color).
- Apply the resolved color to each job row as a clear-but-tasteful cue: a LEFT color bar (e.g. a 4px colored left border / leading cell) plus a soft row background tint using {bg}, with text staying readable. Add a small legend showing which color = which client/type for the current mode. When mode = None, render rows as today.
- Make it work in the table (admin/office) and the card layout (surveyor) consistently.

## Part 4 — Month / Year filter
- Add a filter control: a Year selector + a Month selector (Month options: "All months", January…December). Examples it must support: "All of 2026" (year=2026, month=All) and "June 2026" (year=2026, month=June).
- Derive available years from the loaded jobs; default to the current year, month = All. Include an "All time" escape option.
- Filter on a single, clearly-labeled date field — default created_at; if scheduled_date is more meaningful for "monthly situation", make the field a small toggle or confirm with the user. Filtering can be CLIENT-SIDE on the already-loaded list (use date-fns). If the jobs list could grow large, instead filter server-side with a created_at range (gte/lt) — note which you chose.
- Persist the filter selection per user (localStorage), and show the active filter + a count ("June 2026 · 7 jobs").

## Deliverables
- src/lib/jobs/colors.ts (palette + resolver), a reusable swatch-picker component, migration adding clients.color + checklist_templates.color, color pickers in the client + template forms, color-mode toggle + legend + month/year filter on the jobs list(s), interfaces updated.
- Keep it accessible: don't rely on color alone (keep the existing text labels); ensure contrast with the dark-fg palette.
- All gates green. Update HANDOFF.md. Hand-run the migration yourself per your normal process; the agent must NOT apply it.

## Open decisions (use these defaults; confirm if you disagree)
1. Color cue style: left bar + soft row tint (recommended) vs. just a colored dot.
2. Date field for the filter: created_at (default) vs. scheduled_date.
3. Persist view prefs in localStorage (default, per-device) vs. profiles.ui_prefs (cross-device).
