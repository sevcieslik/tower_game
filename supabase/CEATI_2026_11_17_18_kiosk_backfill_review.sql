-- ONE-TIME ADMINISTRATIVE BACKFILL for CEATI Denver, 17-18 Nov 2026.
-- Run MANUALLY in Supabase SQL Editor only if all selected scores
-- should be ATTRIBUTED to Jeremy's Ipad2, regardless of actual device used.
-- Changing source to 'kiosk' rewrites provenance; this is a conscious
-- manual attribution and does not fix new-score automatic registration.

-- STEP 1: PREVIEW rows before updating.
select id, name, source, event_id, kiosk_id, sales_rep_id,
       played_at at time zone 'America/Denver' as denver_time
from public.game_entries
where event_id = '5d775de5-2542-4444-8f3c-aee89446da46'::uuid
  and kiosk_id is null
  and played_at >= (timestamp '2026-11-17' at time zone 'America/Denver')
  and played_at <  (timestamp '2026-11-19' at time zone 'America/Denver')
order by played_at;

-- STEP 2: RUN separately, after verifying the preview.
-- BEGIN;
-- UPDATE public.game_entries ge
-- SET kiosk_id = '0e3e41ed-4130-48f8-b29b-b60529a3b201'::uuid,
--     sales_rep_id = 'ec7e58f0-9fcd-4505-b687-3b808b6ca406'::uuid,
--     source = 'kiosk'
-- WHERE ge.event_id = '5d775de5-2542-4444-8f3c-aee89446da46'::uuid
--   AND ge.kiosk_id IS NULL
--   AND ge.played_at >= (timestamp '2026-11-17' at time zone 'America/Denver')
--   AND ge.played_at <  (timestamp '2026-11-19' at time zone 'America/Denver')
-- RETURNING ge.name, ge.source, ge.kiosk_id, ge.sales_rep_id, ge.played_at;
-- COMMIT;
