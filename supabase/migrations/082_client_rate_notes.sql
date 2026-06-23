-- A note on each client rate — e.g. a draught survey may have a separate fee for
-- the initial and the final survey, which needs to be stated alongside the rate.
ALTER TABLE public.client_rates ADD COLUMN IF NOT EXISTS notes TEXT;
