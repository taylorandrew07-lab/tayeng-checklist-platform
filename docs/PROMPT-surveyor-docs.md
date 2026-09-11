# Build Prompt — Surveyor Personal Documents, Profiles & Expiry Reminders

> Paste this whole file into a fresh Claude Code session in VS Code to build the feature.
> It is written against the existing Tayeng App codebase and its conventions (see `HANDOFF.md`).

---

## What I want built

Let any **surveyor** maintain (a) a richer employee profile and (b) their own credential
documents with issue/expiry dates, and proactively remind the surveyor + admins (+ opted-in
office staff) when a document is approaching expiry. **Office** staff can view/download these
documents to produce port passes. **Admins/super-admin** can do everything and are notified of
upcoming expiries.

Documents are things like port passes, driver's license, passport, COC (Certificate of Good
Character), medicals, safety training certs, etc. The surveyor types the document name
themselves; each document has an optional issue/initial date and an expiry date.

**Self-edit model: DIRECT edit** — surveyors edit their own profile fields and documents
instantly, no approval queue (this is different from the name/email change-request flow).
Admins can edit/override anyone's.

**Reminders: email + in-app.** A daily scheduled job emails the owner + admins (+ opted-in
office); the dashboards also show an in-app "expiring documents" widget.

---

## Existing app facts — DO NOT re-derive (reuse these patterns)

- **Stack:** Next.js 16.2.7 (App Router, TS) + React 19 + Tailwind + Supabase
  (Postgres/Auth/Storage/RLS) + Vercel. Production build is `next build --webpack` (pinned in
  `vercel.json` — do not remove the `--webpack` flag).
- **Roles:** `admin`, `surveyor`, `client`, `office` (enum `user_role`) + `is_super_admin`
  flag on `profiles`. Super admin id: `77fdfdae-f417-4f95-853d-a9fc48bfab8d`.
- **Authorization is enforced in Postgres RLS** via SECURITY-DEFINER helpers that already
  exist: `is_admin()`, `is_office()`, `has_office_permission(key)`, `is_active_staff()`
  (active admin/surveyor). Never gate on `user_metadata`.
- **Migrations are hand-run by the user** in the Supabase SQL Editor. Write **idempotent**,
  numbered SQL — next file is **035**. "Paste-the-whole-file" style. NEVER run migrations via
  CLI or push DB changes; write the `.sql` and tell the user to run it.
- **Reuse these precedents:**
  - *Document storage:* migration `029_vessel_documents.sql` — private bucket, path-scoped
    storage RLS, signed URLs (`createSignedUrl(path, 3600)`). Data-access style in
    `src/lib/documents/api.ts` (upload-to-storage-then-insert-row; on row failure, roll back
    the storage object; delete removes storage then row). UI in `src/components/documents/`.
  - *Office capabilities:* migration `025_office_role.sql` — `office_permission_catalog` +
    `office_user_permissions`, gated by `has_office_permission(key)`. Add new capabilities as
    catalog keys; do NOT build a parallel permission system. Helper:
    `src/lib/office/permissions.ts`.
  - *Email:* `src/app/api/notify/admin/route.ts` uses **Resend** (`RESEND_API_KEY`) and has
    `escapeHtml` / `safeSubject` / `sendEmail` helpers + an in-memory rate limit. It currently
    hardcodes a single `ADMIN_EMAIL` recipient.
  - *Self-edit profile columns:* migration `004_auth_hardening.sql` enforces a "safe own
    profile fields" allowlist (a user may self-update only specific columns; `role`/`email`/
    `is_active`/`is_super_admin`/`ui_prefs` stay locked). You MUST extend that allowlist
    mechanism — mirror whatever it uses (column-diff trigger or policy `WITH CHECK`).
  - *Service-role server work:* `createServiceClient` in `src/lib/supabase/server.ts`
    (see `/api/profile-requests/[id]/review/route.ts` for the pattern).
- **Types:** all DB row types live in `src/lib/types/database.ts` — update it.
- **Gates before pushing (all must pass):** `npx tsc --noEmit`, `npm run lint` (0 errors;
  pre-existing React-Compiler warnings are OK), `npm test`, `npm run build`. Push code to
  `main` only after verified. Update `HANDOFF.md` with what shipped + which migration is
  pending.
- There is **no scheduled-job infrastructure today** — the cron route below is net-new.

---

## Part 1 — Employee profile fields (migration 035)

Add nullable `TEXT` columns to `public.profiles` (the fields admins copy to issue passes):
`vehicle_number`, `drivers_permit_number`, `id_card_number`, `passport_number`,
`employee_number`.

- **Extend migration 004's self-update allowlist** so a surveyor may self-update these five
  columns (plus the already-allowed `full_name`/`phone`) on their OWN row — while `role`,
  `email`, `is_active`, `is_super_admin`, `ui_prefs` remain locked exactly as before.
  Re-create the policy/trigger that enforces the safe-field allowlist and add a comment noting
  the addition. Confirm 004's exact mechanism and mirror it precisely.
- Surface these fields (view + edit) on the Admin Users page
  (`src/app/(dashboard)/admin/users/page.tsx`) create/edit form.
- Add the columns to the `Profile` interface in `src/lib/types/database.ts`.

## Part 2 — Personal documents table, bucket & RLS (migration 035 cont.)

New table `public.personal_documents`:

```
id                 UUID PK DEFAULT uuid_generate_v4()
profile_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE  -- the owner (surveyor)
doc_name           TEXT NOT NULL          -- free text, user-entered (e.g. "Port Pass - Point Lisas")
doc_type           TEXT                   -- optional category (picklist below)
issue_date         DATE                   -- "initial date"
expiry_date        DATE                   -- nullable (some docs never expire)
storage_path       TEXT                   -- nullable: a record can exist without a file
content_type       TEXT
size_bytes         BIGINT
notes              TEXT
reminder_lead_days INT NOT NULL DEFAULT 60   -- start reminding this many days before expiry (1–2 months)
last_reminded_at   TIMESTAMPTZ            -- dedupe so we don't email every day
uploaded_by        UUID REFERENCES profiles(id)
created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

- Indexes on `(profile_id)` and `(expiry_date)`. `update_updated_at` trigger (reuse the
  existing function).
- Suggested `doc_type` picklist (free text still allowed; mirror the `DOC_CATEGORIES` constant
  style): `Port Pass`, `Driver's License`, `Passport`, `Certificate of Good Character (COC)`,
  `Medical`, `Safety Training`, `Other`.

**Storage:** new **private** bucket `personal-documents`. Path convention
`{profile_id}/{uuid}_{safeName}` (first path segment = owner id). Note for the user any
Storage-dashboard MIME/size limits to set.

**RLS on `personal_documents`:**
- Owner (`profile_id = auth.uid()`, active profile) — full manage (SELECT/INSERT/UPDATE/DELETE).
- `is_admin()` — full manage (FOR ALL).
- Office — **SELECT only**, gated by `has_office_permission('personal_docs.view')`. No office
  write policy (writes stay denied by default).
- Clients — no access.

**Storage RLS on the `personal-documents` bucket** (mirror migration 028's path-segment check
using `storage.foldername(name)[1]` = owner id):
- SELECT: path owner OR `is_admin()` OR `has_office_permission('personal_docs.view')`.
- INSERT/UPDATE/DELETE: path owner OR `is_admin()`.

**New office permission keys** — idempotent upsert into `office_permission_catalog`
(category `documents`):
- `personal_docs.view` — "View surveyor documents" (view/download credential docs for passes).
- `personal_docs.expiry.notify` — "Receive document expiry reminders" (opt office into the
  reminder emails).

Add both keys to the `OfficePermissionKey` union (`src/lib/types/database.ts`) and the
`OFFICE_PERMISSIONS` constant (`src/lib/office/permissions.ts`). Surface them as toggles in the
admin per-user Office Permissions editor.

## Part 3 — UI

**Data-access lib:** new `src/lib/personal-docs/api.ts` modeled on `src/lib/documents/api.ts`
(`list/create/update/delete`, `uploadDocument`, `signedUrl`, `formatBytes`, `safeName`). Add
`expiryStatus(expiry_date, reminder_lead_days)` → `'expired' | 'expiring' | 'ok' | 'none'`
using `date-fns`.

**Surveyor self-service** — extend `/profile` (or new `/surveyor/profile`):
- *My Documents:* list with name, type, issue date, expiry date, a status chip
  (Expired / Expires in N days / OK), download, edit, delete, and an "Add document" form
  (free-text name, type dropdown, issue date, expiry date, file upload, reminder lead-days).
  Reuse brand styles (`card`, `btn-primary`, `input-base`) and `Modal` / `ConfirmDialog`.
- *Employee details:* editable vehicle #, driver's permit #, ID card #, passport #,
  employee # — saved directly (no approval).

**Admin** — in `/admin/users` (edit modal or a per-user detail view): view/edit each
surveyor's employee fields and view/download/manage their documents. Add an admin-wide
"Expiring documents" view across all surveyors, sortable by expiry date.

**Office** — when granted `personal_docs.view`, add a nav item ("Surveyor Documents") via
`officeNav()` in `src/components/layout/Sidebar.tsx` and a read-only page `/office/documents`:
per-surveyor card showing the copy-ready pass fields (vehicle #, permit #, ID #, passport #,
employee #) plus download links for their documents, and a "Copy details" button that copies
the pass-relevant fields to the clipboard. No edit/delete/upload for office.

**In-app reminder widget:** on the surveyor dashboard (`/surveyor/page.tsx`) and admin
dashboard (`/admin/page.tsx`), a card listing documents expired or expiring within
`reminder_lead_days` (surveyor = own; admin = all surveyors). Office dashboard shows the same
list only when granted `personal_docs.view`.

Add the new nav entries to `surveyorNav` / `adminNav` in `Sidebar.tsx` (respect the existing
`orderedNav` customization mechanism).

## Part 4 — Scheduled expiry reminders (email) — Vercel Cron

Use **Vercel Cron** (keeps everything in the existing Next/Vercel/Resend stack):

- Add a `crons` entry to `vercel.json` running daily (e.g. `"0 13 * * *"`), hitting
  `GET /api/cron/document-reminders`. (Keep the existing `buildCommand` key.)
- **Secure the route** with a new `CRON_SECRET` env var: reject unless the request carries
  `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron sends this header automatically).
  Document `CRON_SECRET` in `.env.local.example` and tell the user to set it in Vercel. The
  route uses the **service-role** client to read across all surveyors.
- **Logic:** select `personal_documents` where `expiry_date IS NOT NULL`
  AND `expiry_date <= current_date + reminder_lead_days`
  AND `expiry_date >= current_date - 7` (also catch recently expired)
  AND (`last_reminded_at IS NULL` OR `last_reminded_at < now() - interval '7 days'`)
  — i.e. remind at most weekly per document. For each due doc, include it in the recipients'
  digest, then set `last_reminded_at = now()`.
- **Recipients per due doc:** the document owner (profile email) + all active admins/
  super-admins + any active office users granted `personal_docs.expiry.notify`. De-dupe
  addresses. Prefer **one digest email per recipient** listing all docs due for them, rather
  than N separate emails.
- **Generalize the email sender:** factor the Resend call out of `/api/notify/admin` into a
  shared `src/lib/email/send.ts` (`sendEmail({ to: string[], subject, html })`) reusing
  `escapeHtml` / `safeSubject`; have both the existing notify route and the new cron route use
  it. Email body per doc: doc name, type, owner name, expiry date, days remaining, and a deep
  link.

---

## Open decisions — ask me if unsure, otherwise use these defaults
1. `passport_number` / `id_card_number` sensitivity: default — office can see them (needed for
   passes). Confirm if they should be masked for office and full only for admin.
2. Cron time/timezone (server is UTC) and cadence — default: daily check, weekly per-doc
   re-send, 60-day lead.
3. Office upload-on-behalf — default: no, view/download only.

## Deliverables
- `supabase/migrations/035_personal_documents_and_profile_fields.sql` (idempotent; print clear
  "run this in the Supabase SQL Editor" instructions + note the new bucket and any Storage MIME/
  size limits).
- App code for Parts 1–4; update `src/lib/types/database.ts` and `src/lib/office/permissions.ts`.
- `CRON_SECRET` added to `.env.local.example` and noted for Vercel.
- All gates green (`tsc`, lint 0 errors, tests, `next build --webpack`). Update `HANDOFF.md`.
- Do NOT open a pull request unless asked. Do NOT run or apply the migration.
