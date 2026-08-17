-- ============================================================
-- Migration 193: let an admin genuinely DELETE an inventory item, and clear the
-- test rows migration 190's own safety net stranded in production.
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- THE GAP. Migration 190 made the ledger append-only with a BEFORE UPDATE OR
-- DELETE trigger, deliberately strong enough to hold against the service role
-- (absent RLS policies do not, since every /api/* route uses createServiceClient).
-- That is right for operational history. But it also made a MISTAKE permanent:
--
--   * inventory_items is FK-restricted by inventory_movements, so an item with
--     any history cannot be deleted;
--   * its history cannot be deleted either, by anyone, ever;
--   * so "Archive" was the only exit, and a junk item created by a typo sat in
--     the catalogue forever.
--
-- It also meant nothing could clean up after itself. e2e/smoke-inventory.mjs
-- deletes its fixtures in a LIFO stack; the very first step (delete the test
-- movements) raised, the rest never ran, and four SMOKE items plus six SMOKE
-- locations were left visible on the live Inventory page. Those are removed at
-- the foot of this file.
--
-- THE FIX. A purge flag the trigger honours, and one admin-only RPC that sets
-- it. This keeps every property that made the trigger worth having:
--
--   * UPDATE stays impossible ALWAYS, flag or no flag. History is never rewritten
--     in place — that is what makes a delta-applied rollup safe.
--   * DELETE still refuses by default, so no route, script or console session can
--     drop a ledger row by accident. Purging is a deliberate act, in one named
--     function, gated on is_admin().
--   * Surveyors are unaffected: they have no DELETE policy on inventory_movements
--     at all, so RLS stops them long before the trigger is consulted. Setting the
--     GUC by hand buys them nothing.
--
-- This is a real trade, stated plainly: purging an item DESTROYS its history.
-- The UI says so in those words. It exists for catalogue mistakes, not for
-- tidying up movements someone would rather not have on the record — and the
-- correction path (inventory_reverse_movement) remains the only way to fix a
-- wrong entry, because it keeps both the error and the fix.
-- ============================================================

SET check_function_bodies = off;

-- ------------------------------------------------------------
-- 1. The trigger learns one exception
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.inventory_movements_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- The ONLY hole, and only for DELETE: a transaction that has deliberately set
  -- inventory.purge. set_config(..., true) makes it transaction-local, so it
  -- cannot leak into the next statement on a pooled connection.
  IF TG_OP = 'DELETE' AND COALESCE(current_setting('inventory.purge', true), '') = 'on' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION
      'Inventory history cannot be edited. Record a correcting movement with inventory_reverse_movement() instead.'
      USING ERRCODE = '42501';
  END IF;

  RAISE EXCEPTION
    'Inventory history cannot be deleted. Correct it with inventory_reverse_movement(), or remove the whole item with inventory_purge_item().'
    USING ERRCODE = '42501';
END;
$$;

-- The trigger itself is unchanged; re-stated so this file is paste-runnable on
-- its own and so a re-run cannot leave it detached.
DROP TRIGGER IF EXISTS trg_inventory_movements_immutable ON public.inventory_movements;
CREATE TRIGGER trg_inventory_movements_immutable
  BEFORE UPDATE OR DELETE ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.inventory_movements_immutable();

-- ------------------------------------------------------------
-- 2. Purge one item, history and all
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.inventory_purge_item(p_item_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name  TEXT;
  v_moves INTEGER;
BEGIN
  -- auth.uid() is NULL for a service-role client (no JWT). EXECUTE is granted to
  -- authenticated and service_role only — never anon — so a NULL uid here means
  -- a trusted server-side caller, and an end user must be an admin.
  IF NOT (public.is_admin() OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'Only an administrator can delete an inventory item.'
      USING ERRCODE = '42501';
  END IF;

  SELECT i.name INTO v_name FROM public.inventory_items i WHERE i.id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That item no longer exists.' USING ERRCODE = '23503';
  END IF;

  -- An asset in someone's hands is not a catalogue mistake — it is a real thing
  -- that is somewhere. Make them check it in first, so custody never vanishes
  -- from under the person holding it.
  IF EXISTS (SELECT 1 FROM public.inventory_items i
              WHERE i.id = p_item_id AND i.held_by IS NOT NULL) THEN
    RAISE EXCEPTION '% is checked out. Check it back in before deleting it.', v_name
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('inventory.purge', 'on', true);

  -- Corrections first. reverses_movement_id is ON DELETE RESTRICT, and RESTRICT
  -- is checked per row as the statement runs — it does NOT see that the row
  -- pointing at this one is being deleted by the very same statement. A single
  -- flat DELETE would therefore fail on any item that has ever been corrected.
  -- Two passes is enough: a correction can never itself be corrected (guarded in
  -- inventory_reverse_movement), so the reference graph is only one deep.
  DELETE FROM public.inventory_movements
   WHERE item_id = p_item_id AND reverses_movement_id IS NOT NULL;

  DELETE FROM public.inventory_movements WHERE item_id = p_item_id;
  GET DIAGNOSTICS v_moves = ROW_COUNT;

  DELETE FROM public.inventory_stock     WHERE item_id = p_item_id;
  DELETE FROM public.inventory_reminders WHERE item_id = p_item_id;
  DELETE FROM public.inventory_items     WHERE id      = p_item_id;

  PERFORM set_config('inventory.purge', 'off', true);
  RETURN v_moves;
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_purge_item(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_purge_item(UUID) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3. Clear the stranded test rows
--
-- These are fixtures from e2e/smoke-inventory.mjs whose cleanup was blocked by
-- the very trigger this migration just taught to yield. They were visible on the
-- live Inventory page as "SMOKE Gauge <digits>" and "SMOKE Loc A/B <digits>".
--
-- Scoped to the exact fixture shape: the literal prefix 'SMOKE ' followed by a
-- name and a millisecond timestamp. A real item would have to be named that on
-- purpose. The DO block is re-runnable and a no-op once they are gone.
-- ------------------------------------------------------------

DO $$
DECLARE
  v_id    UUID;
  v_items INTEGER := 0;
  v_locs  INTEGER := 0;
BEGIN
  PERFORM set_config('inventory.purge', 'on', true);

  FOR v_id IN
    SELECT i.id FROM public.inventory_items i
     WHERE i.name ~ '^SMOKE (Bottles|Gauge|Rogue) [0-9]{10,}$'
  LOOP
    DELETE FROM public.inventory_movements WHERE item_id = v_id AND reverses_movement_id IS NOT NULL;
    DELETE FROM public.inventory_movements WHERE item_id = v_id;
    DELETE FROM public.inventory_stock     WHERE item_id = v_id;
    DELETE FROM public.inventory_reminders WHERE item_id = v_id;
    DELETE FROM public.inventory_items     WHERE id      = v_id;
    v_items := v_items + 1;
  END LOOP;

  -- Only now can the locations go: until the movements above were removed, the
  -- ON DELETE RESTRICT FKs held them in place.
  DELETE FROM public.inventory_locations
   WHERE name ~ '^SMOKE (Loc [AB]|Rogue Loc) [0-9]{10,}$';
  GET DIAGNOSTICS v_locs = ROW_COUNT;

  PERFORM set_config('inventory.purge', 'off', true);
  RAISE NOTICE 'Purged % smoke item(s) and % smoke location(s).', v_items, v_locs;
END $$;

-- ------------------------------------------------------------
-- Verify (paste into the SQL editor after running)
--
--   -- expect 0 rows
--   SELECT name FROM public.inventory_items     WHERE name LIKE 'SMOKE %';
--   SELECT name FROM public.inventory_locations WHERE name LIKE 'SMOKE %';
--
--   -- expect exactly the two real seeds
--   SELECT name, short_name, kind FROM public.inventory_locations ORDER BY sort_order;
--
--   -- history must STILL be un-editable outside a purge (expect ERROR 42501)
--   -- UPDATE public.inventory_movements SET note = 'x' WHERE id = (SELECT id FROM public.inventory_movements LIMIT 1);
--   -- DELETE FROM public.inventory_movements WHERE id = (SELECT id FROM public.inventory_movements LIMIT 1);
-- ------------------------------------------------------------
