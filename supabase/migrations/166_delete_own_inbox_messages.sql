-- 166 — let a recipient DELETE their own copy of a message. Idempotent.
--
-- Mig 037 built the inbox so that "recipients read, mark read, archive (they
-- never delete)" — archiving was the only way to clear a message, so nothing
-- ever actually left the inbox. Owner's call (2026-07-31): messages should not
-- pile up and be kept; he wants them gone, not filed.
--
-- What this does NOT do, deliberately:
--   * It deletes the message_recipients row — ONE PERSON'S COPY. The messages
--     row survives, so the sender keeps it in Sent and other recipients keep
--     theirs. Deleting the messages row instead would CASCADE and yank the
--     message out of everybody's inbox, which is moderation, not tidying — that
--     stays admin-only via the existing "Admins delete messages" policy.
--   * No change to the mig-037 safe-update trigger: it governs UPDATE only, so
--     read_at/archived_at are still the only columns a recipient can write.
--
-- Consequence to know about: a message every recipient has deleted, sent by the
-- app itself (sender_id NULL — e.g. the cron report reminders), becomes an
-- unreferenced messages row nobody can see. Harmless and tiny; no purge job.

DROP POLICY IF EXISTS "Delete own recipient rows" ON public.message_recipients;
CREATE POLICY "Delete own recipient rows" ON public.message_recipients
  FOR DELETE USING (recipient_id = auth.uid());

-- The admin moderation policy from mig 037 stays as-is (policies are OR-ed):
--   "Admins delete recipient rows"  FOR DELETE USING (public.is_admin())
