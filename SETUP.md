# Taylor Engineering Checklist Platform — Setup

> **Live app:** https://tayeng-checklist-platform.vercel.app
> **Stack:** Next.js 16 (App Router, React 19, TS) · Supabase (Postgres/Auth/Storage/RLS) · Tailwind v3 · Vercel · Vitest

This is the from-scratch guide for standing the app up on a **new** Supabase project or a
new machine. Day-to-day conventions live in [CLAUDE.md](CLAUDE.md); the product and visual
systems are in [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md).

---

## 1. Clone and install

```bash
git clone https://github.com/taylorandrew07-lab/tayeng-checklist-platform.git
cd tayeng-checklist-platform
npm install
```

Node 20 (CI pins it; Node 18 also builds).

---

## 2. Environment variables

```bash
cp .env.local.example .env.local
```

`.env.local.example` is the authoritative list and explains every key. The runtime
minimum is:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Optional features degrade gracefully when their keys are absent: `RESEND_API_KEY`
(notification email), `MS_*` (Outlook invoice drafts), `CRON_SECRET` (protects the cron
routes — without it they return 401).

> `.env.local` is gitignored. Never commit it. If a key ever lands in git history or a
> shared document, rotate it in the Supabase dashboard (Settings → API) **and** in Vercel.

---

## 3. Database migrations

`supabase/migrations/*.sql` — numbered, idempotent, and **applied automatically**. The
[`db-migrate`](.github/workflows/db-migrate.yml) GitHub Action runs on every push to
`main` that touches `supabase/migrations/**`, applies anything new, and records applied
versions in `supabase_migrations.schema_migrations` so later runs skip them.

- **New migration:** take the next free number (`ls supabase/migrations | tail`), make it
  idempotent, and keep it paste-runnable in the Supabase SQL Editor.
- **After pushing one, always check it landed:** `gh run list --workflow=db-migrate.yml`.
  A green CI run does **not** mean the migration applied — the runner silently skips a
  duplicate version number.
- **Bootstrapping a brand-new project:** run the files in numeric order in the Supabase
  SQL Editor, or point `DATABASE_URL` at it and run `node scripts/db-migrate.mjs`.

Storage buckets (`job-photos`, `job-pdfs`, `job-files`, `client-logos`, `cargo-photos`,
`vessel-documents`, `personal-documents`, `invoice-receipts`, `competition-photos`,
`competition-video`) are created **by the migrations** along with their path-scoped RLS
policies — there is nothing to create by hand in the dashboard.

---

## 4. Create the super admin

There is no public signup for admins. On a fresh project:

1. Supabase → Authentication → Users → **Add user** — email + strong password, tick
   **Auto-confirm**.
2. SQL Editor:
   ```sql
   UPDATE profiles SET role = 'admin', is_active = true, is_super_admin = true
   WHERE email = 'andrew.taylor@tayeng.com';
   ```

Or run `node --env-file=.env.local scripts/setup-admin.mjs` after filling the `ADMIN_*`
vars.

---

## 5. Auth redirect URLs

Supabase → Authentication → URL Configuration:

- **Site URL:** `https://your-app.vercel.app`
- **Redirect URLs:** `https://your-app.vercel.app/**`

Required for password-reset and invite emails to work.

---

## 6. Run locally

```bash
npm run dev          # http://localhost:3000
```

### Gates before shipping

```bash
npx tsc --noEmit     # 0 errors
npm run lint         # 0 errors (some advisory React-Compiler warnings are expected)
npm test             # vitest
npm run build        # MUST stay `next build --webpack`
```

> **Don't "clean up" the `--webpack` flag.** Next 16's default Turbopack build fails
> collecting route-group pages. It's pinned in `package.json` and `vercel.json`.

---

## 7. Deploy

Push to `main` — Vercel builds and deploys, and `db-migrate` applies any new migrations.
For risky auth/RLS changes, branch and test on a Vercel preview first.

### GitHub Actions

| Workflow | What it does | Secrets |
|---|---|---|
| `ci.yml` | typecheck + lint + test + build on every push/PR | none |
| `db-migrate.yml` | applies new migrations on push to `main` | `DATABASE_URL` |
| `smoke.yml` | end-to-end surveyor flow against the live DB, daily + on demand | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| `job-report-reminders.yml` | fires the per-job "report due" reminders | `CRON_SECRET`, `APP_URL` |

The smoke test is documented in [e2e/README.md](e2e/README.md). Keep its repo secrets
pointed at the **live** Supabase project — they went stale once after a project migration
and the smoke test silently guarded nothing.

---

## Roles

| Role | Access |
|---|---|
| **Super admin** | Everything, including creating admins and the super-admin flag |
| **Admin** | Jobs, templates, clients, vessels, finance/invoicing, people, approvals |
| **Office** | Permission-gated slices of the admin surfaces (per-user grants, mostly read-only) |
| **Surveyor** | Their own jobs — checklists, hours/overtime, km, photos; offline-capable |
| **Client** | Read-only portal for their own company's jobs (currently disabled via `src/lib/features.ts`) |

Authorization is enforced in Postgres **RLS** (`get_my_role()`, `is_admin()`, `is_office()`,
`has_office_permission()`), never in `user_metadata`. RLS can't hide columns, so sensitive
fields live in their own admin/owner-only tables (`client_billing`, `staff_private`).

### Signup → approval

A new account signs up at `/signup` and is **inactive**. An admin reviews it under
Team/Users, picks the linked client company for client accounts, and approves — approval
also confirms the auth email so the person can actually sign in.

---

## Layout

```
src/
  app/
    (auth)/                ← login, signup, forgot/reset password
    (dashboard)/           ← admin · surveyor · office · client + shared (/inbox, /profile)
    api/                   ← pdf, admin/create-user, messages/send, cron/*
  components/              ← job · template-builder · cargo · invoicing · personal-docs · ui · layout
  lib/                     ← supabase · jobs · checklist · pdf · messages · email · types
supabase/migrations/       ← all schema + RLS + buckets (numbered, idempotent, auto-applied)
e2e/                       ← smoke + audit scripts
scripts/                   ← one-off ops (run with --env-file=.env.local)
```

Cross-role pages (e.g. `/inbox`, `/profile`) must be added to `SHARED_ROUTES` in the
dashboard layout or users get bounced to their role's home.

---

## Troubleshooting

**Someone can't sign in after approval** — Team → Password to reset/unlock them.

**Login lands on the wrong dashboard** — the dashboard layout redirects on `profiles.role`.
Fix the role in the DB (`scripts/set-admin-role.mjs`, or SQL).

**A migration "ran" but nothing changed** — check
`gh run list --workflow=db-migrate.yml`. Also note a `LANGUAGE sql` function that reads a
table created *later in the same migration* aborts the whole file; add
`SET check_function_bodies = off`.

**Build fails collecting route-group pages** — the `--webpack` flag was dropped. Put it back.
