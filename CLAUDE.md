# CLAUDE.md — Taylor Engineering Checklist Platform

Next.js 16 (App Router) + Supabase (Postgres + RLS + Storage), TypeScript. Offline-first
PWA. Roles: admin / surveyor / client / office. DB schema & policies live in
`supabase/migrations/*.sql` (numbered, idempotent; auto-applied on push).

## Codebase map (graphify)

A graphify knowledge graph of this repo lives in `graphify-out/` (git-ignored) and
auto-rebuilds on every commit via a post-commit hook. How to use it well — calibrated
from an audit of graphify *on this repo*:

- **DO** use `graphify explain "<Symbol>"` for a single symbol's neighborhood, and skim
  `graphify-out/GRAPH_REPORT.md` (god-nodes, community map, "Import Cycles: none") for a
  fast orientation on where things live.
- **DON'T** trust `graphify query` / `graphify path` for data-flow or "who writes/reads
  table X" questions — the graph is **undirected** and every traversal collapses toward the
  `createClient()` hub (211 edges). Use `grep` for those; it's faster and correct here.
- **NEVER** conclude code is dead/unused from the graph. JSX component usage and type-only
  imports produce **no** edge, so graphify's dead-code / orphan lists are ~100% false
  positives on this codebase. Always confirm with `grep`/Read before deleting anything.
- The graph is intentionally **code-only and undirected**. A `--directed` rebuild collapses
  the edge set to near-empty on this repo — don't switch it.

## Conventions

- Commit & push to `main` (Vercel deploys; migrations auto-apply via the db-migrate Action).
- New migrations: use the next free number (`ls supabase/migrations | tail`), make them
  idempotent, and paste-runnable in the Supabase SQL Editor.
- Postgres RLS can't hide columns — sensitive fields go in their own admin/owner-only table
  (see `client_billing` mig 077, `staff_private` mig 130), never as columns on a broadly
  readable table.
