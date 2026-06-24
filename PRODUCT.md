# Tayeng Checklist Platform — PRODUCT.md

**Register:** product (app UI / internal operations tool). Design **serves** the task; earned familiarity over novelty.

**What it is:** the internal operations platform for **Taylor Engineering** (Taylor Engineering Ltd., a marine‑survey firm in Trinidad). Surveyors run vessel inspections from checklists (offline‑capable, on phones); admins run the whole pipeline — jobs, vessels, clients, templates, cargo‑monitoring voyages, and invoicing/finance; office staff get permissioned read/manage views.

**Primary users & context:**
- **Surveyors** — on phones, dockside/aboard, often on flaky connectivity. Need fast, forgiving checklist entry that never loses work (offline drafts + auto‑save). Mobile‑first.
- **Admins** — on desktop, managing jobs → reports → invoices, client rates, vessels, personnel/credentials, analytics. Density and speed matter.
- **Office** — desktop, permission‑gated slices of the admin surfaces (read‑only or limited manage).
- **Clients** — portal currently disabled (`src/lib/features.ts`).

**Top‑level areas (IA):** Home · Jobs · Insights · Finance · Templates · Cargo · Vessels · Clients · Team/Credentials (People) · Calendar · Inbox. One canonical name per concept across every role (an active IA redesign — see `memory/project-ia-redesign-v3.md`).

**Design principles:**
1. **The tool disappears into the task.** Familiar product patterns (side‑nav, tabs, tables, modals only when justified). No novelty for its own sake.
2. **Homogeneous.** Same name, same component, same shape for the same thing everywhere. Shared primitives (PageHeader, EmptyState, StatusPill) over per‑page reinvention.
3. **Minimal + professional.** Restrained colour (one brand blue accent), generous desktop width, quiet typography, density where data needs it.
4. **Never lose work.** Offline drafts, debounced auto‑save, retry‑and‑verify on submit. Forgiving on bad connections.
5. **Don't break it.** Every change ships build + tests + smoke green; migrations are idempotent and auto‑apply.

**Stack:** Next.js 16 (App Router, React 19, TS) · Supabase (Postgres/Auth/Storage/RLS) · Tailwind v3 · Vercel · Vitest. See `DESIGN.md` for the visual system.
