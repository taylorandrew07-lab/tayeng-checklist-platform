# End-to-end smoke test

A guard for the one workflow that must never silently break: an **admin creates a
job, assigns it to a surveyor, and the surveyor completes and submits it**.

## Run it

```bash
npm run smoke
```

It reads Supabase credentials from `.env.local` automatically (or from real
environment variables in CI). It needs:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## What it does

Against the live database, it:

1. Provisions a throwaway **active surveyor** account.
2. Creates a job (as an admin) **assigned to that surveyor**.
3. Signs in **as the surveyor** and performs every real action: open & start the
   job, answer fields, capture a signature, attach a photo, **submit**, and advance
   the workflow to `report_ready`.
4. Verifies each step actually persisted (catches silent 0-row RLS denials — the
   bug class behind "it submits but nothing happens").
5. Deletes all the test data it created.

**Exit code 0** = the surveyor flow works end-to-end. **Non-zero** = a step was
blocked; the core flow is broken — investigate before shipping.

## When to run it

After any change that touches RLS policies, the checklist editor, the submit path,
or migrations — and ideally after each production deploy. It's safe to run anytime;
it cleans up after itself and only touches its own `*@tayeng-test.local` records.
