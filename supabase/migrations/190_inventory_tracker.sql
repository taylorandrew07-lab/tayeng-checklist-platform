-- ============================================================
-- Migration 190: Inventory tracker — schema, rollup and RLS.
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- WHY: consumables (sample bottles by the box, bacteria sticks, reagents) and
-- calibrated equipment (UT gauges, anemometers, gas detectors) are tracked
-- nowhere. The only way to know whether there are bottles at Deco Martin is to
-- drive there; the only warning that a gauge is out of certification is someone
-- remembering; and there is no record of who took what.
--
-- SHAPE — the ledger is the source of truth:
--
--   inventory_movements   append-only. Every take/receive/move/recount/custody
--                         change is one row. Nothing is ever updated or deleted.
--   inventory_stock       DERIVED. A rollup maintained solely by
--                         trg_sync_inventory_stock. Cannot drift from history.
--
-- This mirrors mig 157 (job_surveyor_regular → job_surveyors.regular_hours) with
-- ONE deliberate difference: 157 re-SUMs its whole log on every change, which is
-- idempotent under INSERT/UPDATE/DELETE. This ledger grows forever, so we apply
-- DELTAS instead — which is only correct if a row can never change. Hence
-- trg_inventory_movements_immutable below. Do not "optimise" that trigger away.
--
-- TWO AXES, deliberately separate:
--   * inventory_stock answers "where does it live / how much is there". Assets
--     live here too, as a single row with qty_units = 1, so "everything at Deco
--     Martin" is ONE query and `move` is one code path for a box of bottles and
--     a UT gauge alike.
--   * inventory_items.held_by answers "who has it in hand right now". A gauge
--     checked out to a surveyor is still ASSIGNED to Main office (where it must
--     come back to) while being HELD by that surveyor. Both are true at once.
--   Modelling custody as a nullable third column of the stock primary key was
--   considered and rejected: NULL does not conflict with itself in a unique
--   index, so (item, loc, NULL) would insert twice and split the rollup.
--
-- PERMISSIONS (settled with the owner — surveyors get near-full operational
-- access because they already have that leeway with the equipment itself):
--   surveyor : take / receive / move / recount / check out / check in, on every
--              item. Reads stock, items and locations. Reads ONLY THEIR OWN
--              ledger rows, so they can undo their own typo.
--   admin    : all of the above, plus the catalogue, the locations, and the
--              whole history.
--   office   : read-only, behind two new permission keys.
--   client   : nothing. Every policy is gated on is_active_staff() (active
--              admin|surveyor) or has_office_permission(), and RLS is on.
--
-- NOTHING may write inventory_movements through PostgREST. The only doors are
-- inventory_record_movement() and inventory_reverse_movement() (migration 191):
-- a raw insert with a bad from/to shape would silently corrupt the rollup.
--
-- No backfill — brand-new tables start empty apart from the two seed locations.
-- ============================================================

-- LANGUAGE sql function bodies are validated at CREATE time, and a body reading
-- a table created later in the same file aborts and rolls back the WHOLE
-- migration (see CLAUDE.md). Everything here is plpgsql and correctly ordered,
-- but this costs nothing and removes the trap for whoever edits the file next.
SET check_function_bodies = off;

-- ============================================================
-- 1. Locations
-- ============================================================

CREATE TABLE IF NOT EXISTS public.inventory_locations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  short_name  TEXT,                       -- 'Main', 'Deco' — for pills and tight columns
  kind        TEXT NOT NULL DEFAULT 'office'
                CHECK (kind IN ('office', 'store', 'vehicle', 'vessel', 'other')),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  notes       TEXT,
  created_by  UUID REFERENCES public.profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Free-text names duplicate. Migration 187 exists ENTIRELY because vessels.name
-- had no uniqueness and accumulated one bogus row per voyage. Only admins create
-- locations, so a clean 23505 mapped to a readable sentence is fair friction.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_locations_name
  ON public.inventory_locations (lower(name));
CREATE INDEX IF NOT EXISTS idx_inventory_locations_created_by
  ON public.inventory_locations (created_by);

DROP TRIGGER IF EXISTS update_inventory_locations_updated_at ON public.inventory_locations;
CREATE TRIGGER update_inventory_locations_updated_at
  BEFORE UPDATE ON public.inventory_locations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- SEEDS ONLY. The list is fully admin-editable from day one — add, rename,
-- reorder, deactivate, delete. Nothing in the app hard-codes these two.
INSERT INTO public.inventory_locations (name, short_name, kind, sort_order) VALUES
  ('Main office',        'Main', 'office', 10),
  ('Deco Martin office', 'Deco', 'office', 20)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 2. Items — consumables AND equipment, one table
-- ============================================================
--
-- One table with a `kind` discriminator, not two. The ledger is the load-bearing
-- artefact, and a split forces it to be polymorphic: item_id XOR asset_id, two
-- nullable FKs, a CHECK to enforce exactly-one, two join paths in every history
-- query and two sets of RLS. That is a far worse mess than six kind-scoped
-- nullable columns fenced by a CHECK. Precedent: personal_documents.coc_stage
-- (mig 035) and jobs.job_stage (mig 108) are both meaningful for one value only.
--
-- Three identical gas detectors are THREE ROWS. Each has its own serial and its
-- own certificate date — which is the entire point of tracking calibration.

CREATE TABLE IF NOT EXISTS public.inventory_items (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind               TEXT NOT NULL DEFAULT 'consumable'
                       CHECK (kind IN ('consumable', 'asset')),
  name               TEXT NOT NULL,
  category           TEXT,                      -- free text for v1; no lookup table
  sku                TEXT,
  notes              TEXT,
  is_active          BOOLEAN NOT NULL DEFAULT true,

  -- ---- pack maths (consumables; an asset is pinned to 1) -------------------
  -- Stock is ALWAYS stored in base units. "3 boxes (72 bottles)" is a display
  -- concern — see lib/inventory/packs.ts. Storing packs would make a part-used
  -- box unrepresentable, which is the whole reason for the two-level model.
  unit_label         TEXT    NOT NULL DEFAULT 'unit',   -- 'bottle', 'stick'
  pack_label         TEXT    NOT NULL DEFAULT 'pack',   -- 'box', 'case'
  units_per_pack     INTEGER NOT NULL DEFAULT 1 CHECK (units_per_pack >= 1),
  -- Reorder thresholds in BASE UNITS. NULL = no low-stock alert for this item.
  min_qty_units      NUMERIC(14,3) CHECK (min_qty_units     IS NULL OR min_qty_units     >= 0),
  reorder_qty_units  NUMERIC(14,3) CHECK (reorder_qty_units IS NULL OR reorder_qty_units >= 0),

  -- ---- equipment ----------------------------------------------------------
  serial_number      TEXT,
  manufacturer       TEXT,
  model              TEXT,
  calibrated_at      DATE,
  calibration_due    DATE,
  calibration_note   TEXT,                      -- cert number / who calibrates it
  -- Only ever used to SUGGEST the next due date when a calibration is recorded.
  -- Never applied behind the user's back: the certificate is the authority on
  -- when the next one is due, not our arithmetic.
  calibration_interval_months INTEGER
                       CHECK (calibration_interval_months IS NULL OR calibration_interval_months > 0),
  service_status     TEXT NOT NULL DEFAULT 'in_service'
                       CHECK (service_status IN ('in_service', 'out_for_calibration',
                                                 'out_of_service', 'retired')),

  -- ---- custody (the orthogonal axis; see the header) ----------------------
  -- Written ONLY by trg_sync_inventory_stock, never patched directly, so "who
  -- has it" can never disagree with the ledger.
  held_by            UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  held_since         TIMESTAMPTZ,

  created_by         UUID REFERENCES public.profiles(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A consumable is never held and never calibrated; an asset is never packed.
  CONSTRAINT inventory_items_kind_shape CHECK (
    CASE kind
      WHEN 'consumable' THEN held_by IS NULL AND held_since IS NULL
                             AND calibration_due IS NULL AND calibrated_at IS NULL
      WHEN 'asset'      THEN units_per_pack = 1
                             AND min_qty_units IS NULL AND reorder_qty_units IS NULL
      ELSE false
    END
  ),
  CONSTRAINT inventory_items_custody_pair CHECK ((held_by IS NULL) = (held_since IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_items_name
  ON public.inventory_items (lower(name)) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_inventory_items_kind_active ON public.inventory_items (kind, is_active);
CREATE INDEX IF NOT EXISTS idx_inventory_items_held_by     ON public.inventory_items (held_by) WHERE held_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_items_calibration ON public.inventory_items (calibration_due) WHERE calibration_due IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_items_created_by  ON public.inventory_items (created_by);

DROP TRIGGER IF EXISTS update_inventory_items_updated_at ON public.inventory_items;
CREATE TRIGGER update_inventory_items_updated_at
  BEFORE UPDATE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 3. Stock — DERIVED. Never write this table by hand.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.inventory_stock (
  item_id     UUID NOT NULL REFERENCES public.inventory_items(id)     ON DELETE CASCADE,
  -- RESTRICT, not CASCADE: deleting a location that still holds stock must fail
  -- loudly rather than vaporise the count. The UI catches 23503 and offers
  -- "Deactivate instead", which keeps the history readable forever.
  location_id UUID NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  qty_units   NUMERIC(14,3) NOT NULL DEFAULT 0,
  -- Expiry is tracked per LOCATION, not per item: the Deco Martin sticks and the
  -- Main office sticks are usually different purchases with different dates.
  -- Set by a `receive` movement. This is a deliberate v1 simplification of true
  -- lot tracking — see the note at the foot of this file.
  expiry_date DATE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, location_id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_location ON public.inventory_stock (location_id);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_expiry   ON public.inventory_stock (expiry_date) WHERE expiry_date IS NOT NULL;

COMMENT ON TABLE public.inventory_stock IS
  'DERIVED. Maintained ONLY by trg_sync_inventory_stock over inventory_movements.
   There are deliberately no INSERT/UPDATE/DELETE policies for anyone, admins
   included — record a movement via inventory_record_movement() instead.
   Recompute from the ledger with inventory_stock_rebuild() (migration 191).';

-- NUMERIC(14,3) rather than INTEGER: base units are discrete today (bottles,
-- sticks) but the first reagent measured in litres would otherwise force a
-- column-type migration on a table with a trigger and a rollup hanging off it.
-- NOTE for app code: supabase-js hands `numeric` back as a STRING on some paths.
-- Always Number(row.qty_units ?? 0) — "72" + 24 === "7224" is a quiet bug.

-- ============================================================
-- 4. The ledger — append-only
-- ============================================================

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id                UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  kind                   TEXT NOT NULL CHECK (kind IN
                           ('receive','take','move','adjust','check_out','check_in','correction')),

  -- ALWAYS a non-negative MAGNITUDE, in base units. Direction comes from the
  -- from/to pair: the effect is -qty at from_location and +qty at to_location.
  -- That one rule makes stock a pure sum of the ledger for EVERY kind, with no
  -- signed column, no direction flag and no special case for a correction.
  qty_units              NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (qty_units >= 0),
  from_location_id       UUID REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  to_location_id         UUID REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,

  -- Custody is a separate axis and never moves quantity.
  from_holder_id         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  to_holder_id           UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

  -- What the human actually entered, so history renders as it was RECORDED even
  -- if the item's pack size is later corrected from 24 to 12. The history UI
  -- must read these, never the item's current units_per_pack.
  packs_at_time          NUMERIC(14,3),
  units_per_pack_at_time INTEGER,

  expiry_date            DATE,     -- `receive` only: the batch date for that location
  note                   TEXT,
  reverses_movement_id   UUID REFERENCES public.inventory_movements(id) ON DELETE RESTRICT,

  -- IDEMPOTENCY KEY, and the single most important column here. See migration 191.
  client_ref             TEXT,
  actor_id               UUID NOT NULL REFERENCES public.profiles(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT inventory_movements_no_self_reverse CHECK (id IS DISTINCT FROM reverses_movement_id),
  CONSTRAINT inventory_movements_reversal_kind   CHECK (reverses_movement_id IS NULL OR kind = 'correction'),
  CONSTRAINT inventory_movements_shape CHECK (
    (from_location_id IS NULL OR to_location_id IS NULL OR from_location_id <> to_location_id)
    AND CASE kind
      WHEN 'receive'    THEN from_location_id IS NULL     AND to_location_id IS NOT NULL AND qty_units > 0
      WHEN 'take'       THEN from_location_id IS NOT NULL AND to_location_id IS NULL     AND qty_units > 0
      WHEN 'move'       THEN from_location_id IS NOT NULL AND to_location_id IS NOT NULL AND qty_units > 0
      -- A recount is expressed as the surplus (to) or the shortfall (from).
      -- qty 0 with no location is a legal "counted, matched" audit row.
      WHEN 'adjust'     THEN (from_location_id IS NOT NULL) <> (to_location_id IS NOT NULL)
                             OR (qty_units = 0 AND from_location_id IS NULL AND to_location_id IS NULL)
      WHEN 'check_out'  THEN qty_units = 0 AND to_holder_id   IS NOT NULL AND from_holder_id IS NULL
                             AND from_location_id IS NULL AND to_location_id IS NULL
      WHEN 'check_in'   THEN qty_units = 0 AND from_holder_id IS NOT NULL AND to_holder_id   IS NULL
                             AND from_location_id IS NULL AND to_location_id IS NULL
      WHEN 'correction' THEN reverses_movement_id IS NOT NULL
      ELSE false
    END
  )
);

-- A movement can be reversed exactly ONCE. This is the double-tap guard on Undo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_movements_reversal
  ON public.inventory_movements (reverses_movement_id) WHERE reverses_movement_id IS NOT NULL;

-- The idempotency key. On flaky dockside wifi "the request may never land" is the
-- NORMAL case (CLAUDE.md), and unlike `SET submitted_at = now()` a take is NOT
-- idempotent — a blind retry double-decrements. The client generates one ref per
-- user TAP (not per attempt) and replays it on every retry; this index settles
-- the race in the database rather than in JS.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_movements_client_ref
  ON public.inventory_movements (client_ref) WHERE client_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_movements_item        ON public.inventory_movements (item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_created     ON public.inventory_movements (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_actor       ON public.inventory_movements (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_from_loc    ON public.inventory_movements (from_location_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_to_loc      ON public.inventory_movements (to_location_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_from_holder ON public.inventory_movements (from_holder_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_to_holder   ON public.inventory_movements (to_holder_id);

COMMENT ON TABLE public.inventory_movements IS
  'Append-only inventory ledger. NOT writable through PostgREST by anyone —
   call inventory_record_movement() / inventory_reverse_movement() (migration 191).
   Surveyors can SELECT only their OWN rows, so NEVER chain .select() to a write
   that could return someone else''s row (see migration 164 for how that fails).';

-- ============================================================
-- 5. The rollup trigger
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_inventory_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Read-free upsert. ON CONFLICT DO UPDATE takes the row lock itself, so two
  -- concurrent movements on the same (item, location) serialise HERE instead of
  -- racing a read-modify-write.
  IF NEW.from_location_id IS NOT NULL THEN
    INSERT INTO public.inventory_stock (item_id, location_id, qty_units, updated_at)
    VALUES (NEW.item_id, NEW.from_location_id, -NEW.qty_units, now())
    ON CONFLICT (item_id, location_id) DO UPDATE
      SET qty_units = inventory_stock.qty_units - NEW.qty_units,
          updated_at = now();
  END IF;

  IF NEW.to_location_id IS NOT NULL THEN
    INSERT INTO public.inventory_stock (item_id, location_id, qty_units, expiry_date, updated_at)
    VALUES (NEW.item_id, NEW.to_location_id, NEW.qty_units, NEW.expiry_date, now())
    ON CONFLICT (item_id, location_id) DO UPDATE
      SET qty_units = inventory_stock.qty_units + NEW.qty_units,
          -- A receive carrying a date restamps that location's batch; one
          -- without leaves the existing date alone.
          expiry_date = COALESCE(NEW.expiry_date, inventory_stock.expiry_date),
          updated_at = now();
  END IF;

  -- Custody rides the SAME row, so "who has it" can never disagree with history.
  IF NEW.to_holder_id IS NOT NULL THEN
    UPDATE public.inventory_items
       SET held_by = NEW.to_holder_id, held_since = NEW.created_at, updated_at = now()
     WHERE id = NEW.item_id;
  ELSIF NEW.from_holder_id IS NOT NULL THEN
    UPDATE public.inventory_items
       SET held_by = NULL, held_since = NULL, updated_at = now()
     WHERE id = NEW.item_id;
  END IF;

  RETURN NULL;
END;
$$;

-- SECURITY DEFINER is LOAD-BEARING, in two places:
--   * inventory_stock has no write policy at all, for anyone.
--   * inventory_items is admin-write only, but this fires from a surveyor's
--     session on check-out. As SECURITY INVOKER the UPDATE would match ZERO rows
--     under RLS and raise NOTHING — custody would silently stop recording.
-- Same reason sync_regular_hours() (mig 157) is DEFINER.
--
-- AFTER INSERT ONLY — deliberately NOT mig 157's "INSERT OR UPDATE OR DELETE".
-- 157 re-sums, which is idempotent under any operation; this applies deltas,
-- which is correct only because rows are immutable (enforced below).
DROP TRIGGER IF EXISTS trg_sync_inventory_stock ON public.inventory_movements;
CREATE TRIGGER trg_sync_inventory_stock
  AFTER INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.sync_inventory_stock();

-- ------------------------------------------------------------
-- Append-only, enforced against the SERVICE ROLE too.
--
-- activity_log (mig 042) is append-only by absence: no UPDATE/DELETE policy, so
-- default-deny. That is true for PostgREST with the anon key — but the service
-- role BYPASSES RLS ENTIRELY, and every route under src/app/api/* uses
-- createServiceClient(). Absent policies therefore do not make a table
-- append-only against our own API routes.
--
-- Here that matters much more than it does for activity_log: because the rollup
-- is a delta sum, one deleted ledger row desyncs the books permanently and
-- silently. A trigger is the only thing that actually holds the line.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inventory_movements_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION
    'Inventory history is append-only. Record a correcting movement with inventory_reverse_movement() instead.'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_movements_immutable ON public.inventory_movements;
CREATE TRIGGER trg_inventory_movements_immutable
  BEFORE UPDATE OR DELETE ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.inventory_movements_immutable();

-- ============================================================
-- 6. Reminder latch — calibration AND consumable expiry
-- ============================================================
--
-- One table for both signals: the latch logic and the digest format are
-- identical, and two near-identical tables is drift waiting to happen.
--
-- due_date is IN THE PRIMARY KEY, and that is the whole design. Changing an
-- item's calibration_due orphans the old rows (harmless history — we did warn
-- about the old date) and the new date has zero rows, so 60/30/7/0 all re-arm
-- automatically. No reset logic, no UPDATE, no cleanup job.

CREATE TABLE IF NOT EXISTS public.inventory_reminders (
  item_id    UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  reason     TEXT NOT NULL CHECK (reason IN ('calibration', 'expiry')),
  due_date   DATE NOT NULL,
  -- Mirrored by REMINDER_BUCKETS in lib/inventory/calibration.ts — change one,
  -- change both. 0 = "due or overdue"; a gauge going overdue with no message is
  -- the exact failure this feature exists to prevent.
  days_out   INTEGER NOT NULL CHECK (days_out IN (60, 30, 7, 0)),
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  PRIMARY KEY (item_id, reason, due_date, days_out)
);
CREATE INDEX IF NOT EXISTS idx_inventory_reminders_message ON public.inventory_reminders (message_id);

-- ============================================================
-- 7. Office permission keys
-- ============================================================

INSERT INTO public.office_permission_catalog (key, label, description, category) VALUES
  ('inventory.view',
   'View inventory',
   'See stock levels by location, equipment, calibration due dates and who is holding what.',
   'inventory'),
  ('inventory.history.view',
   'View inventory history',
   'Read the full movement ledger — every take, receive, move and check-out, with who and when.',
   'inventory')
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, description = EXCLUDED.description, category = EXCLUDED.category;

-- ============================================================
-- 8. RLS
-- ============================================================

ALTER TABLE public.inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_stock     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_reminders ENABLE ROW LEVEL SECURITY;

-- ---- locations ----------------------------------------------------------
DROP POLICY IF EXISTS "Read inventory locations" ON public.inventory_locations;
CREATE POLICY "Read inventory locations" ON public.inventory_locations
  FOR SELECT USING (
    public.is_active_staff() OR public.has_office_permission('inventory.view')
  );

DROP POLICY IF EXISTS "Admins manage inventory locations" ON public.inventory_locations;
CREATE POLICY "Admins manage inventory locations" ON public.inventory_locations
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---- items --------------------------------------------------------------
DROP POLICY IF EXISTS "Read inventory items" ON public.inventory_items;
CREATE POLICY "Read inventory items" ON public.inventory_items
  FOR SELECT USING (
    public.is_active_staff() OR public.has_office_permission('inventory.view')
  );

-- No surveyor write policy. Shaping the catalogue is an admin job; custody
-- (held_by) changes only through trg_sync_inventory_stock, which is DEFINER and
-- therefore bypasses this.
DROP POLICY IF EXISTS "Admins manage inventory items" ON public.inventory_items;
CREATE POLICY "Admins manage inventory items" ON public.inventory_items
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---- stock (read-only for everyone) -------------------------------------
DROP POLICY IF EXISTS "Read inventory stock" ON public.inventory_stock;
CREATE POLICY "Read inventory stock" ON public.inventory_stock
  FOR SELECT USING (
    public.is_active_staff() OR public.has_office_permission('inventory.view')
  );
-- No INSERT / UPDATE / DELETE policy for ANYONE, admins included. Derived data,
-- written only by the trigger — same default-deny discipline as activity_log's
-- missing UPDATE/DELETE (mig 042).

-- ---- movements ----------------------------------------------------------
--
-- A surveyor sees their OWN rows and nobody else's. That is what makes "My
-- activity" and self-service Undo work without opening the history: the ledger
-- proper stays an admin surface.
--
-- NOTE the deliberate absence of job_is_open(). Every other surveyor-write
-- policy in this app ANDs it in, so the reflex is strong — do not. Invoicing a
-- job freezes BILLING-relevant writes; a surveyor recording that they took a
-- bottle is recording REALITY, and blocking it just means the books stay wrong.
-- Corollary and scope commitment: inventory must not become a billing input
-- without revisiting this.
DROP POLICY IF EXISTS "Read inventory movements" ON public.inventory_movements;
CREATE POLICY "Read inventory movements" ON public.inventory_movements
  FOR SELECT USING (
    public.is_admin()
    OR public.has_office_permission('inventory.history.view')
    OR actor_id = (select auth.uid())
  );

-- NO INSERT / UPDATE / DELETE POLICY FOR ANYONE. The only doors are
-- inventory_record_movement() and inventory_reverse_movement() (migration 191),
-- which are SECURITY DEFINER and bypass RLS. A raw insert is denied even for an
-- admin, deliberately: a bad from/to shape silently corrupts the rollup.

-- ---- reminders ----------------------------------------------------------
DROP POLICY IF EXISTS "Admins read inventory reminders" ON public.inventory_reminders;
CREATE POLICY "Admins read inventory reminders" ON public.inventory_reminders
  FOR SELECT USING (public.is_admin());
-- No write policies: the cron writes with the service role.

-- ============================================================
-- Out of scope for v1, recorded so the next person doesn't guess
-- ============================================================
--
-- LOT / BATCH TRACKING. expiry_date sits on the stock row, which says the same
-- physical box has a different expiry at Main office than at Deco Martin. That
-- is a half-lot model, chosen because the real operating pattern is one purchase
-- per location at a time. Upgrading is ONE migration: add inventory_lots; give
-- every item a lot (NEVER a nullable lot_id in the PK — NULL does not conflict
-- with itself and the rollup would split); add lot_id to stock and movements;
-- widen the trigger's conflict target by one column; add FEFO to the RPC. The
-- ledger itself needs no rewrite — you can REPLAY it into the new shape with a
-- widened inventory_stock_rebuild(). That replayability is the entire payoff of
-- ledger-as-source-of-truth, and it is why deferring this is safe.
--
-- COST / SUPPLIER. RLS CANNOT HIDE COLUMNS. inventory_items is readable by every
-- surveyor, so the moment anyone adds unit_cost or supplier here, every surveyor
-- can read our purchasing. Put them in an admin-only sibling table
-- (inventory_item_costs), exactly as client_billing (mig 077) and staff_private
-- (mig 130) do. This will arrive as "just one column"; it is not.
--
-- JOB LINKAGE. Deliberately absent. Adding movements.job_id later is one
-- nullable FK plus an index — but see the job_is_open() note above first.

-- ------------------------------------------------------------
-- Verify (paste into the SQL editor after running)
--
--   -- the two seeds
--   SELECT name, short_name, kind, sort_order FROM public.inventory_locations ORDER BY sort_order;
--
--   -- stock must have exactly ONE policy, and it must be SELECT
--   SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'public.inventory_stock'::regclass;
--
--   -- movements must have exactly ONE policy, and it must be SELECT
--   SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'public.inventory_movements'::regclass;
--
--   -- both new permission keys present
--   SELECT key, label, category FROM public.office_permission_catalog WHERE category = 'inventory';
--
--   -- the immutability trigger really bites (expect ERROR 42501, not 0 rows)
--   -- UPDATE public.inventory_movements SET note = 'x' WHERE false;
--
--   -- DRIFT CHECK — expect 0 rows. Any row means the rollup left the ledger.
--   -- SELECT COALESCE(s.item_id, t.item_id) AS item_id,
--   --        COALESCE(s.location_id, t.location_id) AS location_id,
--   --        s.qty_units AS rollup, t.qty AS from_ledger
--   --   FROM public.inventory_stock s
--   --   FULL JOIN (
--   --     SELECT item_id, location_id, sum(delta) AS qty FROM (
--   --       SELECT item_id, to_location_id   AS location_id,  qty_units AS delta
--   --         FROM public.inventory_movements WHERE to_location_id   IS NOT NULL
--   --       UNION ALL
--   --       SELECT item_id, from_location_id AS location_id, -qty_units AS delta
--   --         FROM public.inventory_movements WHERE from_location_id IS NOT NULL
--   --     ) x GROUP BY item_id, location_id
--   --   ) t ON t.item_id = s.item_id AND t.location_id = s.location_id
--   --  WHERE COALESCE(s.qty_units, 0) <> COALESCE(t.qty, 0);
-- ------------------------------------------------------------
