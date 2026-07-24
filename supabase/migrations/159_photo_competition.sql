-- ============================================================
-- Migration 159: Staff photo (& video) competition — monthly, blind-judged.
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- Staff (admin/surveyor/office) submit photos each month; an admin judges them
-- BLIND (identities hidden) and picks a winner + runner-up. Winners become
-- visible to everyone; non-winning entries stay private to their owner + admins.
--
-- BLIND JUDGING is the load-bearing constraint. Postgres RLS cannot hide a
-- column, and surveyors can already SELECT all staff profiles (mig 002/130). So
-- the entry→entrant LINK is kept in its own table (competition_entry_owners)
-- that an admin can NOT read through the client — exactly the split used for
-- staff PII in mig 130. The judging gallery reads competition_entries, which
-- carries no entrant id. Identities are revealed only after the admin locks the
-- picks, via a service-role route that writes the winner's name onto the
-- (now public) winning rows. Non-winner identities are never denormalised.
--
-- Video: buckets + policies are provisioned now (large cap, video MIME) so the
-- feature can be switched on later; the entrant UI stays photos-only behind a
-- client feature flag (src/lib/features.ts COMPETITION_VIDEO_ENABLED).
-- ============================================================

-- competition_round_open() below is a SQL-language function whose body reads
-- competition_rounds, which is created further down in THIS file. Postgres
-- validates SQL function bodies at CREATE time, so defer that check — the table
-- exists by the time the function is ever called.
SET check_function_bodies = off;

-- ------------------------------------------------------------
-- Helpers (SECURITY DEFINER STABLE, search_path pinned — see mig 013).
-- ------------------------------------------------------------

-- Who may enter: active admin/surveyor/office. NOT is_active_staff() (that is
-- admin+surveyor only). Compare role::text because 'office' was added via
-- ALTER TYPE ADD VALUE (mig 025) and can't be used as an enum literal freely.
CREATE OR REPLACE FUNCTION public.is_competition_entrant()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND is_active = true
      AND role::text IN ('admin', 'surveyor', 'office')
  );
$$;

-- Is a given month still accepting / editable entries? A month with no round row
-- is implicitly open (round rows are created only when an admin sets a theme or
-- moves the month into judging/closed).
CREATE OR REPLACE FUNCTION public.competition_round_open(p_month DATE)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT status = 'open' FROM public.competition_rounds WHERE month = p_month),
    true
  );
$$;

-- ------------------------------------------------------------
-- Tables
-- ------------------------------------------------------------

-- One row per calendar month, created on demand by an admin (theme / lifecycle).
CREATE TABLE IF NOT EXISTS public.competition_rounds (
  month      DATE PRIMARY KEY,          -- first day of the month, Trinidad time
  theme      TEXT,                      -- optional "theme of the month" prompt
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'judging', 'closed')),
  closed_at  TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The entries themselves. NO entrant id here — that is the blind-judging secret,
-- kept in competition_entry_owners. placement/winner_name are filled ONLY by the
-- admin reveal step (service role), never by an entrant (enforced in RLS below).
CREATE TABLE IF NOT EXISTS public.competition_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month        DATE NOT NULL,           -- server-set (Trinidad tz) by trigger below
  media_type   TEXT NOT NULL DEFAULT 'photo' CHECK (media_type IN ('photo', 'video')),
  storage_path TEXT NOT NULL,
  content_type TEXT,
  size_bytes   BIGINT,
  filename     TEXT,
  caption      TEXT,
  captured_at  TIMESTAMPTZ,             -- from EXIF at upload time, best-effort
  placement    TEXT CHECK (placement IN ('winner', 'runner_up')),
  placed_at    TIMESTAMPTZ,
  winner_name  TEXT,                    -- entrant's name; filled ONLY when placed (public reveal)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_competition_entries_month ON public.competition_entries (month);
CREATE INDEX IF NOT EXISTS idx_competition_entries_placed
  ON public.competition_entries (month, placement) WHERE placement IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_competition_entries_path
  ON public.competition_entries (storage_path);

-- The secret link. Owner can read/insert their OWN row; admins CANNOT read it
-- through the client (keeps judging blind). Reveal happens via service role.
CREATE TABLE IF NOT EXISTS public.competition_entry_owners (
  entry_id   UUID PRIMARY KEY REFERENCES public.competition_entries(id) ON DELETE CASCADE,
  entrant_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_competition_entry_owners_entrant
  ON public.competition_entry_owners (entrant_id);

-- updated_at maintenance for rounds.
DROP TRIGGER IF EXISTS update_competition_rounds_updated_at ON public.competition_rounds;
CREATE TRIGGER update_competition_rounds_updated_at
  BEFORE UPDATE ON public.competition_rounds FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Month is server-authoritative for ENTRANTS (Trinidad time) so they can't
-- backdate an upload into another month. An ADMIN uploading on someone's behalf
-- (e.g. a photo sent over WhatsApp) may target a specific past month; if they
-- leave it null it defaults to the current month too. Mirrors the POS-tz month
-- convention used across analytics (mig 107/123).
CREATE OR REPLACE FUNCTION public.set_competition_entry_month()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() OR NEW.month IS NULL THEN
    NEW.month := date_trunc('month', (now() AT TIME ZONE 'America/Port_of_Spain'))::date;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_set_competition_entry_month ON public.competition_entries;
CREATE TRIGGER trg_set_competition_entry_month
  BEFORE INSERT ON public.competition_entries FOR EACH ROW EXECUTE FUNCTION public.set_competition_entry_month();

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
ALTER TABLE public.competition_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_entry_owners ENABLE ROW LEVEL SECURITY;

-- Rounds: entrants read (theme + status); admins manage.
DROP POLICY IF EXISTS "Entrants read rounds" ON public.competition_rounds;
CREATE POLICY "Entrants read rounds" ON public.competition_rounds
  FOR SELECT USING (public.is_competition_entrant());

DROP POLICY IF EXISTS "Admins manage rounds" ON public.competition_rounds;
CREATE POLICY "Admins manage rounds" ON public.competition_rounds
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Entries — read: admin sees ALL (blind: no entrant id on this table); everyone
-- (entrants) sees WINNERS; an entrant sees their OWN via the owner link.
DROP POLICY IF EXISTS "Read competition entries" ON public.competition_entries;
CREATE POLICY "Read competition entries" ON public.competition_entries
  FOR SELECT USING (
    public.is_admin()
    OR (placement IS NOT NULL AND public.is_competition_entrant())
    OR EXISTS (
      SELECT 1 FROM public.competition_entry_owners o
      WHERE o.entry_id = id AND o.entrant_id = auth.uid()
    )
  );

-- Entries — admin full control (judging, placement, delete).
DROP POLICY IF EXISTS "Admins manage entries" ON public.competition_entries;
CREATE POLICY "Admins manage entries" ON public.competition_entries
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Entries — an entrant may INSERT their own entry, but NEVER pre-set a placement.
DROP POLICY IF EXISTS "Entrant insert entry" ON public.competition_entries;
CREATE POLICY "Entrant insert entry" ON public.competition_entries
  FOR INSERT WITH CHECK (
    public.is_competition_entrant() AND placement IS NULL AND winner_name IS NULL
  );

-- Entries — an entrant may edit their own entry (caption) only while the round is
-- open, and can never set a placement on it.
DROP POLICY IF EXISTS "Entrant update own entry" ON public.competition_entries;
CREATE POLICY "Entrant update own entry" ON public.competition_entries
  FOR UPDATE USING (
    public.competition_round_open(month) AND EXISTS (
      SELECT 1 FROM public.competition_entry_owners o
      WHERE o.entry_id = id AND o.entrant_id = auth.uid()
    )
  ) WITH CHECK (placement IS NULL AND winner_name IS NULL);

-- Entries — an entrant may delete their own entry only while the round is open.
DROP POLICY IF EXISTS "Entrant delete own entry" ON public.competition_entries;
CREATE POLICY "Entrant delete own entry" ON public.competition_entries
  FOR DELETE USING (
    public.competition_round_open(month) AND EXISTS (
      SELECT 1 FROM public.competition_entry_owners o
      WHERE o.entry_id = id AND o.entrant_id = auth.uid()
    )
  );

-- Owner link — the secret. Owner reads/inserts their OWN link only. Admins do
-- NOT get a read policy here on purpose (judging stays blind); the reveal step
-- uses the service role. Deletes ride the ON DELETE CASCADE from the entry.
DROP POLICY IF EXISTS "Owner reads own link" ON public.competition_entry_owners;
CREATE POLICY "Owner reads own link" ON public.competition_entry_owners
  FOR SELECT USING (entrant_id = auth.uid());

DROP POLICY IF EXISTS "Owner inserts own link" ON public.competition_entry_owners;
CREATE POLICY "Owner inserts own link" ON public.competition_entry_owners
  FOR INSERT WITH CHECK (entrant_id = auth.uid() AND public.is_competition_entrant());

-- Admin may attach an owner link to ANYONE (uploading a WhatsApp submission on a
-- staff member's behalf). This is INSERT-only — admins still get no SELECT here,
-- so self-submitted entries stay blind during judging.
DROP POLICY IF EXISTS "Admin inserts any link" ON public.competition_entry_owners;
CREATE POLICY "Admin inserts any link" ON public.competition_entry_owners
  FOR INSERT WITH CHECK (public.is_admin());

-- ------------------------------------------------------------
-- Storage: two PRIVATE buckets. Path convention = {entrant_id}/{uuid}_{name},
-- so the first path segment is the owner (mirrors personal-documents, mig 035).
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public) VALUES ('competition-photos', 'competition-photos', false)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('competition-video', 'competition-video', false)
  ON CONFLICT (id) DO NOTHING;

-- Caps. Photos: 25 MB, image MIME only (SVG excluded as a script carrier, per
-- mig 071). Video: 500 MB, common video MIME — provisioned ahead of the UI.
UPDATE storage.buckets
  SET file_size_limit = 26214400,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
  WHERE id = 'competition-photos';
UPDATE storage.buckets
  SET file_size_limit = 524288000,
      allowed_mime_types = ARRAY['video/mp4', 'video/quicktime', 'video/webm']
  WHERE id = 'competition-video';

-- --- competition-photos policies ---
-- Entrant uploads into their OWN folder; an admin may upload into anyone's
-- folder (on-behalf WhatsApp submissions).
DROP POLICY IF EXISTS "Comp photos insert own" ON storage.objects;
CREATE POLICY "Comp photos insert own" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'competition-photos'
    AND (
      ((storage.foldername(name))[1] = auth.uid()::text AND public.is_competition_entrant())
      OR public.is_admin()
    )
  );

DROP POLICY IF EXISTS "Comp photos read" ON storage.objects;
CREATE POLICY "Comp photos read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'competition-photos' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
      OR EXISTS (SELECT 1 FROM public.competition_entries e WHERE e.storage_path = name AND e.placement IS NOT NULL)
    )
  );

DROP POLICY IF EXISTS "Comp photos delete own or admin" ON storage.objects;
CREATE POLICY "Comp photos delete own or admin" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'competition-photos'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin())
  );

-- --- competition-video policies (mirror photos) ---
DROP POLICY IF EXISTS "Comp video insert own" ON storage.objects;
CREATE POLICY "Comp video insert own" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'competition-video'
    AND (
      ((storage.foldername(name))[1] = auth.uid()::text AND public.is_competition_entrant())
      OR public.is_admin()
    )
  );

DROP POLICY IF EXISTS "Comp video read" ON storage.objects;
CREATE POLICY "Comp video read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'competition-video' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
      OR EXISTS (SELECT 1 FROM public.competition_entries e WHERE e.storage_path = name AND e.placement IS NOT NULL)
    )
  );

DROP POLICY IF EXISTS "Comp video delete own or admin" ON storage.objects;
CREATE POLICY "Comp video delete own or admin" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'competition-video'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin())
  );
