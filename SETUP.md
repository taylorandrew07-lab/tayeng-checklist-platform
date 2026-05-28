# Taylor Engineering Checklist Platform — Setup Instructions

## Prerequisites

- Node.js 18+ (LTS recommended)
- npm or yarn
- A Supabase account (free tier works)
- A Vercel account (for deployment)

---

## 1. Install Dependencies

```bash
npm install
```

---

## 2. Supabase Setup

### 2.1 Create a Project

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. Choose a strong database password and save it.
3. Wait for the project to be provisioned.

### 2.2 Run Database Migrations

In your Supabase project, go to **SQL Editor** and run these files **in order**:

1. Copy and paste the contents of `supabase/migrations/001_initial_schema.sql` → Execute
2. Copy and paste the contents of `supabase/migrations/002_rls_policies.sql` → Execute

### 2.3 Create Storage Buckets

In **SQL Editor**, run:

```sql
INSERT INTO storage.buckets (id, name, public) VALUES ('job-photos', 'job-photos', false);
INSERT INTO storage.buckets (id, name, public) VALUES ('job-pdfs', 'job-pdfs', false);

-- Storage policies
CREATE POLICY "Authenticated users can upload photos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'job-photos' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can view photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'job-photos' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete own photos"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'job-photos' AND auth.role() = 'authenticated');
```

### 2.4 Create the First Admin User

1. Go to **Authentication → Users** in Supabase dashboard.
2. Click **Invite user** or **Add user** and create the first admin account with your email.
3. After the user is created, go to **SQL Editor** and run:

```sql
UPDATE profiles
SET role = 'admin', full_name = 'Your Name Here'
WHERE email = 'your-admin-email@tayeng.com';
```

---

## 3. Environment Variables

Copy `.env.local.example` to `.env.local`:

```bash
cp .env.local.example .env.local
```

Fill in the values from your Supabase project settings:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_COMPANY_NAME=Taylor Engineering
NEXT_PUBLIC_COMPANY_EMAIL=info@tayeng.com
NEXT_PUBLIC_COMPANY_PHONE=+61 X XXXX XXXX
NEXT_PUBLIC_COMPANY_ADDRESS=Your Address, City, State
```

> **Security:** Never commit `.env.local` to version control. The service role key bypasses RLS — keep it server-side only.

---

## 4. Run Locally

```bash
npm run dev
```

Navigate to `http://localhost:3000` and sign in with your admin credentials.

---

## 5. Vercel Deployment

### 5.1 Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/your-org/tayeng-checklist-app.git
git push -u origin main
```

### 5.2 Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) → **New Project**
2. Import your GitHub repository
3. Framework preset: **Next.js** (auto-detected)
4. Add all environment variables from `.env.local` in the Vercel dashboard under **Settings → Environment Variables**
5. Click **Deploy**

### 5.3 Configure Supabase for Production

In your Supabase project settings:

1. Go to **Authentication → URL Configuration**
2. Set **Site URL** to your Vercel deployment URL (e.g., `https://tayeng-app.vercel.app`)
3. Add your Vercel URL to **Redirect URLs**:
   - `https://tayeng-app.vercel.app/**`

---

## 6. PWA Installation

The app is configured as a Progressive Web App. Users can install it on:

- **iPhone/iPad:** Open in Safari → Share → Add to Home Screen
- **Android:** Open in Chrome → Menu → Add to Home Screen  
- **Desktop (Chrome/Edge):** Click the install icon in the address bar

---

## 7. User Roles

| Role | Access |
|------|--------|
| **Admin** | Full access — create templates, jobs, users, clients |
| **Surveyor** | Complete assigned jobs, export PDFs |
| **Client** | View permitted jobs and PDFs only |

### Creating Users

Admins create users through the **Users** page in the admin panel. The system uses Supabase Auth — users receive an invite email and set their own password.

**Or** create users directly in Supabase Authentication → Users, then update their role in the `profiles` table.

---

## 8. Template Builder Guide

1. Go to **Admin → Templates → New Template**
2. Set the template name, description, and status
3. Add **sections** to organize the checklist
4. Within each section, add **fields** of any type:
   - **Text, Number, Date, Time** — basic data entry
   - **Dropdown, Yes/No, Multiple Choice** — selection fields
   - **Long Text / Remarks** — multi-line text
   - **Calculated** — auto-calculated from other number fields
   - **Photo Upload** — marks a photo capture point
   - **Signature** — captured on-screen via touch/mouse
   - **Section Heading, Divider** — layout elements
5. Set **conditional logic** on any field or section to show/hide based on other answers
6. Mark fields as **Required** to enforce completion before submission
7. Set status to **Active** to make the template available for jobs

---

## 9. Job Workflow

```
Admin creates job → Assigns to surveyor → Surveyor opens job
→ Surveyor fills all fields → Surveyor submits
→ Admin can download PDF and control client visibility
→ Client views job status / PDF (if permitted)
```

---

## 10. PDF Export

- Generated server-side using `@react-pdf/renderer`
- Includes: Taylor Engineering header/footer, job number, all completed fields, signatures
- **Photos are excluded by default**
- Available to: Admin (always), Surveyor (their submitted jobs), Client (if PDF permission enabled)

---

## Architecture

```
src/
  app/
    (auth)/login/          ← Login page
    (dashboard)/
      admin/               ← Admin panel (templates, jobs, users, clients)
      surveyor/            ← Surveyor job completion interface
      client/              ← Client viewing portal
    api/
      pdf/[jobId]/         ← Server-side PDF generation
      admin/create-user/   ← Admin user creation endpoint
  components/
    template-builder/      ← Drag-and-drop template editor
    job/                   ← Field renderer, signature pad
    layout/                ← Sidebar, header
    ui/                    ← Shared UI components
  lib/
    supabase/              ← Client and server Supabase clients
    pdf/                   ← PDF template (React PDF)
    types/                 ← TypeScript interfaces
    utils/                 ← Utilities, formatting, calculations
supabase/
  migrations/              ← Database schema SQL
```

---

## Troubleshooting

**"profile is undefined" after login** — Run the migration SQL again. The `handle_new_user` trigger may not have fired. Manually insert: `INSERT INTO profiles (id, email, full_name, role) VALUES ('your-auth-uid', 'email', 'Name', 'admin');`

**PDF generation fails** — Make sure `@react-pdf/renderer` is in `serverComponentsExternalPackages` in `next.config.js`. Also ensure the job has a valid `template_id`.

**Storage uploads fail** — Verify the storage buckets exist and the policies are applied. Check the Supabase storage dashboard.

**Client cannot see jobs** — Ensure `client_job_permissions` record exists for the job/client combination AND the client user is linked via `client_users`.
