# Tayeng — DESIGN.md (the visual system)

Restrained product UI: one brand blue, neutral surfaces, Inter, full interaction
states. Source of truth: `src/app/globals.css`. **Reuse these — don't reinvent.**

## Colour
- **Brand:** `--brand: 29 78 216` (blue‑700) via `rgb(var(--brand) / α)`; Tailwind `brand-*`. Accent only — primary actions, current selection, state indicators. Not decoration.
- **Surfaces:** body `bg-gray-50` (dark `gray-950`); cards `bg-white` (dark `gray-900`); borders `gray-200`.
- **Status colour = meaning, kept consistent.** Job workflow → `WORKFLOW[*].pill/dot` (`lib/jobs/tracker`). Invoice → `InvoiceStatusPill`. Calendar/charts use raw hex only because the libraries require colour strings.
- Raw hex is allowed ONLY where CSS classes can't reach: canvas (SignaturePad), SVG (ChartsPanel), the calendar lib (CalendarView), PWA meta. Everywhere else use tokens/Tailwind.

## Typography
- **One family:** Inter (`system-ui` fallback), `font-feature-settings: 'cv11','ss01'`, antialiased.
- `.page-title` = `text-2xl font-semibold tracking-tight` + `text-wrap: balance`. `.section-title` = `text-lg font-semibold`. Hierarchy by size, weight stays semibold (quiet, not shouty).
- `.tnum` (tabular‑nums) on every figure/stat/money/id.

## Components (shared — always use these)
- **Buttons:** `.btn-primary` / `.btn-secondary` / `.btn-danger` / `.btn-ghost`. All include hover + `active:scale-[0.98]` press + `focus-visible` ring + disabled. Icons `h-4 w-4`, gap‑2.
- **Inputs:** `.input-base` + `.label-base` (hover/focus/disabled states built in).
- **Card:** `.card` (rounded‑xl, border, `shadow-sm`, `transition-shadow`). Static container by default; add `hover:` only when the whole card is a link/button. Never nest cards.
- **PageHeader** (`components/ui/PageHeader`): every page's header — optional brand icon tile + title + subtitle + right‑aligned `actions`. Don't hand‑roll headers.
- **EmptyState** (`components/ui/EmptyState`): every page‑level empty — soft icon + title + description + action. Not "nothing here."
- **Status pills** (`components/job/StatusPill`): `WorkflowPill`, `ClientStatusPill`, `InvoiceStatusPill`. One badge per domain; don't inline new colour maps.
- **Modal** (`components/ui/Modal`): `sm|md|lg|xl`. Modals only when inline/progressive won't do.
- **Loading = skeletons** (`.skeleton`), not spinners mid‑content.
- **Tabs:** `border-b-2 -mb-px rounded-t-md` active = `border-brand-600 text-brand-700 bg-brand-50/60` (see Finance/Templates/PeopleTabs). _Not yet a shared component — a `Tabs` primitive is the next consolidation._

## Layout
- Page wrapper: `max-w-7xl mx-auto space-y-6` (content pages widened to 7xl for desktop). Forms/detail keep narrower (`max-w-3xl/4xl/lg`) for readability.
- Responsiveness is structural (sidebar collapses `lg:`, tables → stacked cards on mobile), not fluid type. Mobile‑first for surveyor surfaces.

## Motion
- Easing tokens: `--ease-out-strong` / `--ease-in-out-strong` (stronger than CSS defaults).
- `.animate-rise` — subtle opacity+8px entrance, ~360ms. Used on dashboards. _Applied inconsistently across pages; standardize when touched._
- Buttons press (`active:scale-[0.98]`). Transitions 150ms, ease‑out. Motion conveys state, never decoration.
- **Reduced motion respected** (`@media (prefers-reduced-motion: reduce)`): movement off, content stays visible.

## Focus / a11y
- Global `:focus-visible` brand outline fallback (keyboard only). Design‑system classes set their own focus ring. Never remove focus without a replacement. Touch targets ≥ 44px on mobile.

## Bans (already clean — keep it that way)
No gradient text, no side‑stripe accent borders, no decorative glassmorphism (modal scrim blur is fine), no hard‑coded colours in class contexts, no per‑page reinvented headers/empties/pills, no arbitrary z‑index (overlays use `z-50`).
