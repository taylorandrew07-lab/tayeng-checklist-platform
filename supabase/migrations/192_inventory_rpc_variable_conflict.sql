-- ============================================================
-- Migration 192: fix "column reference item_id is ambiguous" in the inventory
-- movement RPCs. Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- SYMPTOM (caught by e2e/smoke-inventory.mjs before this ever reached a user):
--   every take, move and recount failed with
--     column reference "item_id" is ambiguous          [42702]
--   while check_out and check_in worked perfectly.
--
-- CAUSE: `RETURNS TABLE (movement_id UUID, item_id UUID, kind TEXT, qty_units
-- NUMERIC, from_location_id UUID, ...)` declares those names as plpgsql OUT
-- VARIABLES, in scope for the whole function body. Postgres defaults to
-- `#variable_conflict error`, so any BARE column reference matching one of them
-- is a hard error rather than a silent mis-resolution.
--
-- Migration 191 qualified almost every reference with a table alias — but not
-- the row-lock inside the loop:
--
--     PERFORM 1 FROM public.inventory_stock
--       WHERE item_id = p_item_id AND location_id = v_lock FOR UPDATE;
--
-- `item_id` there is both a column of inventory_stock and an OUT variable.
--
-- That loop only runs when a movement touches a stock location, which is exactly
-- why the custody paths passed: check_out/check_in set no locations, skip the
-- loop entirely, and never hit the ambiguous statement. A partial pass is the
-- most misleading kind, and is why the smoke script exercises both.
--
-- FIX, belt and braces:
--   1. `#variable_conflict use_column` at the top of each body. We never read
--      the OUT variables by name — every return goes through
--      RETURN QUERY SELECT * FROM inventory_movement_state(...) — and every
--      local is v_-prefixed while every parameter is p_-prefixed, so there is no
--      name a column could shadow that we actually rely on. This makes the whole
--      class of bug impossible rather than fixing one instance of it.
--   2. Alias the offending statements anyway, so the code reads unambiguously
--      to a human and does not depend on the pragma to be correct.
--
-- No signature changes, so plain CREATE OR REPLACE — no DROP FUNCTION needed and
-- no ambiguous overload is created. Behaviour is otherwise byte-for-byte the
-- logic of migration 191; read that file for why any of it is the way it is.
-- ============================================================

SET check_function_bodies = off;

-- ============================================================
-- 1. Record a movement
-- ============================================================

CREATE OR REPLACE FUNCTION public.inventory_record_movement(
  p_item_id          UUID,
  p_kind             TEXT,
  p_qty_units        NUMERIC DEFAULT NULL,
  p_from_location_id UUID    DEFAULT NULL,
  p_to_location_id   UUID    DEFAULT NULL,
  p_holder_id        UUID    DEFAULT NULL,
  p_counted_units    NUMERIC DEFAULT NULL,
  p_packs            NUMERIC DEFAULT NULL,
  p_expiry_date      DATE    DEFAULT NULL,
  p_note             TEXT    DEFAULT NULL,
  p_allow_negative   BOOLEAN DEFAULT false,
  p_client_ref       TEXT    DEFAULT NULL
)
RETURNS TABLE (
  movement_id      UUID,
  item_id          UUID,
  kind             TEXT,
  qty_units        NUMERIC,
  from_location_id UUID,
  from_qty_units   NUMERIC,
  to_location_id   UUID,
  to_qty_units     NUMERIC,
  total_qty_units  NUMERIC,
  held_by          UUID,
  warning          TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_uid         UUID    := auth.uid();
  v_item        public.inventory_items%ROWTYPE;
  v_qty         NUMERIC := COALESCE(p_qty_units, 0);
  v_from        UUID    := p_from_location_id;
  v_to          UUID    := p_to_location_id;
  v_recount_loc UUID;
  v_have        NUMERIC;
  v_total       NUMERIC;
  v_warn        TEXT;
  v_id          UUID    := gen_random_uuid();
  v_dup         UUID;
  v_lock        UUID;
BEGIN
  -- 1. CALLER. is_active_staff() = active admin|surveyor.
  --    NOTE: auth.uid() is NULL for a service-role client with no JWT, so this
  --    correctly refuses one. Seed inventory with a direct ledger INSERT (the
  --    rollup trigger still fires) or by acting as a real user.
  IF v_uid IS NULL OR NOT public.is_active_staff() THEN
    RAISE EXCEPTION 'You do not have permission to record stock movements.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. IDEMPOTENCY, before anything else.
  IF p_client_ref IS NOT NULL THEN
    SELECT m.id INTO v_dup FROM public.inventory_movements m WHERE m.client_ref = p_client_ref;
    IF FOUND THEN
      RETURN QUERY SELECT * FROM public.inventory_movement_state(v_dup, 'duplicate');
      RETURN;
    END IF;
  END IF;

  IF p_kind IS NULL OR p_kind NOT IN ('receive','take','move','adjust','check_out','check_in') THEN
    RAISE EXCEPTION 'Unknown movement type "%".', p_kind USING ERRCODE = '22023';
  END IF;

  -- 3. ITEM. Locked only for custody work.
  IF p_kind IN ('check_out','check_in') THEN
    SELECT i.* INTO v_item FROM public.inventory_items i WHERE i.id = p_item_id FOR UPDATE;
  ELSE
    SELECT i.* INTO v_item FROM public.inventory_items i WHERE i.id = p_item_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That item no longer exists.' USING ERRCODE = '23503';
  END IF;
  IF NOT v_item.is_active AND p_kind <> 'adjust' THEN
    RAISE EXCEPTION '% is archived — an admin has to reactivate it first.', v_item.name
      USING ERRCODE = '42501';
  END IF;

  -- 4. KIND / ITEM-KIND agreement.
  IF p_kind IN ('check_out','check_in') THEN
    IF v_item.kind <> 'asset' THEN
      RAISE EXCEPTION '% is a consumable — take it, don''t check it out.', v_item.name
        USING ERRCODE = '22023';
    END IF;
    v_qty := 0; v_from := NULL; v_to := NULL;
  ELSIF p_kind = 'take' AND v_item.kind = 'asset' THEN
    RAISE EXCEPTION '% is equipment — check it out instead of taking it.', v_item.name
      USING ERRCODE = '22023';
  END IF;

  IF p_kind = 'adjust' THEN
    v_recount_loc := COALESCE(p_to_location_id, p_from_location_id);
    IF v_recount_loc  IS NULL THEN RAISE EXCEPTION 'A recount needs a location.'   USING ERRCODE = '22023'; END IF;
    IF p_counted_units IS NULL THEN RAISE EXCEPTION 'A recount needs a count.'     USING ERRCODE = '22023'; END IF;
    IF p_counted_units <  0    THEN RAISE EXCEPTION 'A count cannot be negative.'  USING ERRCODE = '22023'; END IF;
    v_from := NULL; v_to := NULL;
  END IF;

  IF p_kind IN ('receive','take','move') AND v_qty <= 0 THEN
    RAISE EXCEPTION 'Enter how many.' USING ERRCODE = '22023';
  END IF;

  -- 5. LOCKS, in a DETERMINISTIC order. THE FIX IS HERE: the PERFORM now aliases
  --    inventory_stock as s, so `item_id` can never be read as the OUT variable.
  --
  --    The INSERT … DO NOTHING is still required: FOR UPDATE on a row that does
  --    not exist locks nothing, so two concurrent takes at a fresh location would
  --    both sail past the guard in step 7. ORDER BY prevents a deadlock between
  --    two opposing moves across the same pair of locations.
  FOR v_lock IN
    SELECT DISTINCT l FROM unnest(ARRAY[v_from, v_to, v_recount_loc]) AS l
     WHERE l IS NOT NULL ORDER BY 1
  LOOP
    INSERT INTO public.inventory_stock AS st (item_id, location_id, qty_units)
    VALUES (p_item_id, v_lock, 0)
    ON CONFLICT (item_id, location_id) DO NOTHING;

    PERFORM 1 FROM public.inventory_stock s
      WHERE s.item_id = p_item_id AND s.location_id = v_lock FOR UPDATE;
  END LOOP;

  -- 6. RECOUNT delta, computed INSIDE the lock.
  IF p_kind = 'adjust' THEN
    SELECT s.qty_units INTO v_have FROM public.inventory_stock s
      WHERE s.item_id = p_item_id AND s.location_id = v_recount_loc;
    v_have := COALESCE(v_have, 0);
    v_qty  := abs(p_counted_units - v_have);
    IF v_qty > 0 THEN
      IF p_counted_units > v_have THEN v_to := v_recount_loc; ELSE v_from := v_recount_loc; END IF;
    END IF;
  END IF;

  -- 7. THE NEGATIVE GUARD — under the lock taken in step 5.
  IF v_from IS NOT NULL AND v_qty > 0 THEN
    SELECT s.qty_units INTO v_have FROM public.inventory_stock s
      WHERE s.item_id = p_item_id AND s.location_id = v_from;
    v_have := COALESCE(v_have, 0);
    IF v_have - v_qty < 0 THEN
      IF NOT p_allow_negative THEN
        RAISE EXCEPTION
          'Only % recorded there, but this removes %. Confirm to record it anyway and flag a recount.',
          v_have, v_qty USING ERRCODE = '23514';
      END IF;
      v_warn := 'negative';
    END IF;
  END IF;

  -- 8. An asset is one physical thing: it may not be in two places at once.
  IF v_item.kind = 'asset' AND p_kind = 'receive' THEN
    SELECT COALESCE(sum(s.qty_units), 0) INTO v_total
      FROM public.inventory_stock s WHERE s.item_id = p_item_id;
    IF v_total + v_qty > 1 THEN
      RAISE EXCEPTION '% is already recorded in stock — move it instead of receiving it again.',
        v_item.name USING ERRCODE = '23505';
    END IF;
  END IF;

  -- 9. CUSTODY validation.
  IF p_kind = 'check_out' THEN
    IF p_holder_id IS NULL THEN
      RAISE EXCEPTION 'Who is taking it?' USING ERRCODE = '22023';
    END IF;
    IF v_item.held_by IS NOT NULL THEN
      RAISE EXCEPTION '% is already checked out — check it in first.', v_item.name
        USING ERRCODE = '23505';
    END IF;
    PERFORM 1 FROM public.profiles p
      WHERE p.id = p_holder_id AND p.is_active = true
        AND p.role::text IN ('admin','surveyor','office');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That person is not active staff.' USING ERRCODE = '23503';
    END IF;
  ELSIF p_kind = 'check_in' THEN
    IF v_item.held_by IS NULL THEN
      RAISE EXCEPTION '% is not checked out.', v_item.name USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 10. THE ROW. actor_id = auth.uid(), not a parameter, so it is unforgeable.
  --     Deliberately NO RETURNING — see migration 164.
  INSERT INTO public.inventory_movements (
    id, item_id, kind, qty_units,
    from_location_id, to_location_id, from_holder_id, to_holder_id,
    packs_at_time, units_per_pack_at_time, expiry_date,
    note, client_ref, actor_id
  ) VALUES (
    v_id, p_item_id, p_kind, v_qty,
    v_from, v_to,
    CASE WHEN p_kind = 'check_in'  THEN v_item.held_by END,
    CASE WHEN p_kind = 'check_out' THEN p_holder_id    END,
    p_packs, v_item.units_per_pack,
    CASE WHEN p_kind = 'receive' THEN p_expiry_date END,
    NULLIF(btrim(COALESCE(p_note, '')), ''), p_client_ref, v_uid
  );

  -- 11. Return what the caller CAN read.
  RETURN QUERY SELECT * FROM public.inventory_movement_state(v_id, v_warn);

EXCEPTION WHEN unique_violation THEN
  IF p_client_ref IS NOT NULL THEN
    SELECT m.id INTO v_dup FROM public.inventory_movements m WHERE m.client_ref = p_client_ref;
    IF v_dup IS NOT NULL THEN
      RETURN QUERY SELECT * FROM public.inventory_movement_state(v_dup, 'duplicate');
      RETURN;
    END IF;
  END IF;
  RAISE;
END;
$$;

-- ============================================================
-- 2. Correct a movement
-- ============================================================

CREATE OR REPLACE FUNCTION public.inventory_reverse_movement(
  p_movement_id UUID,
  p_note        TEXT DEFAULT NULL,
  p_client_ref  TEXT DEFAULT NULL
)
RETURNS TABLE (
  movement_id      UUID,
  item_id          UUID,
  kind             TEXT,
  qty_units        NUMERIC,
  from_location_id UUID,
  from_qty_units   NUMERIC,
  to_location_id   UUID,
  to_qty_units     NUMERIC,
  total_qty_units  NUMERIC,
  held_by          UUID,
  warning          TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_uid  UUID := auth.uid();
  v_m    public.inventory_movements%ROWTYPE;
  v_id   UUID := gen_random_uuid();
  v_dup  UUID;
  v_lock UUID;
  v_neg  BOOLEAN;
BEGIN
  IF v_uid IS NULL OR NOT public.is_active_staff() THEN
    RAISE EXCEPTION 'You do not have permission to correct stock movements.'
      USING ERRCODE = '42501';
  END IF;

  IF p_client_ref IS NOT NULL THEN
    SELECT m.id INTO v_dup FROM public.inventory_movements m WHERE m.client_ref = p_client_ref;
    IF FOUND THEN
      RETURN QUERY SELECT * FROM public.inventory_movement_state(v_dup, 'duplicate');
      RETURN;
    END IF;
  END IF;

  SELECT m.* INTO v_m FROM public.inventory_movements m WHERE m.id = p_movement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That entry no longer exists.' USING ERRCODE = '23503';
  END IF;

  IF v_m.kind = 'correction' THEN
    RAISE EXCEPTION 'That entry is itself a correction — correct the original instead.'
      USING ERRCODE = '22023';
  END IF;

  -- A surveyor undoes their OWN typo, within a day. Anything older, or anyone
  -- else's, is an admin job — this is also what stops the ledger becoming a
  -- surveyor-readable oracle via probing ids.
  IF NOT public.is_admin() THEN
    IF v_m.actor_id <> v_uid THEN
      RAISE EXCEPTION 'Only an administrator can correct someone else''s entry.'
        USING ERRCODE = '42501';
    END IF;
    IF v_m.created_at < now() - INTERVAL '24 hours' THEN
      RAISE EXCEPTION 'That entry is more than a day old — ask an admin to correct it.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR v_lock IN
    SELECT DISTINCT l FROM unnest(ARRAY[v_m.from_location_id, v_m.to_location_id]) AS l
     WHERE l IS NOT NULL ORDER BY 1
  LOOP
    INSERT INTO public.inventory_stock AS st (item_id, location_id, qty_units)
    VALUES (v_m.item_id, v_lock, 0)
    ON CONFLICT (item_id, location_id) DO NOTHING;

    PERFORM 1 FROM public.inventory_stock s
      WHERE s.item_id = v_m.item_id AND s.location_id = v_lock FOR UPDATE;
  END LOOP;

  -- Mirrored: from/to and the holder pair are swapped, so the custody reversal
  -- falls out for free. A correction is NEVER blocked on going negative —
  -- undoing a wrong receive must work even if the phantom stock was "consumed".
  INSERT INTO public.inventory_movements (
    id, item_id, kind, qty_units,
    from_location_id, to_location_id, from_holder_id, to_holder_id,
    packs_at_time, units_per_pack_at_time,
    note, reverses_movement_id, client_ref, actor_id
  ) VALUES (
    v_id, v_m.item_id, 'correction', v_m.qty_units,
    v_m.to_location_id, v_m.from_location_id,
    v_m.to_holder_id,   v_m.from_holder_id,
    v_m.packs_at_time, v_m.units_per_pack_at_time,
    COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), 'Correction'),
    p_movement_id, p_client_ref, v_uid
  );

  SELECT EXISTS (
    SELECT 1 FROM public.inventory_stock s
     WHERE s.item_id = v_m.item_id AND s.qty_units < 0
  ) INTO v_neg;

  RETURN QUERY SELECT * FROM public.inventory_movement_state(
    v_id, CASE WHEN v_neg THEN 'negative' END);

EXCEPTION WHEN unique_violation THEN
  SELECT m.id INTO v_dup FROM public.inventory_movements m
    WHERE m.reverses_movement_id = p_movement_id;
  IF v_dup IS NOT NULL THEN
    RETURN QUERY SELECT * FROM public.inventory_movement_state(v_dup, 'duplicate');
    RETURN;
  END IF;
  RAISE;
END;
$$;

-- Signatures are unchanged, so the migration-191 grants still apply. Re-stated
-- because CREATE OR REPLACE keeps existing grants but a future DROP+CREATE would
-- not, and a silently PUBLIC-executable RPC is not a thing to leave to chance.
REVOKE ALL ON FUNCTION public.inventory_record_movement(
  UUID, TEXT, NUMERIC, UUID, UUID, UUID, NUMERIC, NUMERIC, DATE, TEXT, BOOLEAN, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_record_movement(
  UUID, TEXT, NUMERIC, UUID, UUID, UUID, NUMERIC, NUMERIC, DATE, TEXT, BOOLEAN, TEXT)
  TO authenticated;

REVOKE ALL ON FUNCTION public.inventory_reverse_movement(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_reverse_movement(UUID, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- Verify: run `npm run smoke-inventory`. It exercises take, move, recount AND
-- custody, which is the combination that would have caught this at authoring
-- time — the custody paths skip the lock loop and passed throughout.
-- ------------------------------------------------------------
