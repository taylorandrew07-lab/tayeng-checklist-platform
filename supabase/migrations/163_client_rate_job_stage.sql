-- 163 — Per-stage client rates.
--
-- client_rates could only be keyed on job_type, so a client with an Initial and a
-- Final Draught Survey at different prices had no way to express that. The invoice
-- builder matched on job_type alone and took whichever row sorted first
-- (created_at DESC), silently — so an Initial survey could be seeded with the
-- Discharge rate and its note, and nothing in the UI said which rate had won.
--
-- The workaround the original design intended is still visible in the rates form
-- placeholder: "Draught survey — initial USD 700, final USD 500", i.e. write both
-- prices into a free-text note and correct the number by hand every time. This
-- column replaces that with real data.
--
-- NULL job_stage keeps its existing meaning: "applies to any stage of this job
-- type". Match specificity in the app is therefore
--   (job_type + job_stage) > (job_type, stage NULL) > (job_type NULL)
-- so every rate already entered keeps behaving exactly as it does today.

alter table public.client_rates
  add column if not exists job_stage text;

comment on column public.client_rates.job_stage is
  'Optional stage qualifier matching jobs.job_stage (Initial/Interim/Final, Loading/Discharging, On-hire/Off-hire). NULL = applies to any stage of this job type.';

-- The builder looks rates up by (client_id, job_type, job_stage) on every invoice
-- build. Small table, but the lookup is per-job in a loop.
create index if not exists client_rates_client_type_stage_idx
  on public.client_rates (client_id, job_type, job_stage);
