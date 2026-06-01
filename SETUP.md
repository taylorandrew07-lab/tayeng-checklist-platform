# Taylor Engineering Checklist Platform — Setup Guide

> **Live app:** https://tayeng-checklist-platform.vercel.app  
> **Stack:** Next.js 14 · Supabase (Postgres + Auth + Storage) · Vercel

---

## ⚠️ Security — Rotate Exposed Keys First

All credentials that appear in `scripts/*.mjs` (now removed from those files), git history,
or any shared document **must be rotated** before this app is treated as secure:

| What | Where to rotate |
|------|----------------|
| Supabase anon key | Supabase dashboard → Settings → API → Regenerate |
| Supabase service role key | Supabase dashboard → Settings → API → Regenerate |
| Supabase access token | supabase.com → Account → Access tokens → Revoke & create new |
| Admin password | Supabase Auth → Users → Reset password |
| Vercel env vars | Vercel → Project → Settings → Environment Variables (update after rotating) |

---

## Prerequisites

- Node.js 18 LTS
- A Supabase project
- A Vercel account (or any Node.js host)

---

## 1. Clone and install

```bash
git clone https://github.com/your-org/tayeng-checklist-platform.git
cd tayeng-checklist-platform
npm install
```

---

## 2. Environment variables

```bash
cp .env.local.example .env.local
```

Fill in `.env.local` with your Supabase project credentials (Settings → API):

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
```

Optionally add Resend for admin email notifications:

```env
RESEND_API_KEY=re_your_key
```

> `.env.local` is gitignored. Never commit it.

---

## 3. Run database migrations

In your Supabase project → **SQL Editor**, run the migration files **in order**:

1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_rls_policies.sql`
3. `supabase/migrations/003_enhancements.sql`
4. `supabase/migrations/004_auth_hardening.sql`
5. `supabase/migrations/005_production_hardening.sql`

Each file is idempotent — safe to re-run.

---

## 4. Create storage buckets

In Supabase SQL Editor:

```sql
INSERT INTO storage.buckets (id, name, public) VALUES ('job-photos', 'job-photos', false) ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('job-pdfs',   'job-pdfs',   false) ON CONFLICT DO NOTHING;

-- Allow authenticated users to upload/read/delete photos
CREATE POLICY "Auth upload photos"  ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'job-photos' AND auth.role() = 'authenticated');
CREATE POLICY "Auth read photos"    ON storage.objects FOR SELECT USING (bucket_id = 'job-photos' AND auth.role() = 'authenticated');
CREATE POLICY "Auth delete photos"  ON storage.objects FOR DELETE USING (bucket_id = 'job-photos' AND auth.role() = 'authenticated');
```

---

## 5. Create the Super Admin account

The first admin account must be created directly in Supabase — there is no public signup for admins.

**Option A — Supabase dashboard (recommended):**

1. Supabase → Authentication → Users → **Add user**
2. Enter `andrew.taylor@tayeng.com` and a strong password, tick "Auto-confirm"
3. In SQL Editor:
   ```sql
   -- Migration 005 already does this if run after the user exists:
   UPDATE profiles SET role = 'admin', is_active = true, is_super_admin = true
   WHERE email = 'andrew.taylor@tayeng.com';
   ```

**Option B — Script:**

```bash
# Fill in ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_FULL_NAME in .env.local first
node --env-file=.env.local scripts/setup-admin.mjs
```

---

## 6. Configure Supabase Auth redirect URLs

Supabase → Authentication → URL Configuration:

- **Site URL:** `https://your-app.vercel.app`
- **Redirect URLs:** `https://your-app.vercel.app/**`

This is required for password reset emails to work.

---

## 7. Run locally

```bash
npm run dev
# → http://localhost:3000
```

---

## 8. Deploy to Vercel

1. Push to GitHub
2. Import repo in Vercel → New Project
3. Add environment variables (copy from `.env.local`, excluding script-only vars)
4. Deploy

---

## User Roles & Workflow

| Role | Access |
|------|--------|
| **Super Admin** | Everything — can create/manage admin accounts, set super admin flag |
| **Admin** | Templates, checklists, approve surveyor/client accounts (non-admin only) |
| **Surveyor** | Create and complete their own checklists |
| **Client** | View permitted checklists for their client company only |

### Approval workflow

1. User signs up at `/signup` → account is **inactive** by default
2. Admin receives an email notification (if Resend is configured)
3. Admin goes to **Users** page → Reviews pending accounts
4. For client-role accounts: admin must select the linked client company before activating
5. User is notified (optional) — they can now log in

### Surveyor checklist flow

```
Surveyor creates checklist → fills fields → Save Draft (any time)
→ Submit → Admin reviews → can download PDF → set client-visible
→ Client sees checklist (permissions controlled per-job)
```

---

## Architecture

```
src/
  app/
    (auth)/               ← Login, signup, forgot/reset password
    (dashboard)/
      admin/              ← Templates, checklists, users, clients
      surveyor/           ← Create and complete checklists
      client/             ← Read-only job portal (per-client RLS)
    api/
      pdf/[jobId]/        ← Server-side PDF (auth + client permission check)
      admin/create-user/  ← Service-role user creation
      notify/admin/       ← Email notifications via Resend
  components/
    job/                  ← Checklist editor, field renderer, signature pad
    template-builder/     ← Drag-and-drop template editor
    layout/               ← Sidebar, header
    ui/                   ← Shared UI components
  lib/
    supabase/             ← Client and server Supabase clients
    pdf/                  ← React PDF template
    types/                ← TypeScript interfaces
    utils/                ← Utilities, formatting
supabase/
  migrations/             ← All database SQL (run in order 001–005)
scripts/                  ← One-time ops (gitignored, use env vars via --env-file)
```

---

## Troubleshooting

**Login redirects to wrong role dashboard**  
The dashboard layout reads `profiles.role` and redirects to `/admin`, `/surveyor`, or `/client` accordingly. If the role in the DB is wrong, run:  
`UPDATE profiles SET role = 'admin' WHERE email = 'your@email.com';`

**PDF download fails**  
Ensure `@react-pdf/renderer` is in `serverComponentsExternalPackages` in `next.config.js`. Verify the job status is `submitted`, `completed`, or `client_visible`.

**Client cannot see jobs**  
Check: (a) `client_users` row exists linking profile_id → client_id, (b) `client_job_permissions` row exists for that client_id + job_id.

**Profile stuck as inactive**  
Admin must approve in Users → Pending Accounts. Or run:  
`UPDATE profiles SET is_active = true WHERE email = 'user@example.com';`

**Email notifications not sending**  
Set `RESEND_API_KEY` in Vercel env vars and verify your sending domain at resend.com. Notifications silently skip if the key is missing.
