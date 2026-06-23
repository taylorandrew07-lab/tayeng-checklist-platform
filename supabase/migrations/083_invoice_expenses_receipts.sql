-- Invoice expenses / disbursements with receipts. An invoice can carry reimbursable
-- items (e.g. a launch at $200) with the vendor receipt attached and an editable
-- value. Receipts live in a private 'invoice-receipts' bucket (admin/office).

ALTER TABLE public.invoice_line_items ADD COLUMN IF NOT EXISTS is_expense BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.invoice_line_items ADD COLUMN IF NOT EXISTS receipt_path TEXT;

-- Private bucket for attached receipts.
INSERT INTO storage.buckets (id, name, public) VALUES ('invoice-receipts', 'invoice-receipts', false)
  ON CONFLICT (id) DO NOTHING;

-- Read: admin + office-with-invoicing.view. Write: admin only.
DROP POLICY IF EXISTS "Invoicing read receipts" ON storage.objects;
CREATE POLICY "Invoicing read receipts" ON storage.objects
  FOR SELECT USING (bucket_id = 'invoice-receipts' AND (public.is_admin() OR public.has_office_permission('invoicing.view')));

DROP POLICY IF EXISTS "Admins upload receipts" ON storage.objects;
CREATE POLICY "Admins upload receipts" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'invoice-receipts' AND public.is_admin());

DROP POLICY IF EXISTS "Admins update receipts" ON storage.objects;
CREATE POLICY "Admins update receipts" ON storage.objects
  FOR UPDATE USING (bucket_id = 'invoice-receipts' AND public.is_admin());

DROP POLICY IF EXISTS "Admins delete receipts" ON storage.objects;
CREATE POLICY "Admins delete receipts" ON storage.objects
  FOR DELETE USING (bucket_id = 'invoice-receipts' AND public.is_admin());
