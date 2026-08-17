# End-to-end smoke tests

Guards for the workflows that must never silently break. vitest in this repo is
pure-function only — **no RLS policy is covered by `npm test`**, so these scripts
are the only thing that proves the database actually behaves.

| Script | Guards |
|---|---|
| `npm run smoke` | An **admin creates a job, assigns it to a surveyor, and the surveyor completes and submits it** |
| `npm run smoke-inventory` | **Inventory permissions and the movement RPC** (migrations 190/191) |

## Run it

```bash
npm run smoke
npm run smoke-inventory
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

## What `smoke-inventory` does

Same shape, aimed at migrations 190/191. It provisions a throwaway surveyor, two
locations and two items (a boxed consumable and a piece of equipment), then signs
in **as the surveyor** and asserts both halves of the permission model:

**Can** — read items, locations and stock; take, move and recount through
`inventory_record_movement`; check equipment out and back in; read their own
ledger rows; undo their own entry.

**Cannot** — insert into `inventory_movements` directly, update the derived
`inventory_stock` table, create or rename an item, create a location, delete a
ledger row, see anyone else's movements, or read the reminder latch.

It also pins the three things most likely to break in silence:

- **Idempotency** — replaying the same `client_ref` must not double-decrement.
  This is what makes retrying safe on flaky dockside wifi, where a take is *not*
  naturally idempotent the way `submitted_at` is.
- **The negative guard** — taking more than recorded is refused with `23514`,
  and confirming through with `p_allow_negative` records reality and flags it.
- **The rollup** — `inventory_stock` must equal the sum of the ledger at the end.
  Any drift here means something bypassed the trigger.

## When to run it

After any change that touches RLS policies, the checklist editor, the submit path,
or migrations — and ideally after each production deploy. It's safe to run anytime;
it cleans up after itself and only touches its own `*@tayeng-test.local` records.

## Automated checks (GitHub Actions)

Two workflows guard the app automatically (`.github/workflows/`):

- **CI** (`ci.yml`) — runs typecheck + lint + unit tests + build on every push and PR
  to `main`. No secrets, never touches the database. This catches regressions before
  they reach production.
- **Smoke** (`smoke.yml`) — runs this surveyor-flow smoke test against the live
  database, daily and on demand (Actions tab → "Smoke (surveyor flow)" → **Run
  workflow** — handy right after a deploy).

### One-time setup for the Smoke workflow

The smoke workflow needs three repository secrets. In GitHub: **Settings → Secrets and
variables → Actions → New repository secret**, add each of:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

(Same values as your local `.env.local`.) Until they're set, the smoke run fails by
design with "Missing env". The CI workflow needs no setup and works immediately.
