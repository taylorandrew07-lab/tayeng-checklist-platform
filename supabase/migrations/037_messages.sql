-- ============================================================
-- Migration 037: Internal messaging (email-style inbox)
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- Async inbox, NOT live chat. Two flows:
--   1. Admin pushes an announcement/update to roles or specific people.
--   2. Any user messages the administrators (e.g. report an app issue).
-- One messages row + N message_recipients rows (fan-out). Recipients read,
-- mark read, archive (they never delete). Admins can read all + delete
-- (moderation). All SENDS go through the service-role API route
-- /api/messages/send — there is intentionally NO client INSERT policy.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tables
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.messages (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  parent_id  UUID REFERENCES public.messages(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.message_recipients (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id   UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  read_at      TIMESTAMPTZ,
  archived_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_message_recipients_recipient ON public.message_recipients (recipient_id);
CREATE INDEX IF NOT EXISTS idx_message_recipients_message   ON public.message_recipients (message_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender              ON public.messages (sender_id);

-- ------------------------------------------------------------
-- 2. Safe-update guard for message_recipients — only read_at / archived_at may
--    change (mirrors the migration-004 safe-field allowlist via a column-diff
--    trigger, since WITH CHECK cannot see OLD values).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_message_recipient_safe_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.id <> OLD.id
     OR NEW.message_id <> OLD.message_id
     OR NEW.recipient_id <> OLD.recipient_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Only read_at and archived_at may be updated on message_recipients';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS message_recipients_safe_update ON public.message_recipients;
CREATE TRIGGER message_recipients_safe_update
  BEFORE UPDATE ON public.message_recipients
  FOR EACH ROW EXECUTE FUNCTION public.enforce_message_recipient_safe_update();

-- ------------------------------------------------------------
-- 3. RLS
-- ------------------------------------------------------------
ALTER TABLE public.messages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_recipients ENABLE ROW LEVEL SECURITY;

-- messages: visible to the sender, to admins, or to a recipient of the message.
-- (message_recipients' own RLS is simple and does not reference messages, so the
--  EXISTS sub-select cannot recurse.) No INSERT/UPDATE policy: sends go through
-- the service role; admins may delete for moderation.
DROP POLICY IF EXISTS "Read messages you sent or received" ON public.messages;
CREATE POLICY "Read messages you sent or received" ON public.messages
  FOR SELECT USING (
    sender_id = auth.uid()
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.message_recipients mr
      WHERE mr.message_id = messages.id AND mr.recipient_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins delete messages" ON public.messages;
CREATE POLICY "Admins delete messages" ON public.messages
  FOR DELETE USING (public.is_admin());

-- message_recipients: own rows or admin. Recipients may UPDATE their own row
-- (the trigger limits it to read_at/archived_at). No INSERT (service role only).
DROP POLICY IF EXISTS "Read own recipient rows" ON public.message_recipients;
CREATE POLICY "Read own recipient rows" ON public.message_recipients
  FOR SELECT USING (recipient_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Update own recipient rows" ON public.message_recipients;
CREATE POLICY "Update own recipient rows" ON public.message_recipients
  FOR UPDATE USING (recipient_id = auth.uid()) WITH CHECK (recipient_id = auth.uid());

DROP POLICY IF EXISTS "Admins delete recipient rows" ON public.message_recipients;
CREATE POLICY "Admins delete recipient rows" ON public.message_recipients
  FOR DELETE USING (public.is_admin());
