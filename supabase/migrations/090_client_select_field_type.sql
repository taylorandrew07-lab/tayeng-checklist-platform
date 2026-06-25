-- ============================================================
-- Migration 090: add 'client_select' to the field_type enum
-- Idempotent. MUST be its own migration: Postgres allows ALTER TYPE ... ADD VALUE
-- inside a transaction (PG12+) but the new value cannot be USED until the
-- transaction commits — so any template field that switches to it lives in a
-- later migration (091). Same pattern as 087 → 088 (video_link) and 073 → 074.
--
-- A Client-linked field renders a text input backed by a datalist of the org's
-- active clients: pick an existing client OR type a free-text name (e.g. a
-- commissioning company that isn't a client). Stores the plain name string, so it
-- renders like any text field on the report. Surveyors can already read clients.
-- ============================================================

ALTER TYPE public.field_type ADD VALUE IF NOT EXISTS 'client_select';
